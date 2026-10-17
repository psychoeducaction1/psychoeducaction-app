import test from 'node:test'
import assert from 'node:assert/strict'
import { startClinicalRecording } from '@/lib/clinicalNotesRecorder'
import type { ClinicalRecordingEnvironment } from '@/lib/clinicalNotesRecorder'
import { CLINICAL_AUDIO_MAX_BYTES } from '@/lib/clinicalNotesAi'

class Track extends EventTarget {
  kind: string
  readyState = 'live'
  stops = 0
  constructor(kind: string) { super(); this.kind = kind }
  stop() { this.readyState = 'ended'; this.stops++ }
  end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')) }
}
function stream(tracks: Track[]) {
  return { getTracks: () => tracks, getAudioTracks: () => tracks.filter(track => track.kind === 'audio') } as unknown as MediaStream
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function fixture({ systemAudio = true } = {}) {
  const system = new Track('audio'), video = new Track('video'), mic = new Track('audio'), mixed = new Track('audio')
  const display = stream(systemAudio ? [system, video] : [video]), microphone = stream([mic]), output = stream([mixed])
  const inputs: MediaStream[] = []
  let closed = 0, micRequests = 0, recorders = 0
  const recorder = {
    state: 'inactive',
    ondataavailable: null as null | ((event: { data: Blob }) => void),
    onstop: null as null | (() => void), onerror: null as null | (() => void),
    start() { this.state = 'recording' },
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['last']) }); this.onstop?.() }) },
  }
  const node = () => ({ connect() {}, disconnect() {} })
  const context = {
    resume: async () => {}, close: async () => { closed++ },
    createMediaStreamDestination: () => ({ ...node(), stream: output }),
    createMediaStreamSource: (input: MediaStream) => { inputs.push(input); return node() },
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createAnalyser: () => ({ ...node(), fftSize: 256, getByteTimeDomainData: (array: Uint8Array) => array.fill(132) }),
  }
  const env: ClinicalRecordingEnvironment = {
    display: async () => display,
    microphone: async () => { micRequests++; return microphone },
    context: () => context as unknown as AudioContext,
    audioStream: tracks => stream(tracks as unknown as Track[]), supports: () => true,
    recorder: (input, options) => {
      assert.equal(input, output)
      assert.equal(input.getTracks().every(track => track.kind === 'audio'), true)
      assert.equal(options.mimeType, 'audio/webm;codecs=opus')
      recorders++; return recorder as unknown as MediaRecorder
    }, now: () => 0,
  }
  const controller = new AbortController(), completed: Array<{ file: File; reason: string }> = [], errors: string[] = []
  const options = { signal: controller.signal, onProgress() {}, onComplete(file: File, reason: string) { completed.push({ file, reason }) }, onError(message: string) { errors.push(message) } }
  return { env, options, controller, completed, errors, recorder, tracks: [system, video, mic, mixed], inputs,
    display, microphone, context, counts: () => ({ closed, micRequests, recorders }) }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

test('capture audio seule, deux sources et dernier chunk inclus; toutes les pistes sont arretees', async () => {
  const f = fixture()
  const capture = await startClinicalRecording(f.options, f.env)
  assert.equal(f.inputs.length, 2)
  assert.equal(f.inputs.every(input => input.getTracks().every(track => track.kind === 'audio')), true)
  f.recorder.ondataavailable?.({ data: new Blob(['first']) })
  capture.stop(); capture.stop()
  await flush()
  assert.equal(f.completed.length, 1)
  assert.equal(await f.completed[0].file.text(), 'firstlast')
  assert.equal(f.completed[0].file.type, 'audio/webm')
  assert.ok(f.tracks.every(track => track.stops === 1))
  assert.equal(f.counts().closed, 1)
})

test('son Teams absent: refus avant acces au micro et aucune capture video conservee', async () => {
  const f = fixture({ systemAudio: false })
  await assert.rejects(startClinicalRecording(f.options, f.env), /son de Teams n’est pas partagé/)
  assert.equal(f.counts().micRequests, 0)
  assert.equal(f.counts().recorders, 0)
  assert.equal(f.tracks[1].stops, 1)
  assert.deepEqual(f.completed, [])
})

test('micro refuse: arret du partage deja autorise et aucune note/audio cree', async () => {
  const f = fixture()
  f.env.microphone = async () => { throw new DOMException('Refus', 'NotAllowedError') }
  await assert.rejects(startClinicalRecording(f.options, f.env), { name: 'NotAllowedError' })
  assert.equal(f.tracks[0].stops, 1); assert.equal(f.tracks[1].stops, 1)
  assert.deepEqual(f.completed, [])
})

test('fermeture pendant une permission en attente: liberer aussi la source obtenue tardivement', async () => {
  const f = fixture(), permission = deferred<MediaStream>()
  f.env.microphone = () => permission.promise
  const pending = startClinicalRecording(f.options, f.env)
  await flush()
  f.controller.abort()
  permission.resolve(f.microphone)
  await assert.rejects(pending, { name: 'AbortError' })
  assert.ok(f.tracks.slice(0, 3).every(track => track.stops === 1))
  assert.equal(f.counts().recorders, 0)
  assert.deepEqual(f.completed, [])
})

test('fermeture ou annulation active: aucun resultat ni callback tardif', async () => {
  const f = fixture()
  const capture = await startClinicalRecording(f.options, f.env)
  f.recorder.ondataavailable?.({ data: new Blob(['private fictional exercise']) })
  f.controller.abort(); capture.discard()
  await flush()
  assert.ok(f.tracks.every(track => track.stops === 1))
  assert.deepEqual(f.completed, []); assert.deepEqual(f.errors, [])
})

test('limite de deux minutes: arret automatique et extrait pret a reecouter', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const f = fixture()
  await startClinicalRecording(f.options, f.env)
  t.mock.timers.tick(120_000)
  await flush()
  assert.equal(f.completed.length, 1)
  assert.match(f.completed[0].reason, /deux minutes/)
  assert.ok(f.tracks.every(track => track.stops === 1))
})

test('depassement de taille y compris dernier chunk: ecarter le fichier, sans envoi', async () => {
  const f = fixture()
  const capture = await startClinicalRecording(f.options, f.env)
  f.recorder.ondataavailable?.({ data: new Blob([new Uint8Array(CLINICAL_AUDIO_MAX_BYTES)]) })
  capture.stop()
  await flush()
  assert.deepEqual(f.completed, [])
  assert.equal(f.errors.length, 1)
  assert.match(f.errors[0], /volumineux/)
  assert.ok(f.tracks.every(track => track.stops === 1))
})

test('arret du partage navigateur ou coupure micro: finaliser une seule fois et prevenir', async () => {
  for (const index of [0, 1, 2]) {
    const f = fixture()
    await startClinicalRecording(f.options, f.env)
    f.tracks[index].end()
    await flush()
    assert.equal(f.completed.length, 1)
    assert.match(f.completed[0].reason, /interrompu/)
    assert.ok(f.tracks.every(track => track.stops === 1))
  }
})

test('erreur du codec apres demarrage: liberer les sources et ne pas retourner un extrait partiel', async () => {
  const f = fixture()
  await startClinicalRecording(f.options, f.env)
  f.recorder.ondataavailable?.({ data: new Blob(['partial']) })
  f.recorder.onerror?.()
  await flush()
  assert.deepEqual(f.completed, [])
  assert.equal(f.errors.length, 1)
  assert.ok(f.tracks.every(track => track.stops === 1))
})

test('navigateur incompatible ou signal deja annule: aucune permission demandee', async () => {
  for (const aborted of [false, true]) {
    const f = fixture()
    let requests = 0
    f.env.display = async () => { requests++; return f.display }
    if (aborted) f.controller.abort()
    else f.env.supports = () => false
    await assert.rejects(startClinicalRecording(f.options, f.env))
    assert.equal(requests, 0)
    assert.equal(f.counts().micRequests, 0)
  }
})

test('presentiel: micro seul, aucun partage demande, fichier audio et fin de capture propres', async () => {
  const f = fixture()
  f.env.display = async () => { assert.fail('Le presentiel ne doit jamais demander un partage') }
  f.env.microphone = async mode => { assert.equal(mode, 'presentiel'); return f.microphone }
  const capture = await startClinicalRecording({ ...f.options, mode: 'presentiel' }, f.env)
  assert.equal(f.inputs.length, 1)
  assert.equal(f.inputs[0].getAudioTracks()[0], f.microphone.getAudioTracks()[0])
  f.recorder.ondataavailable?.({ data: new Blob(['room-audio']) })
  capture.stop()
  await flush()
  assert.equal(f.completed.length, 1)
  assert.equal(f.completed[0].file.name, 'exercice-presentiel-fictif.webm')
  assert.equal(await f.completed[0].file.text(), 'room-audiolast')
  assert.equal(f.tracks[0].stops, 0); assert.equal(f.tracks[1].stops, 0)
  assert.equal(f.tracks[2].stops, 1); assert.equal(f.tracks[3].stops, 1)
  assert.equal(f.counts().closed, 1)
})

test('presentiel: refus du micro ou micro sans piste audio ne demarre aucun enregistrement', async () => {
  for (const permissionRefused of [false, true]) {
    const f = fixture()
    f.env.display = async () => { assert.fail('Aucun repli sur un partage ecran') }
    f.env.microphone = async () => {
      if (permissionRefused) throw new DOMException('Refus fictif', 'NotAllowedError')
      return stream([])
    }
    await assert.rejects(startClinicalRecording({ ...f.options, mode: 'presentiel' }, f.env))
    assert.equal(f.counts().recorders, 0)
    assert.deepEqual(f.completed, [])
  }
})

test('presentiel: fermeture pendant permission micro en attente ou pendant capture libere tout', async () => {
  for (const pendingPermission of [false, true]) {
    const f = fixture(), permission = deferred<MediaStream>()
    f.env.display = async () => { assert.fail('Aucun partage ecran en presentiel') }
    if (pendingPermission) f.env.microphone = () => permission.promise
    const starting = startClinicalRecording({ ...f.options, mode: 'presentiel' }, f.env)
    if (pendingPermission) {
      f.controller.abort(); permission.resolve(f.microphone)
      await assert.rejects(starting, { name: 'AbortError' })
    } else {
      const capture = await starting
      f.controller.abort(); capture.discard()
    }
    await flush()
    assert.equal(f.tracks[2].stops, 1)
    assert.equal(f.tracks[0].stops, 0); assert.equal(f.tracks[1].stops, 0)
    assert.deepEqual(f.completed, [])
  }
})

test('presentiel: limite 120 secondes, un seul indicateur actif et coupure du micro signalee', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const f = fixture(), levels: Array<{ microphone: number; teams: number }> = []
  await startClinicalRecording({ ...f.options, mode: 'presentiel', onProgress: value => levels.push(value) }, f.env)
  t.mock.timers.tick(120_000)
  await flush()
  assert.equal(f.completed.length, 1)
  assert.match(f.completed[0].reason, /deux minutes/)
  assert.ok(levels.length > 0 && levels.every(value => value.microphone > 0 && value.teams === 0))
  assert.equal(f.tracks[2].stops, 1)
  const lost = fixture()
  await startClinicalRecording({ ...lost.options, mode: 'presentiel' }, lost.env)
  lost.tracks[2].end()
  await flush()
  assert.equal(lost.completed.length, 1)
  assert.match(lost.completed[0].reason, /interrompu/)
})

test('presentiel: depassement de taille ecarte le fichier entier comme en Teams', async () => {
  const f = fixture()
  await startClinicalRecording({ ...f.options, mode: 'presentiel' }, f.env)
  f.recorder.ondataavailable?.({ data: new Blob([new Uint8Array(CLINICAL_AUDIO_MAX_BYTES + 1)]) })
  await flush()
  assert.deepEqual(f.completed, [])
  assert.equal(f.errors.length, 1)
  assert.equal(f.tracks[2].stops, 1); assert.equal(f.tracks[3].stops, 1)
})
