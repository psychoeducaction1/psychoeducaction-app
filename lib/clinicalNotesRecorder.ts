import { CLINICAL_AUDIO_MAX_BYTES } from '@/lib/clinicalNotesAi'

export const CLINICAL_RECORDING_MAX_SECONDS = 120
export type ClinicalRecordingMode = 'teams' | 'presentiel'
type DisplayOptions = DisplayMediaStreamOptions & { systemAudio: 'include'; windowAudio: 'window'; selfBrowserSurface: 'exclude'; surfaceSwitching: 'exclude' }
export type RecordingProgress = { seconds: number; microphone: number; teams: number }
export type ClinicalRecording = { stop: () => void; discard: () => void }
export type ClinicalRecordingEnvironment = {
  display: (options: DisplayOptions) => Promise<MediaStream>
  microphone: (mode: ClinicalRecordingMode) => Promise<MediaStream>
  context: () => AudioContext
  audioStream: (tracks: MediaStreamTrack[]) => MediaStream
  supports: (mime: string) => boolean
  recorder: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder
  now: () => number
}

export function clinicalRecordingSupported(mode: ClinicalRecordingMode = 'teams') {
  return typeof window !== 'undefined' && window.isSecureContext &&
    (mode === 'presentiel' || typeof navigator.mediaDevices?.getDisplayMedia === 'function') &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof AudioContext !== 'undefined' && typeof MediaRecorder !== 'undefined' &&
    MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
}

function browserEnvironment(mode: ClinicalRecordingMode): ClinicalRecordingEnvironment {
  if (!clinicalRecordingSupported(mode)) throw new Error('Ouvrez la plateforme en HTTPS dans Chrome ou Edge sur ordinateur. Les fonctions audio nécessaires sont indisponibles ici.')
  return {
    display: options => navigator.mediaDevices.getDisplayMedia(options),
    microphone: selectedMode => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: selectedMode === 'teams', noiseSuppression: selectedMode === 'teams', autoGainControl: true }, video: false }),
    context: () => new AudioContext(), audioStream: tracks => new MediaStream(tracks),
    supports: mime => MediaRecorder.isTypeSupported(mime),
    recorder: (stream, options) => new MediaRecorder(stream, options), now: () => performance.now(),
  }
}

// Aucune requete, sauvegarde ou connexion aux haut-parleurs: tout reste en memoire.
// L'appel doit partir du clic utilisateur, avant toute attente asynchrone.
export async function startClinicalRecording(options: {
  mode?: ClinicalRecordingMode
  signal: AbortSignal
  onProgress: (progress: RecordingProgress) => void
  onComplete: (file: File, reason: string) => void
  onError: (message: string) => void
}, environment?: ClinicalRecordingEnvironment): Promise<ClinicalRecording> {
  const mode = options.mode ?? 'teams'
  if (mode !== 'teams' && mode !== 'presentiel') throw new Error('Choisissez Présentiel ou Teams.')
  const env = environment ?? browserEnvironment(mode)
  const streams = new Set<MediaStream>()
  const nodes: AudioNode[] = []
  const listeners: Array<() => void> = []
  let context: AudioContext | undefined
  let recorder: MediaRecorder | undefined
  let interval: ReturnType<typeof setInterval> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let chunks: Blob[] = []
  let bytes = 0
  let discarded = false
  let finished = false
  let stopping = false
  let reason = 'Enregistrement arrêté.'
  const stopTracks = () => {
    for (const remove of listeners.splice(0)) remove()
    for (const stream of streams) for (const track of stream.getTracks()) track.stop()
    streams.clear()
    for (const node of nodes.splice(0)) node.disconnect()
    if (context) { void context.close().catch(() => {}); context = undefined }
    clearInterval(interval); clearTimeout(deadline)
  }
  const dispose = () => { stopTracks(); options.signal.removeEventListener('abort', discard) }
  const stop = () => {
    if (stopping || finished) return
    stopping = true
    // Le dernier chunk est produit par stop; on attend onstop avant d'assembler.
    if (recorder?.state !== 'inactive' && recorder) recorder.stop()
    stopTracks()
  }
  const discard = () => {
    discarded = true; chunks = []
    stop(); dispose()
  }
  const requireActive = () => {
    if (options.signal.aborted || discarded) throw new DOMException('Annulé', 'AbortError')
  }
  const acquire = async (pending: Promise<MediaStream>) => {
    const stream = await pending
    streams.add(stream)
    requireActive()
    return stream
  }
  const watch = (track: MediaStreamTrack) => {
    const ended = () => { reason = 'Une source audio ou le partage a été interrompu. Vérifiez l’extrait avant de continuer.'; stop() }
    track.addEventListener('ended', ended)
    listeners.push(() => track.removeEventListener('ended', ended))
  }
  options.signal.addEventListener('abort', discard, { once: true })
  try {
    requireActive()
    if (!env.supports('audio/webm;codecs=opus')) throw new Error('Ce navigateur ne permet pas cet enregistrement audio. Utilisez Chrome ou Edge sur ordinateur.')
    let display: MediaStream | undefined
    if (mode === 'teams') {
      display = await acquire(env.display({ video: true, audio: true, systemAudio: 'include', windowAudio: 'window', selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude' }))
      if (!display.getAudioTracks().some(track => track.readyState === 'live')) {
        throw new Error('Le son de Teams n’est pas partagé. Recommencez et activez « Partager l’audio ». Si cette option manque pour la fenêtre Teams, choisissez l’écran entier avec son audio.')
      }
      for (const track of display.getTracks()) watch(track)
    }
    const microphone = await acquire(env.microphone(mode))
    if (stopping || !microphone.getAudioTracks().some(track => track.readyState === 'live') || (display && !display.getAudioTracks().some(track => track.readyState === 'live'))) {
      throw new Error(mode === 'teams' ? 'Une source audio a été interrompue. Recommencez l’essai avec le micro et le son de Teams.' : 'Le micro est indisponible ou a été interrompu. Vérifiez son accès avant de recommencer.')
    }
    for (const track of microphone.getTracks()) watch(track)
    context = env.context()
    await context.resume()
    requireActive()
    if (stopping) throw new Error('Le partage a été interrompu avant l’enregistrement.')
    const output = context.createMediaStreamDestination()
    streams.add(output.stream)
    const attach = (stream: MediaStream) => {
      const source = context!.createMediaStreamSource(env.audioStream(stream.getAudioTracks()))
      const gain = context!.createGain()
      gain.gain.value = mode === 'teams' ? 0.5 : 1
      const analyser = context!.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser); analyser.connect(gain); gain.connect(output)
      nodes.push(source, analyser, gain)
      return analyser
    }
    const microphoneMeter = attach(microphone)
    const teamsMeter = display ? attach(display) : null
    const level = (analyser: AnalyserNode) => {
      const samples = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(samples)
      return Math.min(100, Math.round(Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length) * 400))
    }
    recorder = env.recorder(output.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64_000 })
    recorder.ondataavailable = event => {
      if (discarded || finished || !event.data.size) return
      bytes += event.data.size
      if (bytes > CLINICAL_AUDIO_MAX_BYTES) {
        discarded = true; chunks = []; stop(); dispose()
        options.onError('Extrait trop volumineux. Il a été écarté ; recommencez un essai plus court.')
      } else chunks.push(event.data)
    }
    recorder.onerror = () => {
      if (discarded || finished) return
      discard(); options.onError('L’enregistrement a échoué. Aucun extrait n’a été envoyé.')
    }
    recorder.onstop = () => {
      if (finished) return
      finished = true; dispose()
      if (discarded) return
      if (!bytes) { options.onError('Aucun audio enregistré. Vérifiez les sources audio avant de recommencer.'); return }
      const file = new File(chunks, `exercice-${mode}-fictif.webm`, { type: 'audio/webm' })
      chunks = []
      options.onComplete(file, reason)
    }
    const started = env.now()
    recorder.start(250)
    interval = setInterval(() => options.onProgress({ seconds: Math.min(CLINICAL_RECORDING_MAX_SECONDS, Math.floor((env.now() - started) / 1000)), microphone: level(microphoneMeter), teams: teamsMeter ? level(teamsMeter) : 0 }), 250)
    deadline = setTimeout(() => { reason = 'Limite de deux minutes atteinte. L’enregistrement a été arrêté.'; stop() }, CLINICAL_RECORDING_MAX_SECONDS * 1000)
    return { stop, discard }
  } catch (error) {
    discard()
    throw error
  }
}
