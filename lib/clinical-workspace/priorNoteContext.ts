import type { ClinicalAppointmentSnapshot, ClinicalNoteSummary, ClinicalNoteView } from '@/lib/clinical-core/types'

export const PRIOR_CONTEXT_RECENT_NOTES = 1

export function selectPriorNoteSummaries(notes: readonly ClinicalNoteSummary[]): ClinicalNoteSummary[] {
  return notes.slice(0, 1)
}

export function priorNoteEncounterTime(note: Pick<ClinicalNoteSummary, 'appointmentSnapshot' | 'encounterDate' | 'createdAt'>): number {
  const value = note.appointmentSnapshot?.startAt ?? (note.encounterDate ? `${note.encounterDate}T23:59:59Z` : note.createdAt)
  return Date.parse(value)
}

/** Select the latest prior note in this record by encounter date. */
export function priorNoteSummaries(notes: readonly ClinicalNoteSummary[], recordId: string,
  appointment: ClinicalAppointmentSnapshot, currentNoteId: string | null): ClinicalNoteSummary[] {
  const before = Date.parse(appointment.startAt)
  return notes.filter(note => note.recordId === recordId && !note.removedAt && note.id !== currentNoteId
    && note.appointmentId !== appointment.id && Number.isFinite(priorNoteEncounterTime(note)) && priorNoteEncounterTime(note) < before)
    .sort((left, right) => priorNoteEncounterTime(right) - priorNoteEncounterTime(left) || left.id.localeCompare(right.id))
}

/** Old draft notes sometimes embedded a generated summary. Do not pass that summary forward. */
export function withoutEmbeddedPriorContext(document: string): string {
  return document.replace(/^Contexte antérieur — résumé automatique à vérifier\s*:\s*\r?\n[\s\S]*?\r?\n\r?\n/, '')
}

export type PriorNoteContext = { text: string; included: number; available: number; truncated: boolean }

/** Show the full body of one note, without rewriting or excerpting it. */
export function summarizePriorNotes(views: readonly ClinicalNoteView[], recordId: string,
  availableNotes = views.length): PriorNoteContext {
  const view = views.find(item => item.note.recordId === recordId && !item.note.removedAt)
  if (!view) return { text: '', included: 0, available: availableNotes, truncated: false }
  const content = typeof view.content.document === 'string' ? view.content.document
    : Object.values(view.content).filter((value): value is string => typeof value === 'string').join('\n')
  const body = withoutEmbeddedPriorContext(content).trim()
  if (!body) return { text: '', included: 0, available: availableNotes, truncated: false }
  const date = view.note.appointmentSnapshot?.startAt.slice(0, 10) ?? view.note.encounterDate ?? view.note.createdAt.slice(0, 10)
  return { text: `Dernière note du ${date} :\n${body}`, included: 1, available: availableNotes, truncated: false }
}
