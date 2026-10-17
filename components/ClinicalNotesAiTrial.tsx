'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { AlertBanner, buttonClass, SectionCard } from '@/components/ui/index'
import { CLINICAL_AUDIO_MAX_BYTES, CLINICAL_TRANSCRIPT_MAX_CHARS } from '@/lib/clinicalNotesAi'
import ClinicalNotesRecorder from '@/components/ClinicalNotesRecorder'
import ClinicalNoteEditor from '@/components/ClinicalNoteEditor'
import { CLINICAL_NOTE_TEMPLATES, getClinicalNoteTemplate, isClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import { CLINICAL_CONTEXT_MAX_CHARS, canValidateClinicalDraft, clinicalSourceSnapshot, formatClinicalEngineNote, parseClinicalEngineResult, retainClinicalVersion } from '@/lib/clinicalNoteEngine'
import type { ClinicalEngineResult, ClinicalSources, ClinicalWorkingVersion } from '@/lib/clinicalNoteEngine'
import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import type { ClinicalRecordingMode } from '@/lib/clinicalNotesRecorder'

type WorkingNote = { result: ClinicalEngineResult; sources: ClinicalSources; original: string; snapshot: string; edited: boolean }
const reviewLabels = [
  'J’ai comparé chaque rubrique aux sources, confirmé les locuteurs et corrigé les erreurs ou omissions.',
  'J’ai vérifié les interventions, réactions, observations, hypothèses, scores éventuels et le champ d’exercice. Aucun fait n’a été ajouté sans fondement.',
  'J’ai examiné les alertes, contradictions et propos préoccupants; aucune évaluation du risque ni aucun consentement ne sont déduits du silence.',
]

export default function ClinicalNotesAiTrial({ enabled }: { enabled: boolean }) {
  const [file, setFile] = useState<File | null>(null)
  const [fictional, setFictional] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [original, setOriginal] = useState('')
  const [history, setHistory] = useState('')
  const [sameCase, setSameCase] = useState(false)
  const [metadata, setMetadata] = useState('')
  const [metadataConfirmed, setMetadataConfirmed] = useState(false)
  const [work, setWork] = useState<WorkingNote | null>(null)
  const [versions, setVersions] = useState<ClinicalWorkingVersion[]>([])
  const [checks, setChecks] = useState([false, false, false])
  const [validated, setValidated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [recording, setRecording] = useState(false)
  const [recordedMode, setRecordedMode] = useState<ClinicalRecordingMode | null>(null)
  const [listened, setListened] = useState(false)
  const [audioUrl, setAudioUrl] = useState('')
  const [noteType, setNoteType] = useState<ClinicalNoteType | ''>('')
  const abortRef = useRef<AbortController | null>(null)
  const sequenceRef = useRef(0)
  const copyRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const sources: ClinicalSources = { transcript, history, metadata }
  const snapshot = clinicalSourceSnapshot(noteType, sources)
  const stale = Boolean(work && work.snapshot !== snapshot)
  const locked = busy || recording
  const sourcePermissions = fictional && (!history.trim() || sameCase) && (!metadata.trim() || metadataConfirmed)
  const canGenerate = Boolean(noteType && fictional && transcript.trim() && (!history.trim() || sameCase) && (!metadata.trim() || metadataConfirmed))
  const noteText = work ? formatClinicalEngineNote(work.result.noteType, work.result.draft.sections) : ''
  useEffect(() => () => { abortRef.current?.abort() }, [])
  useEffect(() => {
    if (!file || !recordedMode) { setAudioUrl(''); return }
    const url = URL.createObjectURL(file)
    setAudioUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file, recordedMode])

  function invalidate() { setChecks([false, false, false]); setValidated(false); setMessage('') }
  function archive(current: WorkingNote, label: string) {
    const version = { id: ++sequenceRef.current, label, result: current.result, sources: current.sources, original: current.original, snapshot: current.snapshot }
    setVersions(previous => retainClinicalVersion(previous, version))
  }
  function selectAudio(selected: File | null, mode: ClinicalRecordingMode | null) {
    if (mode && fileRef.current) fileRef.current.value = ''
    setFile(selected); setRecordedMode(mode); setListened(false); setFictional(false)
    invalidate()
    setMessage(selected && (selected.size > CLINICAL_AUDIO_MAX_BYTES || !selected.size) ? 'Choisissez un fichier non vide de moins de 3 Mo.' : work ? 'Audio changé. Votre brouillon est conservé; transcrivez puis régénérez explicitement pour utiliser ce nouvel audio.' : '')
  }
  async function run(action: 'transcribe' | 'generate') {
    if (locked || !enabled || !noteType || !fictional || (action === 'generate' && !canGenerate) || (action === 'transcribe' && recordedMode && !listened)) return
    if (action === 'transcribe' && transcript && !window.confirm('Remplacer la transcription de travail par celle de cet audio ? Le brouillon actuel sera conservé et devra être revérifié.')) return
    setBusy(true); setMessage('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Reconnectez-vous pour continuer.')
      const headers: Record<string, string> = { Authorization: `Bearer ${session.access_token}` }
      let body: FormData | string
      if (action === 'transcribe') {
        if (!file || file.size > CLINICAL_AUDIO_MAX_BYTES || !file.size) throw new Error('Choisissez un court fichier audio de moins de 3 Mo.')
        const form = new FormData()
        form.set('fictional', 'true'); form.set('audio', file); body = form
      } else {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify({ formatVersion: 2, fictional: true, ...sources, noteType, sameFictionalCase: sameCase, metadataConfirmed })
      }
      const response = await fetch('/api/prise-de-notes/essai', { method: 'POST', headers, body, signal: controller.signal, cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'L’essai n’a pas pu être terminé.')
      if (action === 'transcribe') {
        if (typeof payload.transcript !== 'string' || !payload.transcript.trim() || payload.transcript.length > CLINICAL_TRANSCRIPT_MAX_CHARS) throw new Error('Transcription invalide.')
        setOriginal(payload.transcript); setTranscript(payload.transcript)
      } else {
        const result = parseClinicalEngineResult(payload, sources)
        if (!result || result.noteType !== noteType) throw new Error('Brouillon ou références invalides. Votre travail est conservé.')
        if (work) archive(work, work.edited ? 'Brouillon avec corrections manuelles' : 'Brouillon précédent')
        if (!original) setOriginal(transcript)
        setWork({ result, sources: { ...sources }, original: original || transcript, snapshot, edited: false })
      }
      invalidate()
      setMessage(action === 'transcribe' ? 'Transcription prête. Corrigez-la et confirmez les attributions avant de rédiger.' : 'Brouillon prêt : comparez-le aux passages sources et examinez les alertes. La vérification automatique ne remplace pas votre jugement clinique.')
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Service indisponible. Votre travail est conservé.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  return <SectionCard title="Essai IA — consultation fictive" description="Enregistrer, vérifier les sources, corriger les rubriques et valider le brouillon.">
    {!enabled ? <AlertBanner title="Configuration en cours" tone="neutral" description="L’envoi reste bloqué jusqu’à l’activation de la clé côté serveur." /> : <div className="min-w-0 space-y-5">
      <p className="text-sm leading-6 text-[#7a6859]">Pilote réservé aux deux comptes : données entièrement fictives. Audio de 120 secondes maximum, moins de 3 Mo. Chaque envoi consomme des crédits OpenAI. La rédaction effectue trois étapes : analyse, rédaction et contrôle de fidélité, sans relance automatique. Aucun entraînement à partir de vos corrections. Sources, brouillons et cinq dernières versions restent uniquement dans cet onglet et disparaissent à sa fermeture ou à l’actualisation.</p>
      <label className="block text-sm font-semibold" htmlFor="ai-note-type">Type de note à préparer</label>
      <select id="ai-note-type" value={noteType} disabled={locked} className="block w-full min-w-0 rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm" onChange={event => { setNoteType(isClinicalNoteType(event.target.value) ? event.target.value : ''); invalidate() }}>
        <option value="">Choisir le type avant l’enregistrement</option>
        {CLINICAL_NOTE_TEMPLATES.map(template => <option key={template.id} value={template.id}>{template.label}</option>)}
      </select>
      <p className="text-sm text-[#7a6859]">{noteType ? getClinicalNoteTemplate(noteType).description : 'Sept modèles disponibles.'} Changer le type conserve le brouillon; la régénération reste volontaire.</p>
      <ClinicalNotesRecorder disabled={busy || !noteType} onRecorded={selectAudio} onRecordingChange={value => { setRecording(value); if (value) invalidate() }} />
      <label className="block space-y-2 text-sm font-medium">Ou importer un audio fictif<input ref={fileRef} type="file" accept=".wav,.mp3,.m4a,.webm" disabled={locked || !noteType} className="block w-full min-w-0 rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm" onChange={event => selectAudio(event.target.files?.[0] ?? null, null)} /></label>
      {recordedMode && audioUrl && <div className="space-y-3 rounded-xl border border-[#dfd0bf] p-4">
        <p className="text-sm font-medium">Écoute de contrôle — {recordedMode === 'presentiel' ? 'présentiel' : 'Teams'} fictif</p>
        {!recording && <audio controls src={audioUrl} aria-label="Réécouter la rencontre fictive" className="w-full" />}
        <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={listened} disabled={locked} className="mt-1 h-4 w-4 shrink-0" onChange={event => setListened(event.target.checked)} />J’ai réécouté : toutes les voix fictives sont audibles et aucun autre contenu n’a été capté.</label>
        <button className={buttonClass('secondary')} disabled={locked} onClick={() => { if (fileRef.current) fileRef.current.value = ''; selectAudio(null, null) }}>Effacer l’audio (conserver le travail écrit)</button>
      </div>}
      <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" disabled={locked} checked={fictional} className="mt-1 h-4 w-4 shrink-0" onChange={event => { setFictional(event.target.checked); invalidate() }} />Je confirme que toutes les sources sont fictives, sans renseignements d’un vrai client, et j’accepte leur envoi à OpenAI pour cet exercice.</label>
      <button className={buttonClass('primary')} disabled={locked || !noteType || !fictional || (Boolean(recordedMode) && !listened) || !file || !file.size || file.size > CLINICAL_AUDIO_MAX_BYTES} onClick={() => void run('transcribe')}>Envoyer l’audio fictif pour transcription</button>
      <div className="space-y-3">
        {original && <details className="text-sm"><summary className="cursor-pointer font-medium">Transcription originale (conservée séparément dans cet onglet)</summary><p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-[#fbf6ef] p-3">{original}</p></details>}
        <label htmlFor="ai-trial-transcript" className="block text-sm font-medium">Transcription à vérifier — ou coller un échange fictif</label>
        <textarea id="ai-trial-transcript" className="min-h-56 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm leading-6" disabled={locked || !noteType} value={transcript} maxLength={CLINICAL_TRANSCRIPT_MAX_CHARS} onChange={event => { setTranscript(event.target.value); invalidate() }} />
        <p className="text-xs text-[#7a6859]">Identifiez les locuteurs seulement si vous pouvez les confirmer. Les interventions et observations non dites ne doivent pas être ajoutées.</p>
        <details className="rounded-xl border border-[#dfd0bf] p-4"><summary className="cursor-pointer text-sm font-medium">Contexte antérieur et renseignements confirmés (facultatifs)</summary>
          <div className="mt-3 space-y-3">
            <label className="block text-sm">Notes antérieures fictives du même dossier<textarea value={history} maxLength={CLINICAL_CONTEXT_MAX_CHARS} disabled={locked} className="mt-2 min-h-28 w-full rounded-xl border border-[#dfd0bf] bg-white p-3" onChange={event => { setHistory(event.target.value); setSameCase(false); invalidate() }} /></label>
            <label className="flex gap-3 text-sm"><input type="checkbox" checked={sameCase} disabled={locked} onChange={event => { setSameCase(event.target.checked); invalidate() }} />Ce contexte est autorisé et concerne uniquement le même dossier fictif.</label>
            <label className="block text-sm">Renseignements administratifs confirmés (ex. personnes présentes, milieu, date et durée)<textarea value={metadata} maxLength={2_000} disabled={locked} className="mt-2 min-h-24 w-full rounded-xl border border-[#dfd0bf] bg-white p-3" onChange={event => { setMetadata(event.target.value); setMetadataConfirmed(false); invalidate() }} /></label>
            <label className="flex gap-3 text-sm"><input type="checkbox" checked={metadataConfirmed} disabled={locked} onChange={event => { setMetadataConfirmed(event.target.checked); invalidate() }} />J’ai vérifié ces renseignements fictifs; ils sont distincts de la transcription.</label>
          </div>
        </details>
        {work && <p className="text-xs text-[#7a6859]">Régénérer archive le brouillon courant avant de le remplacer, uniquement si le nouvel essai réussit. Vos corrections ne sont pas reprises automatiquement par l’IA.</p>}
        <button className={buttonClass('primary')} disabled={locked || !canGenerate} onClick={() => void run('generate')}>{work ? 'Régénérer explicitement une nouvelle version' : 'Analyser et rédiger le brouillon fictif'}</button>
      </div>
      {work && <div className="min-w-0 space-y-5 border-t border-[#dfd0bf] pt-5">
        <h3 className="font-semibold">Brouillon — {getClinicalNoteTemplate(work.result.noteType).label}{work.edited ? ' · corrigé manuellement' : ''}</h3>
        {stale && <AlertBanner tone="neutral" title="Sources ou type modifiés" description="Ce brouillon et vos corrections sont conservés. Régénérez explicitement pour utiliser les nouvelles sources; validation et copie sont bloquées entre-temps." />}
        <div className="space-y-3 rounded-xl border border-[#dfd0bf] bg-[#fbf6ef] p-4">
          <h4 className="font-semibold">À revoir — hors du texte clinique</h4>
          <p className="text-xs leading-5">La détection automatique peut manquer des éléments. Les indicateurs prioritaires ne constituent ni une évaluation du risque ni un protocole clinique approuvé.</p>
          {[...work.result.draft.alerts].sort((a, b) => Number(b.priority === 'prioritaire') - Number(a.priority === 'prioritaire')).map((alert, index) => <div key={index} className={alert.priority === 'prioritaire' ? 'rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900' : 'text-sm leading-6'}><strong>{alert.priority === 'prioritaire' ? 'Révision prioritaire · ' : ''}{alert.category.replaceAll('_', ' ')}</strong> — {alert.text}{alert.factIds.length > 0 && <span className="block text-xs">Références : {alert.factIds.join(', ')}</span>}</div>)}
          {!work.result.draft.alerts.length && <p className="text-sm">Aucune alerte retournée; relecture complète toujours nécessaire.</p>}
        </div>
        <ClinicalNoteEditor result={work.result} disabled={locked || validated} onChange={sections => { setWork({ ...work, edited: true, result: { ...work.result, draft: { ...work.result.draft, sections } } }); invalidate() }} />
        {!validated ? <div className="space-y-3">{reviewLabels.map((label, index) => <label key={label} className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" disabled={locked || stale} checked={checks[index]} onChange={event => setChecks(checks.map((value, i) => i === index ? event.target.checked : value))} />{label}</label>)}
          <button className={buttonClass('primary')} disabled={locked || !canValidateClinicalDraft(stale || !sourcePermissions, work.result.draft.sections, checks)} onClick={() => { archive(work, 'Version relue pour l’exercice'); setValidated(true); setMessage('Version validée uniquement pour l’exercice fictif. Aucun dépôt PsyLog.') }}>Valider pour l’exercice</button>
        </div> : <div className="space-y-3">
          <button className={buttonClass('secondary')} disabled={locked} onClick={invalidate}>Reprendre la correction</button>
          <label className="block text-sm font-medium">Texte clinique prêt à copier — sans alertes<textarea ref={copyRef} readOnly value={noteText} className="mt-2 min-h-64 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm leading-6" /></label>
          <button className={buttonClass('primary')} disabled={locked || stale || !sourcePermissions} onClick={async () => {
            let timeout: ReturnType<typeof setTimeout> | undefined
            try {
              await Promise.race([navigator.clipboard.writeText(noteText), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Copie indisponible')), 1500) })])
              setMessage('Note fictive copiée, sans les alertes de révision. Aucun dépôt dans PsyLog.')
            } catch { copyRef.current?.focus(); copyRef.current?.select(); setMessage('Copie automatique indisponible. Copiez manuellement le texte sélectionné, entièrement fictif.') }
            finally { clearTimeout(timeout) }
          }}>Copier la note fictive validée</button>
        </div>}
      </div>}
      {versions.length > 0 && <details className="rounded-xl border border-[#dfd0bf] p-4"><summary className="cursor-pointer text-sm font-medium">Versions de travail de cet onglet ({versions.length}/5)</summary><p className="my-3 text-xs">Mémoire temporaire uniquement. Restaurer remet le brouillon et ses sources; aucune validation précédente n’est réutilisée.</p><div className="space-y-3">{versions.map(version => <div key={version.id} className="flex flex-wrap items-center gap-3 text-sm"><span>Version {version.id} — {version.label} · {getClinicalNoteTemplate(version.result.noteType).label}</span><button className={buttonClass('secondary')} disabled={locked} onClick={() => {
        if (work) archive(work, 'Avant restauration')
        const restored = structuredClone(version)
        setWork({ result: restored.result, sources: restored.sources, original: restored.original, snapshot: restored.snapshot, edited: true }); setOriginal(restored.original); setTranscript(restored.sources.transcript); setHistory(restored.sources.history); setMetadata(restored.sources.metadata); setNoteType(restored.result.noteType); setSameCase(false); setMetadataConfirmed(false); invalidate()
        setMessage('Version restaurée et travail précédent archivé. Revérifiez les sources et reconfirmez le contexte antérieur ou les renseignements administratifs avant validation.')
      }}>Restaurer la version {version.id}</button></div>)}</div></details>}
      {busy && <p role="status" className="text-sm">Traitement en cours… Les étapes s’exécutent sans relance automatique. Votre brouillon précédent reste conservé en cas d’échec.</p>}
      {message && <p role="status" className="rounded-xl border border-[#dfd0bf] bg-[#fbf6ef] p-4 text-sm leading-6">{message}</p>}
      <button className={buttonClass('secondary')} disabled={locked} onClick={() => {
        if (!window.confirm('Effacer toutes les sources, les brouillons et les versions de cet essai dans cet onglet ?')) return
        if (fileRef.current) fileRef.current.value = ''
        setFile(null); setRecordedMode(null); setListened(false); setFictional(false); setTranscript(''); setOriginal(''); setHistory(''); setMetadata(''); setSameCase(false); setMetadataConfirmed(false); setWork(null); setVersions([]); invalidate()
      }}>Effacer tout l’essai fictif</button>
    </div>}
  </SectionCard>
}
