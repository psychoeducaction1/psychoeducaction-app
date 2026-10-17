'use client'

import { useEffect, useRef, useState } from 'react'
import { buttonClass } from '@/components/ui/index'
import { clinicalRecordingSupported, startClinicalRecording } from '@/lib/clinicalNotesRecorder'
import type { ClinicalRecording, ClinicalRecordingMode, RecordingProgress } from '@/lib/clinicalNotesRecorder'

export default function ClinicalNotesRecorder({ disabled, onRecorded, onRecordingChange }: {
  disabled: boolean
  onRecorded: (file: File, mode: ClinicalRecordingMode) => void
  onRecordingChange: (active: boolean) => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'recording' | 'stopping'>('idle')
  const [progress, setProgress] = useState<RecordingProgress>({ seconds: 0, microphone: 0, teams: 0 })
  const [message, setMessage] = useState('')
  const [supported, setSupported] = useState(false)
  const [mode, setMode] = useState<ClinicalRecordingMode>('presentiel')
  const captureRef = useRef<ClinicalRecording | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => { setSupported(clinicalRecordingSupported(mode)) }, [mode])
  useEffect(() => () => { abortRef.current?.abort(); captureRef.current?.discard() }, [])

  const finish = (controller: AbortController) => {
    if (abortRef.current !== controller || controller.signal.aborted) return false
    captureRef.current = null; abortRef.current = null
    setPhase('idle'); onRecordingChange(false)
    return true
  }
  async function start() {
    if (!confirmed || disabled || abortRef.current) return
    const controller = new AbortController()
    abortRef.current = controller
    setMessage(''); setProgress({ seconds: 0, microphone: 0, teams: 0 }); setPhase('preparing'); onRecordingChange(true)
    try {
      const capture = await startClinicalRecording({
        mode,
        signal: controller.signal,
        onProgress: value => { if (!controller.signal.aborted) setProgress(value) },
        onComplete: (file, reason) => {
          if (finish(controller)) { onRecorded(file, mode); setMessage(`${reason} Réécoutez l’extrait et vérifiez toutes les voix avant de l’envoyer.`) }
        },
        onError: error => { if (finish(controller)) setMessage(error) },
      })
      if (controller.signal.aborted || abortRef.current !== controller) { capture.discard(); return }
      captureRef.current = capture; setPhase('recording')
    } catch (error) {
      if (!finish(controller)) return
      const name = error instanceof Error ? error.name : ''
      setMessage(name === 'NotAllowedError' || name === 'AbortError' ? 'Accès refusé ou sélection annulée. Rien n’a été enregistré ni envoyé.'
        : error instanceof Error ? error.message : 'Impossible de démarrer. Vérifiez le micro et le partage audio.')
    }
  }
  function discard() {
    abortRef.current?.abort(); captureRef.current?.discard()
    abortRef.current = null; captureRef.current = null
    setPhase('idle'); onRecordingChange(false); setMessage('Essai annulé. Aucun nouvel audio conservé ou envoyé.')
  }
  const active = phase !== 'idle'
  const presentiel = mode === 'presentiel'
  const meters = presentiel ? [['Micro de la pièce', progress.microphone]] as const : [['Votre micro', progress.microphone], ['Son partagé de Teams', progress.teams]] as const
  return <div className="space-y-4 rounded-xl border border-[#dfd0bf] bg-[#fbf6ef] p-4">
    <h3 className="font-semibold">Enregistrer une rencontre fictive</h3>
    <label className="block space-y-2 text-sm font-medium">Mode de rencontre
      <select value={mode} disabled={disabled || active} className="block w-full min-w-0 rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm" onChange={event => {
        const value = event.target.value
        if (value === 'teams' || value === 'presentiel') { setMode(value); setConfirmed(false); setMessage('') }
      }}>
        <option value="presentiel">Présentiel — micro de la pièce</option>
        <option value="teams">Teams — micro et son partagé</option>
      </select>
    </label>
    <p className="text-sm leading-6">{presentiel ? 'En présentiel, le micro de l’ordinateur ou un micro externe capte les voix dans la pièce. Placez-le pour entendre tous les participants fictifs.' : 'Ouvrez la plateforme dans Chrome ou Edge sur ordinateur et lancez votre appel d’exercice dans Teams. Utilisez un casque.'} Cet essai s’arrête après deux minutes.</p>
    <ol className="list-decimal space-y-1 pl-5 text-sm leading-6">
      {presentiel ? <>
        <li>Autorisez le micro. Aucun partage d’écran n’est demandé.</li>
        <li>Faites parler chaque participant fictif et vérifiez l’indicateur du micro.</li>
      </> : <>
        <li>Choisissez la fenêtre Teams avec son audio. Si l’option manque, choisissez l’écran entier et activez « Partager l’audio ».</li>
        <li>Autorisez votre micro, puis faites parler les participants fictifs. Vérifiez les deux indicateurs.</li>
      </>}
      <li>Arrêtez, réécoutez, puis choisissez séparément d’envoyer l’audio à l’IA.</li>
    </ol>
    <p className="text-xs leading-5 text-[#7a6859]">{presentiel ? 'Seul le micro est capté. Évitez les bruits de fond et vérifiez à la réécoute que toutes les voix sont audibles. L’audio reste dans cet onglet jusqu’à votre choix de l’envoyer à l’IA.' : 'Le navigateur demande un partage d’écran pour accéder au son. Seul l’audio est enregistré ; aucune image n’est conservée ou envoyée. Le son partagé peut inclure les autres applications : fermez-les et coupez les notifications. Aucune capture n’est transmise aux participants Teams par cet outil.'}</p>
    {!supported && <p role="status" className="text-sm">Capture audio indisponible dans ce navigateur. Utilisez Chrome ou Edge sur ordinateur, ou importez un fichier fictif ci-dessous.</p>}
    <label className="flex items-start gap-3 text-sm leading-6">
      <input type="checkbox" checked={confirmed} disabled={disabled || active} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#8a5633]" />
      Cette rencontre est un exercice entièrement fictif. Tous les participants acceptent son enregistrement ; aucune information réelle n’est présente dans l’environnement sonore.
    </label>
    {phase === 'idle' ? <button className={buttonClass('secondary')} disabled={disabled || !confirmed || !supported} onClick={() => void start()}>{presentiel ? 'Démarrer avec le micro' : 'Choisir le son de Teams et démarrer'}</button>
      : <div className="space-y-3">
        <p role="status" className="font-medium">{phase === 'preparing' ? (presentiel ? 'Autorisez le micro de la pièce…' : 'Choisissez la source audio, puis autorisez le micro…') : phase === 'stopping' ? 'Arrêt de l’enregistrement…' : `Enregistrement en cours · ${Math.floor(progress.seconds / 60)}:${String(progress.seconds % 60).padStart(2, '0')} / 2:00`}</p>
        {phase === 'recording' && <div className="grid gap-3 sm:grid-cols-2">
          {meters.map(([label, value]) => <label key={label} className="space-y-1 text-sm">{label}<meter aria-label={label} className="block h-4 w-full" min={0} max={100} value={value} /></label>)}
          <p className="text-xs sm:col-span-2">Un indicateur immobile pendant que la personne parle peut signaler une mauvaise source. Arrêtez et vérifiez l’extrait.</p>
        </div>}
        <div className="flex flex-wrap gap-3">
          {phase === 'recording' && <button className={buttonClass('primary')} onClick={() => { setPhase('stopping'); captureRef.current?.stop() }}>Arrêter et réécouter</button>}
          <button className={buttonClass('secondary')} onClick={discard}>Annuler l’enregistrement</button>
        </div>
      </div>}
    {message && <p role="status" className="text-sm leading-6">{message}</p>}
  </div>
}
