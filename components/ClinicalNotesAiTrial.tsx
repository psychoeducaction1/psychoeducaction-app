'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { AlertBanner, buttonClass, SectionCard } from '@/components/ui/index'
import { CLINICAL_AUDIO_MAX_BYTES, CLINICAL_TRANSCRIPT_MAX_CHARS, formatClinicalNoteDraft, parseClinicalNoteDraft } from '@/lib/clinicalNotesAi'
import ClinicalNotesRecorder from '@/components/ClinicalNotesRecorder'
import { CLINICAL_NOTE_TEMPLATES, getClinicalNoteTemplate, isClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'

export default function ClinicalNotesAiTrial({ enabled }: { enabled: boolean }) {
  const [file, setFile] = useState<File | null>(null)
  const [fictional, setFictional] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [transcribed, setTranscribed] = useState(false)
  const [note, setNote] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [validated, setValidated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [recording, setRecording] = useState(false)
  const [recorded, setRecorded] = useState(false)
  const [listened, setListened] = useState(false)
  const [audioUrl, setAudioUrl] = useState('')
  const [noteType, setNoteType] = useState<ClinicalNoteType | ''>('')
  const abortRef = useRef<AbortController | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => () => { abortRef.current?.abort() }, [])
  useEffect(() => {
    if (!file || !recorded) { setAudioUrl(''); return }
    const url = URL.createObjectURL(file)
    setAudioUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file, recorded])

  function selectAudio(selected: File | null, captured: boolean) {
    if (captured && fileRef.current) fileRef.current.value = ''
    setFile(selected); setRecorded(captured); setListened(false)
    setFictional(false); setTranscript(''); setTranscribed(false); setNote(''); setReviewed(false); setValidated(false)
    setMessage(selected && (selected.size > CLINICAL_AUDIO_MAX_BYTES || !selected.size) ? 'Choisissez un fichier non vide de moins de 3 Mo.' : '')
  }

  async function run(action: 'transcribe' | 'generate') {
    if (busy || recording || !enabled || !noteType || !fictional || (action === 'transcribe' && recorded && !listened)) return
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
        if (!transcript.trim() || transcript.length > CLINICAL_TRANSCRIPT_MAX_CHARS) throw new Error('Vérifiez la transcription avant de continuer.')
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify({ fictional: true, transcript, noteType })
      }
      const response = await fetch('/api/prise-de-notes/essai', { method: 'POST', headers, body, signal: controller.signal, cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'L’essai n’a pas pu être terminé.')
      if (action === 'transcribe') {
        if (typeof payload.transcript !== 'string' || !payload.transcript.trim() || payload.transcript.length > CLINICAL_TRANSCRIPT_MAX_CHARS) throw new Error('Transcription invalide.')
        setTranscript(payload.transcript); setTranscribed(true); setNote('')
      } else {
        const draft = parseClinicalNoteDraft(payload.draft)
        if (!draft || payload.noteType !== noteType) throw new Error('Brouillon ou type de note inattendu. Réessayez.')
        setNote(formatClinicalNoteDraft(draft, noteType))
      }
      setReviewed(false); setValidated(false)
      setMessage(action === 'transcribe' ? 'Transcription prête. Corrigez-la avant de demander la note.' : 'Brouillon prêt. Relisez chaque information avec la transcription.')
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Service indisponible.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  return <SectionCard title="Essai IA — audio fictif" description="Un premier essai court, avec un envoi distinct pour la transcription et pour la note.">
    {!enabled ? <AlertBanner title="Configuration en cours" tone="neutral"
      description="Le projet API est en préparation. L’envoi de fichiers restera bloqué jusqu’à l’activation de la clé côté serveur." /> : <div className="space-y-5">
      <p className="text-sm leading-6 text-[#7a6859]">Utilisez un enregistrement joué pour l’exercice, idéalement de 1 à 3 minutes. WAV, MP3, M4A ou WebM, moins de 3 Mo. Chaque bouton envoie le contenu à OpenAI et consomme des crédits API. Aucun envoi automatique ni sauvegarde dans l’application. Fermer ce panneau efface l’essai.</p>
      <div className="space-y-2">
        <label htmlFor="ai-note-type" className="block text-sm font-semibold">Type de note à préparer</label>
        <select id="ai-note-type" value={noteType} disabled={busy || recording} aria-describedby="ai-note-type-help"
          className="block w-full min-w-0 rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm"
          onChange={event => {
            const selected = event.target.value
            setNoteType(isClinicalNoteType(selected) ? selected : '')
            setNote(''); setReviewed(false); setValidated(false)
            setMessage(transcribed ? 'Type modifié. La transcription est conservée ; générez un nouveau brouillon.' : '')
          }}>
          <option value="">Choisir le type avant l’enregistrement</option>
          {CLINICAL_NOTE_TEMPLATES.map(template => <option key={template.id} value={template.id}>{template.label}</option>)}
        </select>
        <p id="ai-note-type-help" className="text-sm leading-6 text-[#7a6859]">{noteType ? getClinicalNoteTemplate(noteType).description : 'Choisissez le modèle avant de capter ou d’importer votre audio fictif.'}</p>
        {noteType && <p className="text-xs leading-5 text-[#7a6859]">Un changement de type efface le brouillon et sa validation. L’audio et la transcription sont conservés. Les autres rencontres ne sont pas ajoutées automatiquement.</p>}
      </div>
      <ClinicalNotesRecorder disabled={busy || !noteType} onRecorded={selected => selectAudio(selected, true)} onRecordingChange={setRecording} />
      <label className="block space-y-2 text-sm font-medium">Ou importer un audio fictif
        <input ref={fileRef} type="file" accept=".wav,.mp3,.m4a,.webm" disabled={busy || recording || !noteType}
          className="block w-full min-w-0 rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#efe1d2] file:p-2"
          onChange={event => {
            const selected = event.target.files?.[0] ?? null
            selectAudio(selected, false)
          }} />
      </label>
      {recorded && audioUrl && <div className="space-y-3 rounded-xl border border-[#dfd0bf] p-4">
        <p className="text-sm font-medium">Écoute de contrôle de l’appel fictif</p>
        {!recording && <audio controls src={audioUrl} aria-label="Réécouter l’appel fictif" className="w-full" />}
        <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={listened} disabled={busy || recording} className="mt-1 h-4 w-4 shrink-0 accent-[#8a5633]" onChange={event => setListened(event.target.checked)} />J’ai réécouté l’extrait : les deux voix fictives sont audibles et aucun autre contenu n’a été capté.</label>
        <button className={buttonClass('secondary')} disabled={busy || recording} onClick={() => selectAudio(null, false)}>Effacer cet audio et son brouillon</button>
      </div>}
      <label className="flex items-start gap-3 text-sm leading-6">
        <input type="checkbox" disabled={busy || recording} checked={fictional} className="mt-1 h-4 w-4 shrink-0 accent-[#8a5633]" onChange={event => setFictional(event.target.checked)} />
        Je confirme que cet audio et cette transcription sont entièrement fictifs, sans renseignements d’un vrai client, et j’accepte leur envoi à OpenAI pour cet essai.
      </label>
      {file && <p className="text-xs text-[#7a6859]">Audio sélectionné : {recorded ? 'appel Teams fictif enregistré' : 'fichier importé'} · {(file.size / 1_000_000).toFixed(2)} Mo</p>}
      <button className={buttonClass('primary')} disabled={busy || recording || !noteType || !fictional || (recorded && !listened) || !file || !file.size || file.size > CLINICAL_AUDIO_MAX_BYTES}
        onClick={() => void run('transcribe')}>Envoyer l’audio fictif pour transcription</button>
      {transcribed && <div className="space-y-3">
        <label htmlFor="ai-trial-transcript" className="block text-sm font-medium">Transcription à vérifier</label>
        <textarea id="ai-trial-transcript" className="min-h-56 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm leading-6"
          disabled={busy || recording} value={transcript} maxLength={CLINICAL_TRANSCRIPT_MAX_CHARS} onChange={event => {
            setTranscript(event.target.value); setNote(''); setReviewed(false); setValidated(false); setMessage('')
          }} />
        <p className="text-xs text-[#7a6859]">Les interlocuteurs ne sont pas identifiés automatiquement dans cette étape. Corrigez les erreurs et les attributions avant de continuer.</p>
        <button className={buttonClass('primary')} disabled={busy || recording || !noteType || !fictional || !transcript.trim()} onClick={() => void run('generate')}>Envoyer la transcription pour rédiger le brouillon</button>
      </div>}
      {note && <div className="space-y-3">
        <label htmlFor="ai-trial-note" className="block text-sm font-medium">Brouillon clinique fictif</label>
        <textarea id="ai-trial-note" ref={noteRef} className="min-h-96 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm leading-7"
          disabled={busy || recording} readOnly={validated} value={note} onChange={event => { setNote(event.target.value); setReviewed(false); setValidated(false); setMessage('') }} />
        {!validated ? <>
          <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={reviewed} disabled={busy || recording} className="mt-1 h-4 w-4 shrink-0 accent-[#8a5633]"
            onChange={event => setReviewed(event.target.checked)} />J’ai vérifié et corrigé ce brouillon avec la transcription. Les informations incertaines sont signalées.</label>
          <button className={buttonClass('primary')} disabled={busy || recording || !reviewed || !note.trim()} onClick={() => { setValidated(true); setMessage('Note validée pour l’exercice. Aucun dépôt dans PsyLog.') }}>Valider pour l’exercice</button>
        </> : <div className="flex flex-wrap gap-3">
          <button className={buttonClass('primary')} disabled={recording} onClick={async () => {
            const text = `DONNEES FICTIVES — NE PAS DEPOSER DANS UN VRAI DOSSIER\n\n${note}`
            let timeout: ReturnType<typeof setTimeout> | undefined
            try {
              await Promise.race([navigator.clipboard.writeText(text), new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('Copie indisponible')), 1500)
              })])
              setMessage('Note fictive copiée. Aucun dépôt dans PsyLog.')
            }
            catch { noteRef.current?.focus(); noteRef.current?.select(); setMessage('Copie automatique indisponible. Copiez manuellement le texte sélectionné : il est entièrement fictif.') }
            finally { clearTimeout(timeout) }
          }}>Copier la note fictive validée</button>
          <button className={buttonClass('secondary')} disabled={recording} onClick={() => { setValidated(false); setReviewed(false); setMessage('') }}>Reprendre la correction</button>
        </div>}
      </div>}
      {busy && <p role="status" className="text-sm">Traitement en cours… Une seule demande est envoyée, sans nouvelle tentative automatique.</p>}
      {message && <p role="status" className="rounded-xl border border-[#dfd0bf] bg-[#fbf6ef] p-4 text-sm leading-6">{message}</p>}
    </div>}
  </SectionCard>
}
