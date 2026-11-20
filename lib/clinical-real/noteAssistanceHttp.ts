import { realClinicalTransport } from './transport.ts'
import { ClinicalNotesAiError, isClinicalNotesAiEnabled, readClinicalNotesBody, requestClinicalStructured } from '@/lib/clinicalNotesAiServer'
import { isClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import { generateClinicalEngine } from '@/lib/clinicalNoteEngineServer'
import { continuousAssistedNote } from '@/lib/clinical-workspace/noteAssistance'
import { contextualClinicalIdentifiers, deidentifyClinicalSources, knownClinicalIdentifiers } from '@/lib/clinical-workspace/deidentify'
import type { KnownClinicalPerson } from '@/lib/clinical-workspace/deidentify'
import { prepareTranscriptForDraft } from '@/lib/clinical-workspace/transcriptQuality'
import { LOCAL_NOTE_TRANSCRIPT_MAX_CHARS } from '@/lib/clinical-workspace/transcriptReview'
import { isRealLocalRehearsal } from './runtimeIsolation.ts'
import { LOCAL_WHISPER_MAX_BYTES, localWhisperPilot, transcribeLocalWhisper } from '@/lib/clinical-local/whisperPilot'
import { detectClinicalAudio } from '@/lib/clinicalNotesAi'
import type { ClinicalStructuredRequester } from '@/lib/clinicalNoteAnalysisServer'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { latestPriorNote } from './latestPriorNote.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers })
type Context = { appointmentId: string; caseId: string; professionalId: string; clientName: string;
  representatives: KnownClinicalPerson[]; participants: (KnownClinicalPerson & { agreed: boolean })[];
  history: string; service: string | null; ready: boolean; mandateSigned: boolean; attested: boolean;
  withdrawn: boolean; version: number | null }
function isContext(value: unknown, appointmentId: string): value is Context {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<Context>
  return item.appointmentId === appointmentId && uuid.test(item.caseId ?? '')
    && typeof item.clientName === 'string' && typeof item.history === 'string'
    && typeof item.ready === 'boolean' && Array.isArray(item.representatives)
    && Array.isArray(item.participants)
}
async function reviewedHistory(transport: ReturnType<typeof realClinicalTransport>, token: string,
  context: Context): Promise<string> {
  return latestPriorNote(transport, token, context.caseId, context.appointmentId)
}
function isBody(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function browserTranscriptionAvailable() {
  if (process.env.PEA_REAL_BROWSER_TRANSCRIPTION_ENABLED === 'true') return true
  if (!isRealLocalRehearsal(process.env)) return false
  const root = join(process.cwd(), 'public', 'clinical-model')
  return ['onnx-community/whisper-base/onnx/encoder_model_quantized.onnx',
    'onnx-community/whisper-base/onnx/decoder_model_merged_quantized.onnx',
    'onnx-runtime/ort-wasm-simd-threaded.asyncify.wasm'].every(file => existsSync(join(root, file)))
}

/** L'audio fictif est accepté uniquement dans la répétition locale isolée. */
export async function handleRealNoteAssistance(request: Request,
  structured: ClinicalStructuredRequester = requestClinicalStructured) {
  try {
    const transport = realClinicalTransport()
    const token = await transport.authenticate(request)
    if (!token) return reply({ code: 'UNAUTHORIZED', error: 'Connexion requise.' }, 401)
    if (request.method === 'GET') {
      const appointmentId = new URL(request.url).searchParams.get('appointmentId') ?? ''
      if (!uuid.test(appointmentId)) return reply({ code: 'INVALID_INPUT', error: 'Rencontre invalide.' }, 400)
      const context = await transport.rpc('clinical_ai_context', { p_appointment_id: appointmentId }, token)
      if (!isContext(context, appointmentId)) throw new Error('REAL_AI_CONTEXT_INVALID')
      return reply({ enabled: true, draftingEnabled: process.env.PEA_REAL_AI_SERVER_ENABLED === 'true' && isClinicalNotesAiEnabled(),
        transcriptionEngine: browserTranscriptionAvailable() ? 'browser'
          : isRealLocalRehearsal(process.env) && localWhisperPilot(process.cwd(), true) ? 'local-rehearsal' : 'unavailable', consent: { ready: context.ready, attested: context.attested,
          mandateSigned: context.mandateSigned, withdrawn: context.withdrawn, participants: context.participants,
          version: context.version }, history: await reviewedHistory(transport, token, context) })
    }
    const contentType = request.headers.get('content-type') ?? ''
    if (request.method === 'POST' && contentType.startsWith('multipart/form-data;')) {
      if (!isRealLocalRehearsal(process.env)) return reply({ code: 'AUDIO_DISABLED', error: 'La transcription audio est réservée à la copie locale isolée.' }, 403)
      const appointmentId = new URL(request.url).searchParams.get('appointmentId') ?? ''
      if (!uuid.test(appointmentId)) return reply({ code: 'INVALID_INPUT', error: 'Rencontre invalide.' }, 400)
      const context = await transport.rpc('clinical_ai_context', { p_appointment_id: appointmentId }, token)
      if (!isContext(context, appointmentId)) throw new Error('REAL_AI_CONTEXT_INVALID')
      if (!context.ready || context.withdrawn) return reply({ code: 'ENCOUNTER_CONSENT_REQUIRED', error: 'Accord requis pour cette rencontre.' }, 409)
      const bytes = await readClinicalNotesBody(request, LOCAL_WHISPER_MAX_BYTES + 65_536)
      const form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData()
      if (form.get('fictional') !== 'true') return reply({ code: 'FICTIONAL_REQUIRED', error: 'Confirmez que cet audio est entièrement fictif.' }, 400)
      const file = form.get('audio')
      if (!(file instanceof File) || !file.size || file.size > LOCAL_WHISPER_MAX_BYTES
        || !detectClinicalAudio(new Uint8Array(await file.slice(0, 32).arrayBuffer())))
        return reply({ code: 'INVALID_AUDIO', error: 'Fichier audio invalide ou trop volumineux.' }, 400)
      const result = await transcribeLocalWhisper(file, request.signal, true)
      return reply({ transcript: result.transcript, segments: result.segments, durationMs: result.durationMs ?? null })
    }
    if (request.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(contentType))
      return reply({ code: 'INVALID_INPUT', error: 'Contenu JSON requis.' }, 400)
    const bytes = await readClinicalNotesBody(request, 1_500_000)
    let parsed: unknown
    try { parsed = JSON.parse(bytes.toString('utf8')) } catch { return reply({ code: 'INVALID_INPUT', error: 'JSON invalide.' }, 400) }
    if (!isBody(parsed) || typeof parsed.appointmentId !== 'string' || !uuid.test(parsed.appointmentId))
      return reply({ code: 'INVALID_INPUT', error: 'Rencontre invalide.' }, 400)
    const appointmentId = parsed.appointmentId
    if (parsed.action === 'consent') {
      if (typeof parsed.attested !== 'boolean' || !Array.isArray(parsed.participants)
        || parsed.participants.length > 12 || !(parsed.version === null || Number.isInteger(parsed.version)))
        return reply({ code: 'INVALID_INPUT', error: 'Consentement invalide.' }, 400)
      const context = await transport.rpc('clinical_ai_consent', {
        p_appointment_id: appointmentId,p_attested: parsed.attested,
        p_participants: parsed.participants,p_expected_version: parsed.version,
      }, token)
      if (!isContext(context, appointmentId)) throw new Error('REAL_AI_CONTEXT_INVALID')
      return reply({ consent: { ready: context.ready, attested: context.attested, mandateSigned: context.mandateSigned,
        withdrawn: context.withdrawn, participants: context.participants, version: context.version } })
    }
    if (parsed.action !== 'generate' || !isClinicalNoteType(parsed.noteType)
      || typeof parsed.transcript !== 'string' || !parsed.transcript.trim()
      || parsed.transcript.length > LOCAL_NOTE_TRANSCRIPT_MAX_CHARS
      || Object.keys(parsed).some(key => !['action','appointmentId','noteType','transcript'].includes(key)))
      return reply({ code: 'INVALID_INPUT', error: 'Transcription ou gabarit invalide.' }, 400)
    if (process.env.PEA_REAL_AI_SERVER_ENABLED !== 'true' || !isClinicalNotesAiEnabled())
      return reply({ code: 'AI_DISABLED', error: 'La rédaction IA n’est pas activée.' }, 503)
    const context = await transport.rpc('clinical_ai_context', { p_appointment_id: appointmentId }, token)
    if (!isContext(context, appointmentId)) throw new Error('REAL_AI_CONTEXT_INVALID')
    if (!context.ready) return reply({ code: 'ENCOUNTER_CONSENT_REQUIRED', error: 'Accord requis pour cette rencontre.' }, 409)
    const quality = prepareTranscriptForDraft(parsed.transcript)
    if (!quality.text) return reply({ code: 'TRANSCRIPT_UNRELIABLE', error: 'Transcription inexploitable.' }, 422)
    const people = [...context.representatives, ...context.participants]
      .filter((person): person is KnownClinicalPerson => typeof person?.name === 'string'
        && ['parent','guardian','other','père','mère'].includes(person.role))
    const known = knownClinicalIdentifiers(context.clientName, people)
    if (!known) return reply({ code: 'IDENTIFIER_LIMIT', error: 'Trop de noms à filtrer.' }, 422)
    const initial = deidentifyClinicalSources({ transcript: quality.text,
      history: await reviewedHistory(transport, token, context), metadata: (context.service ?? '').slice(0,2_000) }, known)
    const candidates = contextualClinicalIdentifiers(initial.sources)
    if (!candidates) return reply({ code: 'IDENTIFIER_LIMIT', error: 'Trop de noms à filtrer.' }, 422)
    const prepared = deidentifyClinicalSources(initial.sources, candidates)
    if (prepared.residualDirectIdentifiers || !prepared.sources.transcript.trim())
      return reply({ code: 'IDENTIFIER_REMAINS', error: 'Un identifiant direct demeure dans le texte.' }, 422)
    // Seules les sources filtrées quittent ce serveur; la réponse n'est pas
    // enregistrée ni signée automatiquement. Le professionnel relit le texte.
    const result = await generateClinicalEngine(prepared.sources, parsed.noteType, request.signal,
      'real-private', structured)
    const text = continuousAssistedNote(result)
    const output = deidentifyClinicalSources({ transcript: text, history: '', metadata: '' }, known)
    const outputNames = contextualClinicalIdentifiers(output.sources)
    if (!outputNames) return reply({ code: 'IDENTIFIER_LIMIT', error: 'Trop de noms à filtrer.' }, 422)
    const cleaned = deidentifyClinicalSources(output.sources, outputNames)
    if (cleaned.residualDirectIdentifiers) return reply({ code: 'IDENTIFIER_REMAINS', error: 'Un identifiant direct demeure dans le brouillon.' }, 422)
    return reply({ noteType: parsed.noteType, draft: cleaned.sources.transcript })
  } catch (error) {
    if (error instanceof ClinicalNotesAiError && [400, 413, 429].includes(error.status))
      return reply({ code: 'AUDIO_INVALID', error: error.message }, error.status)
    const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : null
    if (code === '42501') return reply({ code: 'FORBIDDEN', error: 'Accès refusé.' }, 403)
    if (code === '40001') return reply({ code: 'CONFLICT', error: 'Les accords ont changé. Actualisez.' }, 409)
    if (code === '22023') return reply({ code: 'INVALID_INPUT', error: 'Les accords doivent être vérifiés.' }, 400)
    return reply({ code: 'REAL_AI_UNAVAILABLE', error: 'L’aide IA est indisponible. Aucun texte n’a été inséré.' }, 503)
  }
}
