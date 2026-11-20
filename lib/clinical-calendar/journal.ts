export type CalendarJournalCategory = 'calendar' | 'admission' | 'legacy'
export type CalendarJournalAction = string
export type CalendarJournalEvent = {
  id: string
  at: string
  action: CalendarJournalAction
  actorId: string | null
  actorName: string
  professionalName: string | null
  clientName: string | null
  startAt: string | null
  previousStartAt: string | null
  description: string | null
  category: CalendarJournalCategory
  details: { actorRole: string | null; entityType: string | null; requesterName: string | null; email: string | null; previousStatus: string | null; newStatus: string | null } | null
}
export type CalendarJournal = { events: CalendarJournalEvent[] }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const date = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const optionalDate = (value: unknown): value is string | null => value === null || date(value)
const optionalName = (value: unknown, max = 240): value is string | null => value === null || typeof value === 'string' && value.length <= max
const admissionActions = new Set([
  'admission_created','admission_updated','admission_restored','admission_classified',
  'assignment_created','assignment_returned','assignment_result_recorded',
  'assignment_result_not_contacted','assignment_result_pending','assignment_result_taken','assignment_result_not_taken',
  'prospect_created','prospect_transferred','prospect_followup_created','prospect_outcome_recorded',
  'process_started','process_updated','process_reopened','process_classified','process_returned',
  'contact_voicemail','contact_text','contact_email','contact_text_email',
  'capacity_created','capacity_updated','preferences_updated','notification_simulated',
])

export function isCalendarJournal(value: unknown): value is CalendarJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const events = (value as Record<string, unknown>).events
  if (!Array.isArray(events) || events.length > 10000) return false
  return events.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const event = item as Record<string, unknown>
    return typeof event.id === 'string' && uuid.test(event.id)
      && (event.actorId === null || typeof event.actorId === 'string' && uuid.test(event.actorId))
      && date(event.at)
      && typeof event.action === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(event.action)
      && ['calendar','admission','legacy'].includes(String(event.category))
      && typeof event.actorName === 'string' && event.actorName.length <= 240
      && optionalName(event.professionalName)
      && optionalName(event.clientName) && optionalDate(event.startAt) && optionalDate(event.previousStartAt)
      && optionalName(event.description,500)
      && (event.details === null || typeof event.details === 'object' && !Array.isArray(event.details)
        && optionalName((event.details as Record<string, unknown>).actorRole,80)
        && optionalName((event.details as Record<string, unknown>).entityType,100)
        && optionalName((event.details as Record<string, unknown>).requesterName)
        && optionalName((event.details as Record<string, unknown>).email)
        && optionalName((event.details as Record<string, unknown>).previousStatus,100)
        && optionalName((event.details as Record<string, unknown>).newStatus,100))
      && (event.category === 'calendar'
        ? ['appointment_created','appointment_cancelled','appointment_rescheduled'].includes(event.action)
        : event.category === 'admission' ? admissionActions.has(event.action) : event.category === 'legacy')
  })
}
