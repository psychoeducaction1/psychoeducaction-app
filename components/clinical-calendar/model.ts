import { calendarWeekday, localDateTime, shiftCalendarDate, validCalendarDate } from '@/lib/clinical-calendar/time'
import type { CalendarRecurrence, DurableCalendarEvent, DurableCalendarOffice } from '@/lib/clinical-calendar/durableTypes'

export type CalendarView = 'day' | 'week' | 'month'
export type CalendarDisplayScope = 'professional' | 'client' | 'offices' | 'team'
export const eventKindLabels = { meeting: 'Rencontre', documentation: 'Rédaction', absence: 'Indisponibilité', other: 'Autre événement' }
export const eventStatusLabels = { planned: 'Planifié', completed: 'Réalisé', cancelled: 'Annulé', no_show: 'Client absent' }
export const modalityLabels = { office: 'Présentiel au bureau', home: 'À domicile', phone: 'Téléphone', video: 'Visioconférence' }
export const historyLabels: Record<string, string> = {
  appointment_created: 'Création', appointment_rescheduled: 'Horaire ou durée modifiés', appointment_cancelled: 'Annulation conservée',
  appointment_completed: 'Réalisation confirmée', appointment_no_show: 'Absence du client confirmée', activity_corrected: 'Activité corrigée',
  availability_changed: 'Disponibilités modifiées', office_created: 'Bureau créé', office_updated: 'Bureau modifié', office_grants_changed: 'Droits de bureau modifiés',
}
export function periodFor(date: string, view: CalendarView) {
  if (!validCalendarDate(date)) throw new Error('Choisissez une date valide.')
  let from = date, count = 1
  if (view === 'week') { from = shiftCalendarDate(date, 1 - calendarWeekday(date)); count = 7 }
  if (view === 'month') { const first = date.slice(0, 8) + '01'; from = shiftCalendarDate(first, 1 - calendarWeekday(first)); count = 42 }
  return { from, to: shiftCalendarDate(from, count - 1), days: Array.from({ length: count }, (_, index) => shiftCalendarDate(from, index)) }
}
export function shiftMonth(date: string, months: number): string {
  const initial = new Date(date + 'T12:00:00Z'), day = initial.getUTCDate()
  initial.setUTCDate(1); initial.setUTCMonth(initial.getUTCMonth() + months)
  const last = new Date(Date.UTC(initial.getUTCFullYear(), initial.getUTCMonth() + 1, 0, 12)).getUTCDate()
  initial.setUTCDate(Math.min(day, last))
  return initial.toISOString().slice(0, 10)
}
export function recurrenceDates(startLocal: string, recurrence?: CalendarRecurrence) {
  if (!recurrence) return [startLocal]
  return Array.from({ length: recurrence.count }, (_, index) => {
    const amount = index * recurrence.interval, date = startLocal.slice(0, 10)
    const next = recurrence.frequency === 'monthly' ? shiftMonth(date, amount) : shiftCalendarDate(date, amount * (recurrence.frequency === 'weekly' ? 7 : 1))
    return next + startLocal.slice(10)
  })
}
export function durationMinutes(hours: string, minutes: string): number {
  if (!/^\d+$/.test(hours) || !/^\d+$/.test(minutes)) throw new Error('Indiquez des heures et minutes entières.')
  const h = Number(hours), m = Number(minutes), total = h * 60 + m
  if (m > 59 || total < 1 || total > 720) throw new Error('La durée doit être comprise entre 1 minute et 12 heures ; les minutes entre 0 et 59.')
  return total
}
export function minutesLabel(minutes: number) { return Math.floor(minutes / 60) + ' h ' + String(minutes % 60).padStart(2, '0') }
export function clock(instant: string) { return localDateTime(instant).slice(11) }
export function frenchDay(date: string, short = false) { return new Intl.DateTimeFormat('fr-CA', { timeZone: 'UTC', weekday: short ? 'short' : 'long', day: 'numeric', month: short ? 'short' : 'long' }).format(new Date(date + 'T12:00:00Z')) }
export function officeColor(officeId: string | null, offices: DurableCalendarOffice[]) { return offices.find(office => office.id === officeId)?.color ?? '#786553' }
export function eventName(event: DurableCalendarEvent) { return event.clientName || event.title || eventKindLabels[event.kind] }
export function occursOn(startAt: string, endAt: string, day: string) {
  const start = localDateTime(startAt), end = localDateTime(endAt)
  return start.slice(0, 10) <= day && (end.slice(0, 10) > day || end.slice(0, 10) === day && end.slice(11) > '00:00')
}
export type TimedSegment<T> = { item: T; start: number; end: number; column: number; columns: number }
export function timedSegments<T extends { startAt: string; endAt: string }>(items: T[], day: string): TimedSegment<T>[] {
  const minute = (value: string) => Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16))
  const rows = items.filter(item => occursOn(item.startAt, item.endAt, day)).map(item => {
    const startLocal = localDateTime(item.startAt), endLocal = localDateTime(item.endAt)
    const start = startLocal.slice(0, 10) < day ? 0 : minute(startLocal)
    let end = endLocal.slice(0, 10) > day ? 1440 : minute(endLocal)
    if (end <= start) end = Math.min(1440, start + (Date.parse(item.endAt) - Date.parse(item.startAt)) / 60000)
    return { item, start, end, column: 0, columns: 1 }
  }).sort((a, b) => a.start - b.start || b.end - a.end)
  let group: TimedSegment<T>[] = [], groupEnd = -1
  const finish = () => { const count = Math.max(1, ...group.map(row => row.column + 1)); group.forEach(row => { row.columns = count }); group = [] }
  for (const row of rows) {
    if (row.start >= groupEnd) { finish(); groupEnd = -1 }
    const occupied = new Set(group.filter(other => other.end > row.start).map(other => other.column))
    while (occupied.has(row.column)) row.column++
    group.push(row); groupEnd = Math.max(groupEnd, row.end)
  }
  finish()
  return rows
}

export function filterCalendarEvents(events: DurableCalendarEvent[], filter: { scope: CalendarDisplayScope; professionalId: string; explicitProfessional: boolean; clientId: string; officeId: string; showCancelled: boolean }) {
  return events.filter(event => (filter.showCancelled || event.status !== 'cancelled') && (!filter.clientId || event.clientId === filter.clientId) && (!filter.officeId || event.officeId === filter.officeId)
    && (filter.scope === 'team' || filter.scope !== 'professional' && !filter.explicitProfessional || event.professionalId === filter.professionalId))
}
/** A committed write remains confirmed even if its subsequent read fails. */
export async function confirmCalendarWrite<T>(write: () => Promise<T>, refresh: () => Promise<boolean>, onConfirmed: () => void): Promise<{ ack: T; refreshed: boolean }> {
  const ack = await write()
  onConfirmed()
  try { return { ack, refreshed: await refresh() } } catch { return { ack, refreshed: false } }
}

/** Series order remains stable when a single occurrence was moved to another date. */
export function futureSeriesEvents(events: DurableCalendarEvent[], anchor: DurableCalendarEvent) {
  if (!anchor.seriesId || anchor.occurrenceIndex === null) return []
  return events.filter(event => event.seriesId === anchor.seriesId && event.occurrenceIndex !== null && event.occurrenceIndex >= anchor.occurrenceIndex! && event.status === 'planned')
    .sort((a, b) => a.occurrenceIndex! - b.occurrenceIndex!)
}
export async function refreshBeforeCalendarLink(refresh: () => Promise<void>, navigate: () => Promise<void>) {
  await refresh()
  await navigate()
}

export const primaryActivityColors = { meeting: '#245f70', documentation: '#a6742d', absence: '#b34444', other: '#75439a' } as const
export function activityColor(event: Pick<DurableCalendarEvent, 'kind' | 'status'>) {
  return event.status === 'no_show' || (event.status === 'cancelled' && event.kind === 'meeting') ? primaryActivityColors.absence : primaryActivityColors[event.kind]
}
/** The compact editor accepts every whole minute, not only five-minute slots. */
export function activityDurationMinutes(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('Indiquez une durée entière en minutes.')
  const minutes = Number(value)
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 720) throw new Error('La durée doit être comprise entre 1 et 720 minutes.')
  return minutes
}
export function stepActivityDuration(value: string, change: -5 | 5): string {
  return String(Math.max(1, Math.min(720, activityDurationMinutes(value) + change)))
}

export type CalendarSavedFocus = { clientId: string | null; professionalId: string; day: string; officeId: string | null }
/** Preserve the view and compatible filters; only a filter hiding the committed activity is removed. */
export function calendarSavedFocusPatch(scope: CalendarDisplayScope,
  current: { clientId: string; professionalId: string; officeId: string }, focus: CalendarSavedFocus, appointmentId: string): Record<string, string | null> {
  const patch: Record<string, string | null> = { day: focus.day, appointment: appointmentId }
  if (scope === 'client') patch.client = focus.clientId
  else if (current.clientId && current.clientId !== focus.clientId) patch.client = null
  if (scope === 'professional') patch.pro = focus.professionalId
  else if (scope !== 'team' && current.professionalId && current.professionalId !== focus.professionalId) patch.pro = null
  if (scope === 'offices') patch.office = focus.officeId
  else if (current.officeId && current.officeId !== focus.officeId) patch.office = null
  return patch
}

/** In a client's own calendar, a useful custom title replaces the repeated client identity. */
export function calendarEventLabel(event: Pick<DurableCalendarEvent, 'title' | 'clientName' | 'kind'>, clientContext = false): string {
  if (!clientContext) return event.clientName ? calendarClientName(event.clientName) : event.title || eventKindLabels[event.kind]
  const title = event.title.trim()
  const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-CA').replace(/\s+/g, ' ').trim()
  if (!title || event.clientName && normalized(title).includes(normalized(event.clientName))) return eventKindLabels[event.kind]
  return title
}

export function clientInitials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean)
  return [parts[0]?.[0], parts[1]?.[0]].filter(Boolean).join('.').toLocaleUpperCase('fr-CA')
}

/** Remove only generated lab suffixes from calendar captions and hover details. */
export function calendarClientName(name: string): string {
  return name.replace(/\s+[0-9a-f]{8}(?:-[\p{L}\p{N}]+)?$/iu, '').trim()
}
