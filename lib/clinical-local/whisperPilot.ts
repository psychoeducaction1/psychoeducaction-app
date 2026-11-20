import 'server-only'
import { request as httpRequest } from 'node:http'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { detectClinicalAudio } from '@/lib/clinicalNotesAi'
import { ClinicalNotesAiError } from '@/lib/clinicalNotesAiServer'
import { isLocalClinicalRuntime } from '@/lib/clinical-local/runtime'
import { isRealLocalRehearsal } from '@/lib/clinical-real/runtimeIsolation'
import { readTranscriptionServiceConfig } from '@/lib/clinical-local/transcriptionServiceConfig.mjs'

export const LOCAL_WHISPER_MAX_BYTES = 160_000_000
export const LOCAL_WHISPER_MAX_TRANSCRIPT_CHARS = 250_000
const MAX_DURATION_MS = 7_200_000
const MAX_SERVICE_RESPONSE_BYTES = 2_000_000
export type LocalWhisperSegment = { startMs: number; endMs: number; text: string;
  confidence?: number; signalLevelDb?: number; speechCoverage?: number }

export function localWhisperPilot(directory = process.cwd(), realRehearsal = false) {
  if (!isLocalClinicalRuntime() && !(realRehearsal && isRealLocalRehearsal(process.env))) return null
  const root = resolve(/*turbopackIgnore: true*/ directory)
  const folder = resolve(root, '.local-clinical')
  const config = resolve(folder, 'whisper-pilot.json')
  if (!existsSync(config)) return null
  if (lstatSync(folder).isSymbolicLink() || lstatSync(config).isSymbolicLink()
    || realpathSync(dirname(config)) !== folder) throw new Error('WHISPER_PILOT_PATH_REFUSED')
  const value: unknown = JSON.parse(readFileSync(config, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WHISPER_PILOT_CONFIG_REFUSED')
  const data = value as Record<string, unknown>
  if (Object.keys(data).sort().join(',') !== 'engine,fictional,projectId'
    || data.engine !== 'whisper-cli' || data.fictional !== true || data.projectId !== 'pea-clinical-lab') {
    throw new Error('WHISPER_PILOT_CONFIG_REFUSED')
  }
  const service = readTranscriptionServiceConfig(root)
  if (!service) throw new Error('TRANSCRIPTION_SERVICE_NOT_PREPARED')
  return service
}

export function parseLocalWhisperSegments(value: unknown): LocalWhisperSegment[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WHISPER_SEGMENTS_INVALID')
  const raw = (value as { transcription?: unknown }).transcription
  if (!Array.isArray(raw) || !raw.length || raw.length > 10_000) throw new Error('WHISPER_SEGMENTS_INVALID')
  let previousEnd = 0
  return raw.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('WHISPER_SEGMENTS_INVALID')
    const segment = item as { offsets?: { from?: unknown; to?: unknown }; text?: unknown;
      confidence?: unknown; signalLevelDb?: unknown; speechCoverage?: unknown }
    const startMs = segment.offsets?.from
    const endMs = segment.offsets?.to
    const text = typeof segment.text === 'string' ? segment.text.trim() : ''
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || (startMs as number) < previousEnd
      || (endMs as number) <= (startMs as number) || (endMs as number) > MAX_DURATION_MS
      || !text || text.length > 2_000) throw new Error('WHISPER_SEGMENTS_INVALID')
    previousEnd = endMs as number
    const confidence = segment.confidence
    const signalLevelDb = segment.signalLevelDb
    const speechCoverage = segment.speechCoverage
    if (confidence !== undefined && (typeof confidence !== 'number' || !Number.isFinite(confidence)
      || confidence < 0 || confidence > 1)) throw new Error('WHISPER_SEGMENTS_INVALID')
    if (signalLevelDb !== undefined && (typeof signalLevelDb !== 'number' || !Number.isFinite(signalLevelDb)
      || signalLevelDb < -120 || signalLevelDb > 0)) throw new Error('WHISPER_SEGMENTS_INVALID')
    if (speechCoverage !== undefined && (typeof speechCoverage !== 'number' || !Number.isFinite(speechCoverage)
      || speechCoverage < 0 || speechCoverage > 1)) throw new Error('WHISPER_SEGMENTS_INVALID')
    return { startMs: startMs as number, endMs: endMs as number, text,
      ...(confidence === undefined ? {} : { confidence: confidence as number }),
      ...(signalLevelDb === undefined ? {} : { signalLevelDb: signalLevelDb as number }),
      ...(speechCoverage === undefined ? {} : { speechCoverage: speechCoverage as number }) }
  })
}

function postToLocalService(service: { host: string; port: number; token: string },
  bytes: Uint8Array, format: { type: string }, signal: AbortSignal) {
  return new Promise<{ status: number; payload: unknown }>((resolveResult, rejectResult) => {
    const request = httpRequest({ hostname: service.host, port: service.port, path: '/v1/transcribe', method: 'POST',
      signal, timeout: 3_600_000,
      headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': format.type, 'X-Fictional-Only': 'true',
        'Content-Length': bytes.byteLength } }, response => {
      const length = Number(response.headers['content-length'])
      if (Number.isFinite(length) && length > MAX_SERVICE_RESPONSE_BYTES) {
        request.destroy(new Error('WHISPER_SERVICE_RESPONSE_LIMIT'))
        return
      }
      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer) => {
        total += chunk.byteLength
        if (total > MAX_SERVICE_RESPONSE_BYTES) request.destroy(new Error('WHISPER_SERVICE_RESPONSE_LIMIT'))
        else chunks.push(chunk)
      })
      response.once('end', () => {
        try { resolveResult({ status: response.statusCode ?? 503,
          payload: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))) as unknown }) }
        catch (error) { rejectResult(error) }
      })
      response.once('error', rejectResult)
    })
    request.once('timeout', () => request.destroy(new Error('WHISPER_SERVICE_TIMEOUT')))
    request.once('error', rejectResult)
    request.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  })
}

export async function transcribeLocalWhisper(file: File, requestSignal?: AbortSignal, realRehearsal = false) {
  const service = localWhisperPilot(process.cwd(), realRehearsal)
  if (!service) throw new ClinicalNotesAiError('La transcription locale n’est pas activée.', 503)
  if (!file.size || file.size > LOCAL_WHISPER_MAX_BYTES) {
    throw new ClinicalNotesAiError('Choisissez un audio fictif de moins de 160 Mo.', 413)
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    const format = detectClinicalAudio(bytes)
    if (!format) throw new ClinicalNotesAiError('Format non reconnu. Utilisez WAV, MP3, M4A ou WebM.', 400)
    const signal = requestSignal ? AbortSignal.any([requestSignal, AbortSignal.timeout(3_600_000)]) : AbortSignal.timeout(3_600_000)
    const { status, payload } = await postToLocalService(service, bytes, format, signal)
    if (status !== 200) {
      if (status === 429) throw new ClinicalNotesAiError('Une transcription est déjà en cours. Réessayez dans quelques minutes.', 429)
      if (status === 413) throw new ClinicalNotesAiError('Cet essai accepte au plus deux heures d’audio et 160 Mo.', 413)
      throw new ClinicalNotesAiError('Le service de transcription est indisponible.', 503)
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('WHISPER_SERVICE_RESPONSE_INVALID')
    const result = payload as { transcript?: unknown; rawSegments?: unknown; durationMs?: unknown }
    if (typeof result.transcript !== 'string' || !result.transcript.trim()
      || result.transcript.length > LOCAL_WHISPER_MAX_TRANSCRIPT_CHARS) throw new Error('WHISPER_SERVICE_RESPONSE_INVALID')
    if (result.durationMs !== undefined && (!Number.isInteger(result.durationMs)
      || (result.durationMs as number) <= 0 || (result.durationMs as number) > MAX_DURATION_MS)) {
      throw new Error('WHISPER_SERVICE_RESPONSE_INVALID')
    }
    return { transcript: result.transcript.trim(), segments: parseLocalWhisperSegments(result.rawSegments),
      ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs as number }) }
  } catch (error) {
    if (error instanceof ClinicalNotesAiError) throw error
    throw new ClinicalNotesAiError('Le service de transcription local est indisponible. Aucun audio n’a été conservé dans le dossier clinique.', 503)
  } finally {
    bytes.fill(0)
  }
}



