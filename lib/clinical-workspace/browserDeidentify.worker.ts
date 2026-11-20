import { env, pipeline } from '@huggingface/transformers'
import { contextualClinicalIdentifiers, deidentifyClinicalSources, knownClinicalIdentifiers, parseClinicalIdentifiers } from './deidentify'
import type { KnownClinicalPerson } from './deidentify'
import type { ClinicalSources } from '@/lib/clinicalNoteEngine'

type Request = { type: 'prepare'; sources: ClinicalSources; clientName: string; knownParticipants: KnownClinicalPerson[]; dossierPeople: KnownClinicalPerson[] }
type Entity = { entity_group?: string; word?: string }
let modelPromise: ReturnType<typeof pipeline<'token-classification'>> | null = null

// This worker must never fetch a model or clinical text from a third-party host.
env.allowLocalModels = true
env.allowRemoteModels = false
env.localModelPath = '/clinical-model/'
env.useWasmCache = false
// Vercel limits individual uploaded files to 100 MB. The local NER model is
// served as two same-origin pieces in staging; the cache adapter presents the
// original ONNX response to Transformers.js without contacting a model host.
const splitModelPath = 'clinical-model/Xenova/camembert-ner/onnx/model_quantized.onnx'
const splitModelParts = [`/${splitModelPath}.part-000`, `/${splitModelPath}.part-001`]
const splitModelBytes = 111_284_131
let splitModelResponse: Promise<Response | undefined> | null = null
async function loadSplitModel(): Promise<Response | undefined> {
  const responses = await Promise.all(splitModelParts.map(path => fetch(new URL(path, self.location.origin))))
  if (responses.every(response => response.status === 404)) return undefined // Local development keeps the unsplit file.
  if (responses.some(response => !response.ok)) throw new Error('LOCAL_MODEL_PART_MISSING')
  const parts = await Promise.all(responses.map(response => response.blob()))
  const combined = new Blob(parts, { type: 'application/octet-stream' })
  if (combined.size !== splitModelBytes) throw new Error('LOCAL_MODEL_PART_SIZE')
  return new Response(combined, { status: 200 })
}
env.useCustomCache = true
env.customCache = {
  async match(request) {
    if (!request.replace(/\\/g, '/').endsWith(splitModelPath)) return undefined
    splitModelResponse ??= loadSplitModel().catch(error => { splitModelResponse = null; throw error })
    return (await splitModelResponse)?.clone()
  },
  async put() {},
}
env.backends.onnx.wasm!.wasmPaths = {
  mjs: new URL('/clinical-model/onnx-runtime/ort-wasm-simd-threaded.asyncify.mjs', self.location.origin).href,
  wasm: new URL('/clinical-model/onnx-runtime/ort-wasm-simd-threaded.asyncify.wasm', self.location.origin).href,
}

function chunks(text: string) {
  const result: string[] = []
  let remaining = text
  while (remaining.length) {
    let end = Math.min(500, remaining.length)
    if (end < remaining.length) {
      const boundary = Math.max(remaining.lastIndexOf('. ', end), remaining.lastIndexOf('? ', end), remaining.lastIndexOf('! ', end), remaining.lastIndexOf('\n', end))
      if (boundary > end / 2) end = boundary + 1
    }
    result.push(remaining.slice(0, end))
    remaining = remaining.slice(end)
  }
  return result
}

function role(entity: string) {
  const normalized = entity.toUpperCase()
  if (normalized.includes('PER')) return 'personne'
  if (normalized.includes('LOC')) return 'lieu'
  if (normalized.includes('ORG')) return 'établissement'
  return null
}

async function prepare(request: Request) {
  modelPromise ??= pipeline('token-classification', 'Xenova/camembert-ner', { device: 'wasm', dtype: 'q8' })
  const model = await modelPromise
  const found = new Set<string>()
  const known = knownClinicalIdentifiers(request.clientName, [...(request.dossierPeople ?? []), ...(request.knownParticipants ?? [])])
  const contextual = contextualClinicalIdentifiers(request.sources)
  if (!known || !contextual) throw new Error('TOO_MANY_IDENTIFIERS')
  for (const entry of known) found.add(entry)
  for (const entry of contextual) found.add(entry)
  const sourceTexts = Object.values(request.sources)
  for (const source of sourceTexts) {
    for (const chunk of chunks(source)) {
      const entities = await model(chunk, { aggregation_strategy: 'simple' }) as Entity[]
      for (const entity of entities) {
        const kind = role(entity.entity_group ?? '')
        const word = entity.word?.replace(/^▁/, '').trim()
        if (kind && word && word.length >= 2 && word.length <= 80 && !/[\[\]<>|\r\n]/u.test(word)) found.add(`${kind}|${word}`)
      }
    }
  }
  const identifiers = parseClinicalIdentifiers([...found])
  if (!identifiers) throw new Error('TOO_MANY_IDENTIFIERS')
  const result = deidentifyClinicalSources(request.sources, identifiers)
  if (result.residualDirectIdentifiers || !result.sources.transcript.trim()) throw new Error('RESIDUAL_IDENTIFIER')
  self.postMessage({ type: 'prepared', sources: result.sources, replacementCount: result.replacementCount })
}

self.onmessage = (event: MessageEvent<Request>) => {
  if (event.data.type !== 'prepare') return
  void prepare(event.data).catch(() => self.postMessage({ type: 'error', message: 'Le filtrage local a échoué. Aucun texte n’a été envoyé à l’IA.' }))
}
