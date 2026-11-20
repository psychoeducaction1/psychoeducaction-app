import { env, pipeline } from '@huggingface/transformers'
import { cleanWhisperPassage, likelyTranscriptionLoop, UNCERTAIN_TRANSCRIPT_PASSAGE } from '@/lib/clinical-workspace/transcriptQuality'

type Input =
  | { type: 'start' }
  | { type: 'chunk'; samples: Float32Array; sampleRate: number; offsetMs: number }
  | { type: 'finish' }

type Passage = { startMs: number; endMs: number; text: string }
type Recognition = { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }

let loading: ReturnType<typeof pipeline<'automatic-speech-recognition'>> | null = null
let queue: Promise<void> = Promise.resolve()
let passages: Passage[] = []
let cleanedPassages = 0
let failed = false
const loadingFiles = new Set<string>()
let failedResource = ''
// Keep the model on the application's own domain. Only the audio stays in this worker.
env.allowLocalModels = true
env.allowRemoteModels = false
env.localModelPath = '/clinical-model/';
// Transformers.js otherwise rewrites its WASM factory to a blob: module,
// which this browser cannot import. The same-origin file uses HTTP cache.
env.useWasmCache = false
env.backends.onnx.wasm!.wasmPaths = {
  mjs: new URL('/clinical-model/onnx-runtime/ort-wasm-simd-threaded.asyncify.mjs', self.location.origin).href,
  wasm: new URL('/clinical-model/onnx-runtime/ort-wasm-simd-threaded.asyncify.wasm', self.location.origin).href,
}
const nativeFetch = env.fetch
env.fetch = async (input, init) => {
  try { return await nativeFetch(input, init) } catch (error) {
    try {
      const url = new URL(typeof input === 'string' ? input : input.href)
      failedResource = `${url.origin}${url.pathname}`.slice(0, 250)
    } catch { failedResource = 'adresse inconnue' }
    throw error
  }
}

function resample(input: Float32Array, sampleRate: number) {
  if (sampleRate === 16_000) return input
  const count = Math.round(input.length * 16_000 / sampleRate)
  const output = new Float32Array(count)
  for (let index = 0; index < count; index++) {
    const at = index * sampleRate / 16_000
    const left = Math.min(Math.floor(at), input.length - 1)
    const right = Math.min(left + 1, input.length - 1)
    output[index] = input[left] + (input[right] - input[left]) * (at - left)
  }
  return output
}

async function model() {
  loading ??= pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', {
    device: 'wasm', dtype: 'q8',
    progress_callback: event => {
      if (event.status === 'initiate') loadingFiles.add(event.file)
      if (event.status === 'done') loadingFiles.delete(event.file)
    },
  })
  return await loading
}

async function transcribe(message: Extract<Input, { type: 'chunk' }>) {
  if (failed || !Number.isInteger(message.offsetMs) || message.offsetMs < 0
    || !Number.isFinite(message.sampleRate) || message.sampleRate < 8_000 || message.sampleRate > 192_000
    || !(message.samples instanceof Float32Array) || message.samples.length === 0
    || message.samples.length > message.sampleRate * 35) throw new Error('INVALID_AUDIO_CHUNK')
  const samples = resample(message.samples, message.sampleRate)
  const durationMs = Math.round(samples.length / 16_000 * 1000)
  // Only skip near-digital silence. A stronger energy gate would discard quiet speech.
  if (samples.every(sample => Math.abs(sample) < 0.0001)) {
    self.postMessage({ type: 'progress', completedMs: message.offsetMs + durationMs, passages: [] })
    return
  }
  const output = await (await model())(samples, { language: 'french', task: 'transcribe', return_timestamps: true }) as Recognition
  const chunks = Array.isArray(output.chunks) && output.chunks.length ? output.chunks
    : [{ text: output.text, timestamp: [0, durationMs / 1000] as [number, number] }]
  const recognized = chunks.flatMap(item => {
    const text = item.text?.trim()
    const start = item.timestamp?.[0]
    const end = item.timestamp?.[1]
    if (!text || !/[\p{L}\p{N}]/u.test(text) || !Number.isFinite(start) || start < 0) return []
    const startMs = message.offsetMs + Math.round(start * 1000)
    const endMs = message.offsetMs + Math.min(durationMs, Math.round((end ?? durationMs / 1000) * 1000))
    return endMs > startMs ? [{ startMs, endMs, text }] : []
  })
  const decoderLoop = recognized.length > 0 && likelyTranscriptionLoop(recognized.map(item => item.text).join(' '))
  const next = decoderLoop
    ? [{ startMs: recognized[0].startMs, endMs: recognized[recognized.length - 1].endMs, text: UNCERTAIN_TRANSCRIPT_PASSAGE }]
    : recognized.map(item => ({ ...item, text: cleanWhisperPassage(item.text).text }))
  cleanedPassages += decoderLoop ? 1 : recognized.filter(item => cleanWhisperPassage(item.text).changed).length
  passages.push(...next)
  self.postMessage({ type: 'progress', completedMs: message.offsetMs + durationMs, passages: next })
}

self.onmessage = (event: MessageEvent<Input>) => {
  const message = event.data
  if (message.type === 'start') {
    passages = []; cleanedPassages = 0; failed = false; queue = Promise.resolve()
    void model().then(() => self.postMessage({ type: 'ready' })).catch(error => {
      failed = true; self.postMessage({ type: 'error', message: 'Le modèle de transcription du navigateur est indisponible.', detail: `${error instanceof Error ? error.message.slice(0, 300) : 'Erreur de chargement inconnue.'} Ressource : ${failedResource}. Fichiers en cours : ${[...loadingFiles].join(', ').slice(0, 400)}` })
    })
    return
  }
  queue = queue.then(async () => {
    if (failed) return
    if (message.type === 'chunk') await transcribe(message)
    if (message.type === 'finish') self.postMessage({ type: 'complete', transcript: passages.map(item => item.text).join(' ').trim(), passages, cleanedPassages })
  }).catch(() => {
    failed = true
    self.postMessage({ type: 'error', message: 'La transcription locale a échoué. Aucun audio n’a été envoyé au serveur.' })
  })
}
