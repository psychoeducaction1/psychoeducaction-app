import 'server-only'
import { request as httpRequest } from 'node:http'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { ClinicalNotesAiError } from '@/lib/clinicalNotesAiServer'

type PrivateEngineConfig = { schemaVersion: 1; purpose: 'real-clinical-notes'; host: '127.0.0.1'; port: number; model: string; token: string }
const RESPONSE_LIMIT = 2_000_000

/** A separate configuration prevents a real note from inheriting the fictional OpenAI pilot. */
export function readPrivateNoteEngineConfig(directory = process.cwd()): PrivateEngineConfig | null {
  const root = realpathSync(/*turbopackIgnore: true*/ directory)
  const folder = resolve(root, '.local-clinical')
  const file = resolve(folder, 'private-note-engine.json')
  if (!existsSync(file)) return null
  if (lstatSync(folder).isSymbolicLink() || lstatSync(file).isSymbolicLink()
    || realpathSync(dirname(file)) !== folder) throw new Error('PRIVATE_NOTE_ENGINE_PATH_REFUSED')
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PRIVATE_NOTE_ENGINE_CONFIG_REFUSED')
  const data = value as Record<string, unknown>
  if (Object.keys(data).sort().join(',') !== 'host,model,port,purpose,schemaVersion,token'
    || data.schemaVersion !== 1 || data.purpose !== 'real-clinical-notes' || data.host !== '127.0.0.1'
    || !Number.isInteger(data.port) || (data.port as number) < 1024 || (data.port as number) > 65535
    || typeof data.model !== 'string' || !/^[a-zA-Z0-9._/-]{1,120}$/.test(data.model)
    || typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) {
    throw new Error('PRIVATE_NOTE_ENGINE_CONFIG_REFUSED')
  }
  return data as PrivateEngineConfig
}

export async function requestPrivateClinicalStructured(name: string, instructions: string, source: unknown,
  schema: object, signal: AbortSignal, directory = process.cwd()): Promise<unknown> {
  const config = readPrivateNoteEngineConfig(directory)
  if (!config) throw new ClinicalNotesAiError('Le moteur privé de rédaction clinique n’est pas configuré.', 503)
  const body = Buffer.from(JSON.stringify({ model: config.model, stream: false, temperature: 0,
    n_predict: 6_000, chat_template_kwargs: { enable_thinking: false },
    messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(source) }],
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } } }), 'utf8')
  if (body.byteLength > 300_000) throw new ClinicalNotesAiError('Les sources dépassent la limite du moteur privé.', 413)

  return new Promise<unknown>((resolveResult, rejectResult) => {
    const request = httpRequest({ hostname: config.host, port: config.port, path: '/v1/chat/completions', method: 'POST',
      signal, timeout: 180_000, headers: { Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json', 'Content-Length': body.byteLength } }, response => {
      const declared = Number(response.headers['content-length'])
      if (Number.isFinite(declared) && declared > RESPONSE_LIMIT) {
        request.destroy(new Error('PRIVATE_NOTE_ENGINE_RESPONSE_LIMIT')); return
      }
      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer) => {
        total += chunk.byteLength
        if (total > RESPONSE_LIMIT) request.destroy(new Error('PRIVATE_NOTE_ENGINE_RESPONSE_LIMIT'))
        else chunks.push(chunk)
      })
      response.once('end', () => {
        if (response.statusCode !== 200) {
          rejectResult(new ClinicalNotesAiError('Le moteur privé de rédaction est indisponible.', 503)); return
        }
        try {
          const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)))
          const choices = (payload as { choices?: { finish_reason?: unknown; message?: { content?: unknown } }[] })?.choices
          const content = choices?.[0]?.message?.content
          if (choices?.length !== 1 || choices[0].finish_reason !== 'stop' || typeof content !== 'string' || !content.trim()) {
            throw new Error('PRIVATE_NOTE_ENGINE_RESPONSE_INVALID')
          }
          resolveResult(JSON.parse(content) as unknown)
        } catch { rejectResult(new ClinicalNotesAiError('Le moteur privé a retourné une réponse invalide.', 502)) }
      })
      response.once('error', rejectResult)
    })
    request.once('timeout', () => request.destroy(new Error('PRIVATE_NOTE_ENGINE_TIMEOUT')))
    request.once('error', () => rejectResult(new ClinicalNotesAiError('Le moteur privé est indisponible ou le délai est dépassé.', 503)))
    request.end(body)
  })
}
