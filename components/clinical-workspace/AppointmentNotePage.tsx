'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Save } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import type { ClinicalAppointmentSnapshot, ClinicalNoteContent, ClinicalNoteView, ClinicalRecordView, WorkspaceView } from '@/lib/clinical-core/types'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { useClinicalFormGuard, useClinicalNavigation } from './NavigationGuard'
import { ClinicalNoteEditor } from './ClinicalNoteEditor'
import { clinicalCard, clinicalInput, clinicalLabel } from './styles'
import { ClinicalNoteAssistance } from './ClinicalNoteAssistance'
import { getClinicalNoteTemplate, type ClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import { clinicalNoteDraftText } from '@/lib/clinical-workspace/noteScaffold'
import { PRIOR_CONTEXT_RECENT_NOTES, priorNoteSummaries, summarizePriorNotes, type PriorNoteContext } from '@/lib/clinical-workspace/priorNoteContext'
import { useNoteTemplates } from './useNoteTemplates'
import { selectedNoteTemplate } from '@/lib/clinical-workspace/noteTemplates'
import { dossierClinicalPeople } from '@/lib/clinical-workspace/deidentify'
import { PriorNoteContextPanel } from './PriorNoteContextPanel'

/** Calendar notes have their own focused route; the client file remains available separately. */
export function AppointmentNotePage({ workspace, clientId, recordId, appointmentId, noteId, onBack, onUpdated }: {
  workspace: WorkspaceView; clientId: string; recordId: string; appointmentId: string; noteId: string | null
  onBack: () => void; onUpdated: () => Promise<void>
}) {
  const navigation = useClinicalNavigation()
  const templates = useNoteTemplates(workspace.actor.id, workspace.durable && workspace.context === 'clinical')
  const [selectedTemplate, setSelectedTemplate] = useState('evolution')
  const [record, setRecord] = useState<ClinicalRecordView | null>(null)
  const [appointment, setAppointment] = useState<ClinicalAppointmentSnapshot | null>(null)
  const [note, setNote] = useState<ClinicalNoteView | null>(null)
  const [content, setContent] = useState<ClinicalNoteContent>({ document: clinicalNoteDraftText('evolution') })
  const [selectedNoteType, setSelectedNoteType] = useState<ClinicalNoteType>('evolution')
  const [titleOverride, setTitleOverride] = useState<string | null>(null)
  const [priorContext, setPriorContext] = useState<PriorNoteContext | null>(null)
  const [contextPending, setContextPending] = useState(false)
  const [contextError, setContextError] = useState('')
  const contentEdited = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const form = useClinicalFormGuard(dirty, pending)
  const canWrite = record?.record.status === 'open' && record.record.members.some(member => member.actorId === workspace.actor.id && member.canWrite)
  const selectedTemplateLabel = selectedTemplate.startsWith('personal:')
    ? templates.templates.find(item => 'personal:' + item.id === selectedTemplate)?.title ?? getClinicalNoteTemplate(selectedNoteType).label
    : getClinicalNoteTemplate(selectedNoteType).label

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setRecord(null); setAppointment(null); setNote(null)
    const identity = { actorId: workspace.actor.id, context: workspace.context }
    void (async () => {
      try {
        const recordRequest = clinicalRequest<{ record: ClinicalRecordView }>(identity, `/records/${recordId}`, undefined, 'GET', controller.signal)
        const relatedRequest = noteId
          ? clinicalRequest<{ note: ClinicalNoteView }>(identity, `/notes/${noteId}`, undefined, 'GET', controller.signal)
          : clinicalRequest<{ appointments: ClinicalAppointmentSnapshot[] }>(identity, `/records/${recordId}/appointments`, undefined, 'GET', controller.signal)
        const [result, related] = await Promise.all([recordRequest, relatedRequest])
        if (result.record.record.clientId !== clientId || result.record.client.id !== clientId) throw new Error('Cette note ne correspond pas au client demandé.')
        const linkedNoteId = noteId ?? result.record.notes.find(item => item.appointmentId === appointmentId)?.id
        if (linkedNoteId) {
          const loaded = noteId ? related as { note: ClinicalNoteView }
            : await clinicalRequest<{ note: ClinicalNoteView }>(identity, `/notes/${linkedNoteId}`, undefined, 'GET', controller.signal)
          if (loaded.note.note.recordId !== recordId || loaded.note.note.appointmentId !== appointmentId) throw new Error('Cette note ne correspond pas à la rencontre demandée.')
          if (!controller.signal.aborted) { setNote(loaded.note); setAppointment(loaded.note.note.appointmentSnapshot) }
        } else {
          const choices = related as { appointments: ClinicalAppointmentSnapshot[] }
          const selected = choices.appointments.find(item => item.id === appointmentId && item.clientId === clientId && item.recordId === recordId)
          if (!selected) throw new Error('Cette rencontre ne relève plus de votre dossier autorisé.')
          if (!controller.signal.aborted) setAppointment(selected)
        }
        if (!controller.signal.aborted) setRecord(result.record)
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'La note ne peut pas être ouverte.') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [workspace.actor.id, workspace.context, clientId, recordId, appointmentId, noteId])

  useEffect(() => {
    if (!record || !appointment) return
    const controller = new AbortController()
    const linkedNoteId = noteId ?? record.notes.find(item => item.appointmentId === appointmentId)?.id ?? null
    const earlier = priorNoteSummaries(record.notes, recordId, appointment, linkedNoteId)
    const recent = earlier.slice(0, PRIOR_CONTEXT_RECENT_NOTES)
    setPriorContext(null); setContextError(''); setContextPending(earlier.length > 0)
    if (workspace.mode === 'isolated_unified') {
      setContextPending(true)
      void clinicalRequest<PriorNoteContext>({ actorId: workspace.actor.id, context: workspace.context },
        `/records/${recordId}/prior-note/${appointmentId}`, undefined, 'GET', controller.signal)
        .then(value => { if (!controller.signal.aborted) setPriorContext(value) })
        .catch(cause => { if (!controller.signal.aborted) setContextError(cause instanceof Error ? cause.message : 'La dernière note est indisponible.') })
        .finally(() => { if (!controller.signal.aborted) setContextPending(false) })
      return () => controller.abort()
    }
    if (!earlier.length) { setPriorContext({ text: '', included: 0, available: 0, truncated: false }); return () => controller.abort() }
    void (async () => {
      try {
        const views: ClinicalNoteView[] = []
        for (let index = 0; index < recent.length; index += 4) {
          const batch = await Promise.all(recent.slice(index, index + 4).map(item => clinicalRequest<{ note: ClinicalNoteView }>(
            { actorId: workspace.actor.id, context: workspace.context }, `/notes/${item.id}`, undefined, 'GET', controller.signal)))
          if (controller.signal.aborted) return
          for (let position = 0; position < batch.length; position++) {
            const view = batch[position].note
            if (view.note.id !== recent[index + position].id || view.note.recordId !== recordId) throw new Error('Une note antérieure ne correspond pas à ce dossier.')
            views.push(view)
          }
        }
        const summary = summarizePriorNotes(views, recordId, earlier.length)
        if (!controller.signal.aborted) setPriorContext(summary)
      } catch (cause) { if (!controller.signal.aborted) setContextError(cause instanceof Error ? cause.message : 'Le contexte antérieur est indisponible.') }
      finally { if (!controller.signal.aborted) setContextPending(false) }
    })()
    return () => controller.abort()
  }, [record, appointment, noteId, appointmentId, recordId, workspace.actor.id, workspace.context, workspace.mode])

  const changeTemplate = (nextId: string, select: HTMLSelectElement) => {
    if (nextId === selectedTemplate) return
    const chosen = selectedNoteTemplate(nextId, templates.templates)
    if (contentEdited.current && !window.confirm('Remplacer le texte actuel par le nouveau gabarit ? Les modifications non enregistrées seront perdues.')) {
      select.value = selectedTemplate; return
    }
    contentEdited.current = false
    setSelectedNoteType(chosen.noteType); setSelectedTemplate(nextId); setTitleOverride(chosen.title)
    setContent({ document: chosen.document }); setDirty(true)
  }

  const transcriptFlush = useRef<(() => Promise<void>) | null>(null)
  const saveAndClose = async () => {
    if (pending || !record || !appointment) return
    if (note) { if (await navigation.canLeave()) onBack(); return }
    if (!canWrite) return
    setPending(true); form.markPending(); setError('')
    try {
      await transcriptFlush.current?.()
      await clinicalRequest<{ note: ClinicalNoteView }>({ actorId: workspace.actor.id, context: workspace.context }, `/records/${recordId}/notes`, {
        noteType: selectedNoteType, appointmentId, content, title: titleOverride?.trim() || getClinicalNoteTemplate(selectedNoteType).label,
      }, 'POST')
      form.markSaved(); setDirty(false)
      await onUpdated()
      onBack()
    } catch (cause) { form.markSettled(); setError(cause instanceof Error ? cause.message : 'La note n’a pas pu être enregistrée.') }
    finally { setPending(false) }
  }
  const date = appointment ? new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'full', timeStyle: 'short' }).format(new Date(appointment.startAt)) : ''

  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button className={buttonClass('ghost')} onClick={async () => { if (await navigation.canLeave()) onBack() }}><ArrowLeft size={17} />Retour au calendrier</button>
      {(note || canWrite) && <button className={buttonClass(note ? 'secondary' : 'primary')} disabled={pending || loading || !appointment} onClick={() => void saveAndClose()}>{!note && <Save size={17} />}{note ? 'Fermer' : pending ? 'Enregistrement…' : 'Enregistrer et fermer'}</button>}
    </div>
    {loading && <p role="status">Ouverture de la note liée à la rencontre…</p>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {record && appointment && <section className={clinicalCard}>
      <p className="text-xs font-semibold uppercase tracking-wider text-[#8a6f5d]">Note liée à une rencontre</p>
      <h2 className="mt-1 text-xl font-semibold">{record.client.firstName} {record.client.lastName}</h2>
      <p className="mt-1 text-sm text-[#6c5a4d]">{date} · {record.record.label}</p>
    </section>}
    {record && appointment && !note && canWrite && <section className={clinicalCard} aria-label="Nouvelle note clinique">
      <label className={clinicalLabel}>Gabarit de la rencontre<select className={`${clinicalInput} mt-2`} value={selectedTemplate} onChange={event => changeTemplate(event.target.value, event.currentTarget)}><optgroup label="Gabarits communs">{workspace.noteTypes.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</optgroup><optgroup label="Mes gabarits personnels">{templates.templates.filter(item => !item.archived).map(item => <option key={item.id} value={'personal:' + item.id}>{item.title}</option>)}</optgroup></select></label>
      {templates.error && <p role="alert" className="mt-2 text-sm text-red-700">{templates.error} Les gabarits communs restent disponibles.</p>}
      <PriorNoteContextPanel context={priorContext} loading={contextPending} error={contextError} />
      <p className="mt-2 text-xs text-[#7a6859]">Si l’évaluation se poursuit après trois rencontres, reprenez le gabarit d’approfondissement ou d’intégration selon le travail effectué. Le plan d’intervention se choisit lorsqu’il a réellement lieu.</p>
      <label className={`${clinicalLabel} mt-4`}>Titre de la note<input className={`${clinicalInput} mt-2`} maxLength={120} value={titleOverride ?? getClinicalNoteTemplate(selectedNoteType).label} onChange={event => { setTitleOverride(event.target.value); setDirty(true) }} /></label>
      <label className={`${clinicalLabel} mt-4`}>Texte de la note<textarea className={`${clinicalInput} mt-2 min-h-80 leading-7`} maxLength={24000} value={content.document ?? ''} onChange={event => { contentEdited.current = true; setContent({ document: event.target.value }); setDirty(true) }} /></label>
      <ClinicalNoteAssistance realClinical={workspace.mode === 'isolated_unified'} actorId={workspace.actor.id} transcriptFlushRef={transcriptFlush} recordId={recordId} appointmentId={appointmentId} clientName={`${record.client.firstName} ${record.client.lastName}`} dossierPeople={dossierClinicalPeople(record.client)} noteType={selectedNoteType} templateId={selectedTemplate} templateLabel={selectedTemplateLabel} currentText={content.document ?? ''} priorContext={priorContext?.text} priorContextLoading={contextPending} onInsert={value => { contentEdited.current = true; setContent({ document: value }); setDirty(true) }} />
    </section>}
    {record && appointment && !note && !canWrite && <p role="alert" className={clinicalCard}>La création d’une note n’est pas autorisée dans ce dossier.</p>}
    {note && record && <ClinicalNoteEditor key={note.note.id} initial={note} workspace={{ ...workspace, records: [record.record] }} type={workspace.noteTypes.find(item => item.id === note.note.noteType)!} priorContext={priorContext} priorContextLoading={contextPending} priorContextError={contextError} onChanged={updated => { setNote(updated); void onUpdated() }} onAccessDenied={cause => { setNote(null); setRecord(null); setError(cause instanceof Error ? cause.message : 'Accès retiré.') }} />}
  </div>
}
