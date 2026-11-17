'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Badge, buttonClass } from '@/components/Ui'
import type { ClinicalNoteView, ClinicalRecordSummary, ClinicalRecordView, WorkspaceView } from '@/lib/clinical-core/types'
import { clinicalRequest, isClinicalAccessDenied } from '@/lib/clinical-workspace/api'
import { ClinicalNoteEditor } from './ClinicalNoteEditor'
import { clinicalCard } from './styles'
import { useClinicalNavigation } from './NavigationGuard'
import { ClinicalNotePdf } from './ClinicalNotePdf'
import { clinicalNoteDocumentText } from '@/lib/clinical-workspace/noteDocument'

const noteDate = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' })
const noteTime = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' })
const NOTE_PAGE_SIZE = 10

export function ClinicalRecordPanel({ record, workspace, onBack, onUpdated, initialNoteId, embedded = false, showBack = true, showRecordLabel = true }: { record: ClinicalRecordSummary; workspace: WorkspaceView; onBack: () => void; onUpdated: () => Promise<void>; initialNoteId?: string | null; initialAppointmentId?: string | null; embedded?: boolean; showBack?: boolean; showRecordLabel?: boolean }) {
  const navigation = useClinicalNavigation()
  const [data, setData] = useState<ClinicalRecordView | null>(null)
  const [note, setNote] = useState<ClinicalNoteView | null>(null)
  const [error, setError] = useState('')
  const [loadingNote, setLoadingNote] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [editorGeneration, setEditorGeneration] = useState(0)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const previewCache = useRef<Record<string, string>>({})
  const accessRevoked = useRef(false)
  const noteRequest = useRef(0)
  const noteOperationPending = useRef(false)
  const invalidateAccess = useCallback((cause: unknown) => {
    if (!isClinicalAccessDenied(cause)) return
    accessRevoked.current = true
    noteRequest.current++
    noteOperationPending.current = false
    previewCache.current = {}; setPreviews({})
    setData(null); setNote(null); setLoadingNote(false)
    setError(cause instanceof Error ? cause.message : 'Accès au dossier retiré.')
    void onUpdated()
  }, [onUpdated])
  const canWrite = record.status === 'open' && record.members.some(member => member.actorId === workspace.actor.id && member.canWrite)
  const sortedNotes = useMemo(() => [...(data?.notes ?? [])].sort((a, b) => (b.appointmentSnapshot?.startAt ?? b.encounterDate ?? b.createdAt).localeCompare(a.appointmentSnapshot?.startAt ?? a.encounterDate ?? a.createdAt) || b.createdAt.localeCompare(a.createdAt)), [data?.notes])
  const visibleNotes = useMemo(() => sortedNotes.slice(page * NOTE_PAGE_SIZE, (page + 1) * NOTE_PAGE_SIZE), [sortedNotes, page])
  useEffect(() => navigation.register(async () => !noteOperationPending.current), [navigation])
  useEffect(() => () => { noteRequest.current++ }, [])
  useEffect(() => {
    const controller = new AbortController()
    void clinicalRequest<{ record: ClinicalRecordView }>({ actorId: workspace.actor.id, context: workspace.context }, `/records/${record.id}`, undefined, 'GET', controller.signal)
      .then(payload => { if (!controller.signal.aborted && !accessRevoked.current) { setData(payload.record); setError('') } })
      .catch(cause => { if (!controller.signal.aborted) { invalidateAccess(cause); setError(cause instanceof Error ? cause.message : 'Ouverture impossible.') } })
    return () => controller.abort()
  }, [record.id, workspace.actor.id, workspace.context, refresh, invalidateAccess])
  useEffect(() => {
    if (!data || note || accessRevoked.current) return
    const controller = new AbortController()
    // Only the visible rows request their text; the record list itself stays light.
    for (const summary of visibleNotes) {
      const key = `${summary.id}:${summary.version}`
      if (Object.hasOwn(previewCache.current, key)) continue
      void clinicalRequest<{ note: ClinicalNoteView }>({ actorId: workspace.actor.id, context: workspace.context }, `/notes/${summary.id}`, undefined, 'GET', controller.signal)
        .then(payload => {
          if (controller.signal.aborted || accessRevoked.current || payload.note.note.recordId !== record.id) return
          const type = workspace.noteTypes.find(item => item.id === payload.note.note.noteType)
          const text = (type ? clinicalNoteDocumentText(type, payload.note.content) : Object.values(payload.note.content).join(' ')).replace(/\s+/g, ' ').trim()
          const preview = text ? text.slice(0, 150) + (text.length > 150 ? '…' : '') : 'Aucun texte enregistré.'
          previewCache.current[key] = preview
          setPreviews(current => ({ ...current, [key]: preview }))
        })
        .catch(cause => { if (!controller.signal.aborted) { invalidateAccess(cause); if (!isClinicalAccessDenied(cause)) { previewCache.current[key] = 'Extrait indisponible.'; setPreviews(current => ({ ...current, [key]: 'Extrait indisponible.' })) } } })
    }
    return () => controller.abort()
  }, [data, note, visibleNotes, record.id, workspace.actor.id, workspace.context, workspace.noteTypes, invalidateAccess])
  useEffect(() => {
    if (!initialNoteId) return
    const controller = new AbortController(), request = ++noteRequest.current
    noteOperationPending.current = true; setLoadingNote(true)
    void clinicalRequest<{ note: ClinicalNoteView }>({ actorId: workspace.actor.id, context: workspace.context }, '/notes/' + initialNoteId, undefined, 'GET', controller.signal)
      .then(payload => { if (!controller.signal.aborted && !accessRevoked.current && request === noteRequest.current) {
        if (payload.note.note.recordId !== record.id) throw new Error('Cette note ne relève pas du dossier affiché.')
        setNote(payload.note); setEditorGeneration(value => value + 1)
      } })
      .catch(cause => { if (!controller.signal.aborted && request === noteRequest.current) { invalidateAccess(cause); setError(cause instanceof Error ? cause.message : 'Note inaccessible.') } })
      .finally(() => { if (!controller.signal.aborted && request === noteRequest.current) { noteOperationPending.current = false; setLoadingNote(false) } })
    return () => controller.abort()
  }, [initialNoteId, record.id, workspace.actor.id, workspace.context, invalidateAccess])
  const openNote = async (id: string) => {
    if (accessRevoked.current || noteOperationPending.current) return
    const request = ++noteRequest.current
    if (!await navigation.canLeave() || request !== noteRequest.current) return
    noteOperationPending.current = true
    setLoadingNote(true); setError('')
    try { const payload = await clinicalRequest<{ note: ClinicalNoteView }>({ actorId: workspace.actor.id, context: workspace.context }, `/notes/${id}`); if (request === noteRequest.current) { setNote(payload.note); setEditorGeneration(value => value + 1) } }
    catch (cause) { if (request === noteRequest.current) { invalidateAccess(cause); setError(cause instanceof Error ? cause.message : 'Note inaccessible.') } }
    finally { if (request === noteRequest.current) { noteOperationPending.current = false; setLoadingNote(false) } }
  }
  const removeNote = async (summary: ClinicalRecordView['notes'][number]) => {
    if (noteOperationPending.current || removingId || !window.confirm('Supprimer définitivement cette note du dossier ? Cette action ne peut pas être annulée.')) return
    setRemovingId(summary.id); setError('')
    try {
      await clinicalRequest<{ result: { id: string; removed: boolean } }>({ actorId: workspace.actor.id, context: workspace.context }, `/notes/${summary.id}`, { expectedVersion: summary.version }, 'DELETE')
      setRefresh(value => value + 1)
      await onUpdated()
    } catch (cause) { invalidateAccess(cause); setError(cause instanceof Error ? cause.message : 'La note n’a pas pu être supprimée.') }
    finally { setRemovingId(null) }
  }
  return <div className="grid min-w-0 gap-5">{showBack && !note && <div><button className={buttonClass('ghost')} onClick={async () => { if (await navigation.canLeave()) onBack() }}><ArrowLeft size={17} />{embedded ? 'Retour au dossier client' : 'Retour au client'}</button></div>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {!data && !error && <p role="status">Ouverture du dossier autorisé…</p>}
    {data && <>{!note && <section className={embedded ? 'min-w-0' : clinicalCard}><div className="flex flex-wrap items-start justify-between gap-3"><div>{embedded ? showRecordLabel && <h4 className="font-semibold">{record.label}</h4> : <h2 className="text-xl font-semibold">{data.client.firstName} {data.client.lastName}</h2>}</div></div>
      {sortedNotes.length ? <><div className="mt-5 overflow-x-auto rounded-xl border border-[#eadfd2]"><table className="w-full min-w-[720px] table-fixed border-collapse text-left text-sm"><colgroup><col className="w-[11%]" /><col className="w-[16%]" /><col className="w-[16%]" /><col className="w-[31%]" /><col className="w-[12%]" /><col className="w-[14%]" /></colgroup><thead className="bg-[#f7f1e9] text-[#604936]"><tr><th scope="col" className="px-3 py-3">Date</th><th scope="col" className="px-3 py-3">Activité</th><th scope="col" className="px-3 py-3">Type</th><th scope="col" className="px-3 py-3">Note</th><th scope="col" className="px-3 py-3">Statut</th><th scope="col" className="px-3 py-3">Actions</th></tr></thead><tbody>{visibleNotes.map(summary => {
        const start = summary.appointmentSnapshot?.startAt
        const end = summary.appointmentSnapshot?.endAt
        const preview = previews[`${summary.id}:${summary.version}`]
        const editable = canWrite && summary.authorId === workspace.actor.id && summary.status === 'draft'
        return <tr key={summary.id} className="border-t border-[#eadfd2] align-top"><td className="whitespace-nowrap px-3 py-3">{summary.encounterDate ?? (start ? noteDate.format(new Date(start)) : noteDate.format(new Date(summary.createdAt)))}</td><td className="whitespace-nowrap px-3 py-3">{start ? <>{noteDate.format(new Date(start))}<br /><span className="text-[#8a6f5d]">{noteTime.format(new Date(start))} – {end ? noteTime.format(new Date(end)) : '—'}</span></> : <span className="text-[#8a6f5d]">Sans activité liée</span>}</td><td className="px-3 py-3">{workspace.noteTypes.find(type => type.id === summary.noteType)?.label ?? summary.title}</td><td className="px-3 py-3"><button type="button" className="block w-full text-left hover:text-[#8a5633]" disabled={loadingNote || Boolean(removingId)} onClick={() => void openNote(summary.id)}><strong className="block font-medium">{summary.title}</strong>{summary.amendsNoteId && <span className="mt-1 block text-xs font-semibold text-[#77502f]" title={summary.signedAt ? `Correction validée le ${new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Toronto' }).format(new Date(summary.signedAt))}` : 'Correction ou complément non encore validé'}>Correction ou complément {summary.signedAt ? 'signé' : 'en cours'}</span>}<span className="mt-1 line-clamp-2 block break-words text-xs text-[#6f5b4c]">{preview ?? 'Chargement de l’extrait…'}</span></button></td><td className="whitespace-nowrap px-3 py-3"><Badge tone={summary.status === 'signed' ? 'success' : summary.status === 'awaiting_cosignature' ? 'warning' : 'neutral'}>{summary.status === 'signed' ? 'Verrouillée' : summary.status === 'awaiting_cosignature' ? 'À cosigner' : 'Brouillon'}</Badge></td><td className="px-3 py-3"><div className="flex flex-wrap gap-1"><button type="button" className={`${buttonClass('ghost')} !px-2 !py-1 text-sm`} disabled={loadingNote || Boolean(removingId)} onClick={() => void openNote(summary.id)}>{editable ? 'Modifier' : 'Voir'}</button>{workspace.durable && <ClinicalNotePdf noteId={summary.id} title={summary.title} workspace={workspace} />}{canWrite && summary.authorId === workspace.actor.id && <button type="button" className={`${buttonClass('ghost')} !px-2 !py-1 text-sm text-red-800`} disabled={Boolean(removingId) || loadingNote} onClick={() => void removeNote(summary)}>{removingId === summary.id ? 'Suppression…' : 'Supprimer'}</button>}</div></td></tr>
      })}</tbody></table></div>{sortedNotes.length > NOTE_PAGE_SIZE && <div className="mt-3 flex items-center justify-end gap-3 text-sm"><button type="button" className={buttonClass('ghost')} disabled={page === 0} onClick={() => setPage(value => value - 1)}>Précédent</button><span>Page {page + 1} sur {Math.ceil(sortedNotes.length / NOTE_PAGE_SIZE)}</span><button type="button" className={buttonClass('ghost')} disabled={(page + 1) * NOTE_PAGE_SIZE >= sortedNotes.length} onClick={() => setPage(value => value + 1)}>Suivant</button></div>}</> : <p className="mt-4 text-sm text-[#8a6f5d]">Aucune note dans ce dossier.</p>}
    </section>}{loadingNote && <p role="status">Ouverture de la note…</p>}{note && <><button type="button" className={`${buttonClass('ghost')} justify-self-start`} onClick={async () => { if (await navigation.canLeave()) setNote(null) }}><ArrowLeft size={17} />Retour aux notes</button><ClinicalNoteEditor key={`${note.note.id}:${editorGeneration}`} initial={note} workspace={workspace} onAccessDenied={invalidateAccess} type={workspace.noteTypes.find(type => type.id === note.note.noteType)!} onChanged={updated => { setNote(updated); setRefresh(value => value + 1); void onUpdated() }} /></>}</>}
  </div>
}
