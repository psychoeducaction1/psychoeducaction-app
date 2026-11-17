'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, FilePenLine, LockKeyhole, Save } from 'lucide-react'
import { Badge, buttonClass } from '@/components/Ui'
import type { ClinicalNoteView, NoteTypeOption, WorkspaceView } from '@/lib/clinical-core/types'
import { clinicalUiText } from '@/lib/clinical-workspace/presentationText'
import { clinicalRequest, isClinicalAccessDenied } from '@/lib/clinical-workspace/api'
import { NoteDraftController } from '@/lib/clinical-workspace/noteDraftController'
import { clinicalCard, clinicalInput, clinicalLabel } from './styles'
import { useClinicalNavigation } from './NavigationGuard'
import { clinicalNoteDocumentText } from '@/lib/clinical-workspace/noteDocument'
import { ClinicalNoteAssistance } from './ClinicalNoteAssistance'
import { ClinicalNotePdf } from './ClinicalNotePdf'
import { ClinicalNoteSignatures } from './ClinicalNoteSignatures'
import { ClinicalNoteCorrectionDiff } from './ClinicalNoteCorrectionDiff'
import { PriorNoteContextPanel } from './PriorNoteContextPanel'
import { withoutEmbeddedPriorContext, type PriorNoteContext } from '@/lib/clinical-workspace/priorNoteContext'

export function ClinicalNoteEditor({ initial, workspace, type, priorContext, priorContextLoading = false, priorContextError = '', onChanged, onAccessDenied }: { initial: ClinicalNoteView; workspace: WorkspaceView; type: NoteTypeOption; priorContext?: PriorNoteContext | null; priorContextLoading?: boolean; priorContextError?: string; onChanged: (view: ClinicalNoteView) => void; onAccessDenied: (cause: unknown) => void }) {
  const navigation = useClinicalNavigation()
  const [controller] = useState(() => new NoteDraftController(initial, async (expectedVersion, content) => {
    try {
      const payload = await clinicalRequest<{ note: ClinicalNoteView }>({ actorId: workspace.actor.id, context: workspace.context }, `/notes/${initial.note.id}`, { expectedVersion, content }, 'PATCH')
      return payload.note
    } catch (cause) { if (isClinicalAccessDenied(cause)) onAccessDenied(cause); throw cause }
  }))
  const [snapshot, setSnapshot] = useState(() => controller.snapshot())
  const [attested, setAttested] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const actionPending = useRef(false)
  const [actionError, setActionError] = useState('')
  const [original, setOriginal] = useState<ClinicalNoteView | null>(null)
  const [originalError, setOriginalError] = useState('')
  const accessDeniedRef = useRef(onAccessDenied)
  const note = snapshot.view.note
  const currentRecord = workspace.records.find(record => record.id === note.recordId)
  const currentGrant = currentRecord?.members.find(member => member.actorId === workspace.actor.id)
  const editable = note.status === 'draft' && note.authorId === workspace.actor.id && currentRecord?.status === 'open' && currentGrant?.canWrite === true
  const amendable = note.status === 'signed' && note.authorId === workspace.actor.id && currentRecord?.status === 'open' && currentGrant?.canWrite === true
  const cosignable = note.status === 'awaiting_cosignature' && note.supervisorId === workspace.actor.id && currentRecord?.status === 'open' && currentGrant?.canCosign === true
  const appointment = note.appointmentSnapshot
  const documentText = clinicalNoteDocumentText(type, snapshot.content)
  const originalText = original ? clinicalNoteDocumentText(type, original.content) : null
  const correctionHasChanges = originalText !== null && originalText !== documentText
  const legacyContextInDraft = editable && withoutEmbeddedPriorContext(documentText) !== documentText

  useEffect(() => controller.subscribe(setSnapshot), [controller])
  useEffect(() => { accessDeniedRef.current = onAccessDenied }, [onAccessDenied])
  useEffect(() => {
    if (!note.amendsNoteId) return
    const abort = new AbortController()
    const parentId = note.amendsNoteId
    clinicalRequest<{ note: ClinicalNoteView }>({ actorId: workspace.actor.id, context: workspace.context }, `/notes/${parentId}`, undefined, 'GET', abort.signal)
      .then(payload => {
        if (abort.signal.aborted) return
        if (payload.note?.note.id !== parentId || payload.note.note.status !== 'signed' || payload.note.note.recordId !== note.recordId) throw new Error('La note signée d’origine ne correspond pas à cette correction.')
        setOriginal(payload.note); setOriginalError('')
      })
      .catch(cause => {
        if (abort.signal.aborted) return
        if (isClinicalAccessDenied(cause)) accessDeniedRef.current(cause)
        setOriginalError(cause instanceof Error ? cause.message : 'La note d’origine ne peut pas être affichée.')
      })
    return () => abort.abort()
  }, [note.amendsNoteId, note.recordId, workspace.actor.id, workspace.context])
  useEffect(() => navigation.register(async () => {
    if (actionPending.current) return false
    if (!controller.snapshot().dirty && !controller.snapshot().saving) return true
    try { await controller.flush(); return true } catch {
      return window.confirm('Ce brouillon n’a pas pu être sauvegardé. Quitter cette fiche fera perdre le texte local non enregistré. Voulez-vous quitter quand même ?')
    }
  }), [controller, navigation])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { const current = controller.snapshot(); if (current.dirty || current.saving || actionPending.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [controller])
  useEffect(() => {
    if (!editable || !snapshot.dirty || snapshot.saving || snapshot.error || finalizing) return
    const timer = setTimeout(() => { void controller.flush().catch(() => undefined) }, 800)
    return () => clearTimeout(timer)
  }, [controller, editable, snapshot.dirty, snapshot.saving, snapshot.error, snapshot.revision, finalizing])

  const act = async (action: 'sign' | 'cosign' | 'amend') => {
    if (actionPending.current) return
    if (action === 'sign' && note.amendsNoteId && !correctionHasChanges) { setActionError('La correction doit présenter au moins un changement vérifiable par rapport à la note signée.'); return }
    actionPending.current = true
    setFinalizing(true); setActionError('')
    try {
      const latest = editable ? await controller.flush() : controller.snapshot().view
      const body = action === 'amend' ? { expectedVersion: latest.note.version, reason: 'correction' } : { expectedVersion: latest.note.version, attested: true }
      const payload = await clinicalRequest<{ note: ClinicalNoteView }>({ actorId: workspace.actor.id, context: workspace.context }, `/notes/${note.id}/${action}`, body, 'POST')
      if (action !== 'amend') controller.replace(payload.note)
      setAttested(false); onChanged(payload.note)
    } catch (cause) { if (isClinicalAccessDenied(cause)) onAccessDenied(cause); setActionError(cause instanceof Error ? cause.message : 'L’action n’a pas pu être confirmée.') }
    finally { actionPending.current = false; setFinalizing(false) }
  }

  const signatureControls = (editable || cosignable) && <div className="mt-6 border-t border-[#eadfd2] pt-5">
    <label className="flex items-start gap-3 text-sm text-[#5d4a3d]"><input type="checkbox" checked={attested} onChange={event => setAttested(event.target.checked)} disabled={finalizing} className="mt-1" /><span>{clinicalUiText('J’ai relu cette note fictive et j’en confirme le contenu sous ma responsabilité professionnelle.','J’ai relu cette note et j’en confirme le contenu sous ma responsabilité professionnelle.')}</span></label>
    <p className="mt-2 text-xs text-[#8a6f5d]">{note.requiresCosignature ? 'La signature de l’auteur verrouille le texte, puis le superviseur désigné doit cosigner.' : 'La signature verrouille cette version.'}</p>
    {note.amendsNoteId && !correctionHasChanges && <p id="correction-signature-help" role="status" className="mt-3 text-sm text-[#77502f]">{originalText === null ? 'La note signée d’origine doit être chargée avant de valider une correction.' : 'Cette correction est encore identique à la note signée. Modifiez le texte proposé ci-dessus pour pouvoir la signer.'}</p>}
    <button className={`${buttonClass('primary')} mt-4`} aria-describedby={note.amendsNoteId && !correctionHasChanges ? 'correction-signature-help' : undefined} disabled={!attested || finalizing || snapshot.conflict || Boolean(note.amendsNoteId && !correctionHasChanges)} onClick={() => void act(cosignable ? 'cosign' : 'sign')}><CheckCircle2 size={17} />{finalizing ? 'Confirmation…' : cosignable ? 'Cosigner la note' : 'Signer et verrouiller'}</button>
  </div>

  return <section className={clinicalCard} aria-label="Éditeur de note clinique">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-semibold">{note.title || type.label}</h3>{note.amendsNoteId && <p className="mt-1 text-xs text-[#8a6f5d]">Correction ou complément lié à la note signée</p>}</div><Badge tone={note.status === 'signed' ? 'success' : note.status === 'awaiting_cosignature' ? 'warning' : 'neutral'}>{note.status === 'signed' ? 'Signée et verrouillée' : note.status === 'awaiting_cosignature' ? 'Cosignature requise' : 'Brouillon'}</Badge></div>
    {appointment && <p className="mt-4 text-sm text-[#7a6859]">Rencontre {new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'long', timeStyle: 'short' }).format(new Date(appointment.startAt))} · {{ office: 'Au bureau', home: 'À domicile', phone: 'Par téléphone', video: 'En visioconférence' }[appointment.modality]}</p>}
    {priorContext !== undefined && <PriorNoteContextPanel context={priorContext} loading={priorContextLoading} error={priorContextError} />}
    {legacyContextInDraft && <button className={`${buttonClass('secondary')} mt-3`} disabled={snapshot.saving || finalizing || snapshot.conflict} onClick={() => { controller.editDocument(withoutEmbeddedPriorContext(documentText)); setAttested(false) }}>Retirer l’ancien résumé du texte de ce brouillon</button>}
    <div className="mt-4 flex flex-wrap items-center gap-2 border-y border-[#eee4d9] py-3">
      <span role="status" className={`mr-auto text-xs ${snapshot.error ? 'text-red-700' : 'text-[#7a6859]'}`}>{snapshot.saving ? 'Sauvegarde en cours…' : snapshot.error ? 'Brouillon local conservé — sauvegarde interrompue' : snapshot.dirty ? 'Modifications à enregistrer…' : clinicalUiText(workspace.durable ? 'Enregistré dans la base locale fictive' : 'Enregistré dans le laboratoire temporaire','Enregistré')}</span>
      {editable && <button className={`${buttonClass('ghost')} !px-2 !py-1 text-sm`} disabled={snapshot.saving || finalizing || snapshot.conflict} onClick={() => void controller.flush().catch(() => undefined)}><Save size={15} />Enregistrer</button>}
      {workspace.durable && !snapshot.dirty && !snapshot.saving && <ClinicalNotePdf noteId={note.id} title={note.title} workspace={workspace} />}
    </div>
    {snapshot.error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{snapshot.error}</p>{snapshot.conflict && <button className={`${buttonClass('secondary')} mt-3`} onClick={async () => {
      if (!window.confirm('Votre texte non sauvegardé sera remplacé. Voulez-vous recharger la version serveur ?')) return
      try { const payload = await clinicalRequest<{ note: ClinicalNoteView }>({ actorId: workspace.actor.id, context: workspace.context }, `/notes/${note.id}`); controller.replace(payload.note) } catch (cause) { if (isClinicalAccessDenied(cause)) onAccessDenied(cause); setActionError(cause instanceof Error ? cause.message : 'Rechargement impossible.') }
    }}>Recharger la version serveur</button>}</div>}
    {note.status !== 'draft' && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f1ead9] p-4 text-sm text-[#5f5932]">
      <p className="flex items-center gap-2"><LockKeyhole size={18} className="shrink-0" />Le texte signé est verrouillé.</p>
      {amendable && <button type="button" className={buttonClass('primary')} disabled={finalizing} title="Créer une correction ou un complément" onClick={() => void act('amend')}><FilePenLine size={17} />Modifier la note</button>}
    </div>}
    <div className="mt-5 space-y-4">{editable ? <label className={clinicalLabel}>{note.amendsNoteId ? 'Texte proposé pour la correction ou le complément' : 'Texte de la note'}<textarea className={`${clinicalInput} mt-2 min-h-80 leading-7`} maxLength={24000} value={documentText} disabled={finalizing || snapshot.conflict} onChange={event => { controller.editDocument(event.target.value); setAttested(false) }} placeholder={note.noteType === 'evolution' ? 'Rédiger la note…' : type.sections.map(section => section.title).join('\n\n')} /></label> : !note.amendsNoteId && <article aria-label="Texte de la note" className="min-h-32 whitespace-pre-wrap break-words rounded-xl border border-[#eadfd2] bg-white p-5 text-sm leading-7 text-[#3f332b]">{documentText || 'Aucun texte enregistré.'}</article>}
      {note.amendsNoteId && signatureControls}
      {note.amendsNoteId && (originalText !== null ? <ClinicalNoteCorrectionDiff original={originalText} corrected={documentText} signedAt={note.signedAt ?? snapshot.view.signatures.find(signature => signature.kind === 'author')?.signedAt ?? null} /> : <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{originalError || 'Chargement de la note signée d’origine pour afficher les changements…'}{originalError && <span className="block mt-2 whitespace-pre-wrap">{documentText}</span>}</p>)}
    </div>
    {editable && !note.amendsNoteId && !snapshot.conflict && note.appointmentId && <ClinicalNoteAssistance recordId={note.recordId} appointmentId={note.appointmentId} noteId={note.id} noteType={note.noteType} currentText={clinicalNoteDocumentText(type, snapshot.content)} priorContext={priorContext?.text} priorContextLoading={priorContextLoading} onInsert={value => { controller.editDocument(value); setAttested(false) }} />}

    {!note.amendsNoteId && signatureControls}
    {actionError && <p role="alert" className="mt-4 text-sm text-red-700">{actionError}</p>}
    <ClinicalNoteSignatures note={snapshot.view} workspace={workspace} />
  </section>
}
