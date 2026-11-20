import { createHash } from 'node:crypto'
import type { ClinicalAppointmentSnapshot, ClinicalNoteSummary, ClinicalNoteView } from '../clinical-core/types.ts'
import { ClinicalError } from '../clinical-core/validation.ts'
import { priorNoteEncounterTime, priorNoteSummaries, summarizePriorNotes, withoutEmbeddedPriorContext, type PriorNoteContext } from '../clinical-workspace/priorNoteContext.ts'
import { readLegacyArchivePages } from '../clinical-real/latestPriorNote.ts'
import { recentLegacyEncounters, type LegacyPdfSource } from '../clinical-real/legacyRecentContext.ts'
import type { realClinicalTransport } from '../clinical-real/transport.ts'

type Transport = ReturnType<typeof realClinicalTransport>
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function invalid(): never { throw new ClinicalError(502, 'PRIOR_NOTE_INVALID', 'La dernière note du dossier ne peut pas être vérifiée.') }
function summary(value: unknown): value is ClinicalNoteSummary {
  return object(value) && typeof value.id === 'string' && typeof value.recordId === 'string'
    && typeof value.createdAt === 'string' && (value.encounterDate === null || typeof value.encounterDate === 'string')
    && (value.appointmentId === null || typeof value.appointmentId === 'string')
    && (value.appointmentSnapshot === null || object(value.appointmentSnapshot) && typeof value.appointmentSnapshot.startAt === 'string')
}
function appointment(value: unknown, recordId: string, appointmentId: string): value is ClinicalAppointmentSnapshot {
  return object(value) && value.id === appointmentId && value.recordId === recordId
    && typeof value.startAt === 'string' && Number.isFinite(Date.parse(value.startAt))
}

/** Shared data adapter for the original note UI and drafting engine. It forwards
 * only the user's JWT, selects a complete note by the laboratory's date rules,
 * and never sends archives to a model or rewrites their content. */
export async function unifiedPriorNote(transport: Transport, token: string, recordId: string,
  appointmentId: string, readPages = readLegacyArchivePages): Promise<PriorNoteContext> {
  const rpc = (name: string, args: Record<string, unknown>) => transport.rpc(name, args, token)
  const record = await rpc('clinical_unified_record', { p_case_id: recordId, p_context: 'clinical' })
  if (!object(record) || !object(record.record) || record.record.id !== recordId
    || !Array.isArray(record.notes) || !record.notes.every(summary)) invalid()
  const notes = record.notes as ClinicalNoteSummary[]
  // Existing signed/closed notes retain their frozen encounter snapshot. The
  // writable appointment-choice RPC is only necessary for a new note.
  const linked = notes.find(note => note.appointmentId === appointmentId && !note.removedAt)
  let selected: unknown = linked?.appointmentSnapshot
  if (!selected) {
    const choices = await rpc('clinical_list_note_appointments', { p_case_id: recordId })
    if (!Array.isArray(choices)) invalid()
    selected = choices.find(value => object(value) && value.id === appointmentId)
  }
  if (!appointment(selected, recordId, appointmentId)) throw new ClinicalError(403, 'ENCOUNTER_MISMATCH', 'La rencontre ne correspond pas au dossier autorisé.')
  const prior = priorNoteSummaries(notes, recordId, selected, linked?.id ?? null)
  let native: ClinicalNoteView | null = null
  if (prior[0]) {
    const read = await rpc('clinical_read_note', { p_note_id: prior[0].id })
    if (!object(read) || !summary(read.note) || read.note.id !== prior[0].id || read.note.recordId !== recordId
      || !object(read.content) || Object.values(read.content).some(value => typeof value !== 'string')) invalid()
    // A concurrent removal/date change must not become context for this encounter.
    if (!priorNoteSummaries([read.note], recordId, selected, linked?.id ?? null).length) invalid()
    native = read as ClinicalNoteView
  }
  const documents = await rpc('clinical_list_legacy_documents', { p_case_id: recordId })
  if (!Array.isArray(documents) || documents.some(doc => !object(doc) || doc.caseId !== recordId
    || typeof doc.id !== 'string' || typeof doc.label !== 'string' || typeof doc.sha256 !== 'string')) invalid()
  const sources: LegacyPdfSource[] = []
  for (const document of documents as { id: string; label: string; sha256: string }[]) {
    if (!document.label.toLocaleLowerCase('fr-CA').includes('note')) continue
    const read = await rpc('clinical_read_legacy_document', { p_document_id: document.id })
    if (!object(read) || typeof read.base64 !== 'string' || read.base64.length > 7_200_000
      || read.sha256 !== document.sha256) invalid()
    const bytes = Buffer.from(read.base64, 'base64')
    if (createHash('sha256').update(bytes).digest('hex') !== document.sha256) invalid()
    try { sources.push({ documentId: document.id, pages: await readPages(read.base64) }) }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      const code = /worker|Cannot find module|Cannot find package/i.test(message) ? 'PRIOR_NOTE_PDF_WORKER_UNAVAILABLE'
        : /DOMMatrix|Path2D|ImageData/i.test(message) ? 'PRIOR_NOTE_PDF_RUNTIME_UNAVAILABLE' : 'PRIOR_NOTE_PDF_TEXT_UNAVAILABLE'
      throw new ClinicalError(503, code, 'La lecture locale du PDF est indisponible. Le document original reste conservé.')
    }
  }
  const before = Date.parse(selected.startAt)
  const timeOfArchive = (date: string) => priorNoteEncounterTime({ appointmentSnapshot: null, encounterDate: date, createdAt: '' })
  const archived = recentLegacyEncounters(sources).filter(item => timeOfArchive(item.date) < before)
  const available = prior.length + archived.length
  const candidate = archived[0]
  if (candidate && (!native || timeOfArchive(candidate.date) > priorNoteEncounterTime(native.note))) {
    const body = withoutEmbeddedPriorContext(candidate.text).trim()
    return { text: body ? `Dernière note du ${candidate.date} :\n${body}` : '', included: body ? 1 : 0, available, truncated: false }
  }
  return summarizePriorNotes(native ? [native] : [], recordId, available)
}
