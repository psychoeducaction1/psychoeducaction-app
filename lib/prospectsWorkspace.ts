import { dateKeyInToronto } from '@/lib/publicIntakeSchedule'

export type ProspectStatus = 'new' | 'scheduled' | 'callback_requested' | 'contacted'
  | 'service_taken' | 'service_not_taken' | 'other' | 'transferred_to_waiting_list'
export type ProspectsTab = 'calendar' | 'active' | 'history'

export type IntakeAppointment = {
  id: string
  prospect_id: string
  start_at: string
  end_at: string
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  events: Array<{
    id: string
    event_type: string
    previous_start_at: string | null
    new_start_at: string | null
    note: string | null
    actor_name: string | null
    created_at: string
  }>
}

export const historyStatuses = new Set<ProspectStatus>(['service_taken', 'service_not_taken', 'other', 'transferred_to_waiting_list'])
export const pendingStatuses = new Set<ProspectStatus>(['new', 'scheduled', 'callback_requested'])
export const appointmentStatusLabels = {
  scheduled: 'Planifié', completed: 'Terminé', cancelled: 'Annulé', no_show: 'Absent',
}
export const prospectDateTime = new Intl.DateTimeFormat('fr-CA', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto',
})

export function prospectsTab(value: string | null | undefined, status?: ProspectStatus): ProspectsTab {
  if (value == null && status && historyStatuses.has(status)) return 'history'
  return value === 'calendar' || value === 'history' ? value : 'active'
}

export function legacyCalendarUrl(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, item)
    }
  }
  query.set('tab', 'calendar')
  return `/direction/prospects?${query}`
}

export function prospectCallLabel(prospect: {
  contact_request_type: string
  appointments: IntakeAppointment[]
}) {
  const { primary: appointment } = splitProspectAppointments(prospect.appointments)
  if (appointment) {
    return `Rendez-vous : ${prospectDateTime.format(new Date(appointment.start_at))} (${appointmentStatusLabels[appointment.status]})`
  }
  return prospect.contact_request_type === 'rapid_callback' ? 'Rappel dès que possible' : 'Aucun rendez-vous enregistré'
}

export function splitProspectAppointments(appointments: IntakeAppointment[], appointmentId?: string) {
  const sorted = [...appointments].sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at))
  const primary = sorted.find((item) => item.id === appointmentId) ?? sorted.find((item) => item.status === 'scheduled') ?? sorted[0] ?? null
  return { primary, others: sorted.filter((item) => item !== primary) }
}

export type DailyProspect = {
  id: string
  status: ProspectStatus
  contact_request_type: string
  created_at: string
  rapid_callback_requested_at: string | null
  appointments: IntakeAppointment[]
}

export function buildDailyProspectQueue<T extends DailyProspect>(prospects: T[], day: string, now: Date) {
  const rows = prospects.flatMap((prospect) => {
    if (historyStatuses.has(prospect.status)) return []
    const scheduled = prospect.appointments.filter((appointment) => appointment.status === 'scheduled')
    const appointment = scheduled
      .filter((item) => dateKeyInToronto(new Date(item.start_at)) === day)
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))[0] ?? null
    const isRapid = prospect.contact_request_type === 'rapid_callback' && scheduled.length === 0
    return appointment || isRapid ? [{ prospect, appointment, isRapid }] : []
  })
  rows.sort((a, b) => {
    if (a.isRapid !== b.isRapid) return a.isRapid ? -1 : 1
    if (a.isRapid) return Date.parse(a.prospect.rapid_callback_requested_at ?? a.prospect.created_at)
      - Date.parse(b.prospect.rapid_callback_requested_at ?? b.prospect.created_at)
    const aTime = Date.parse(a.appointment!.start_at)
    const bTime = Date.parse(b.appointment!.start_at)
    const aPast = aTime < now.getTime()
    const bPast = bTime < now.getTime()
    return aPast !== bPast ? (aPast ? 1 : -1) : aTime - bTime
  })
  const nextScheduled = rows.find((row) => row.appointment && Date.parse(row.appointment.start_at) >= now.getTime()) ?? null
  return { rows, priority: rows.find((row) => row.isRapid) ?? nextScheduled, nextScheduled }
}
