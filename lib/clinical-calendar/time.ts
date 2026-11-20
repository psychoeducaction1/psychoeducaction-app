import { CalendarServiceError } from './types.ts'

export const CLINICAL_TIME_ZONE = 'America/Toronto'
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINICAL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function localDateTime(instant: string | Date): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant
  if (Number.isNaN(date.getTime())) throw new CalendarServiceError('INVALID_INPUT', 'Date invalide.')
  const p = Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
export function shiftCalendarDate(date: string, days: number): string {
  if (!validCalendarDate(date) || !Number.isInteger(days)) throw new CalendarServiceError('INVALID_INPUT', 'Date invalide.')
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
/** Les deux décalages Toronto sont essayés : aucun ajustement silencieux d'une heure inexistante. */
export function torontoLocalInstant(value: string, disambiguation?: 'earlier' | 'later'): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match || !validCalendarDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59) {
    throw new CalendarServiceError('INVALID_INPUT', 'Indiquez une date et une heure valides à Montréal.')
  }
  const nominal = Date.parse(`${value}:00.000Z`)
  const candidates = [4, 5].map(offset => new Date(nominal + offset * 3_600_000).toISOString()).filter(instant => localDateTime(instant) === value)
  if (!candidates.length) throw new CalendarServiceError('INVALID_INPUT', 'Cette heure n’existe pas lors du changement d’heure. Choisissez un autre horaire.')
  if (candidates.length > 1 && !disambiguation) throw new CalendarServiceError('INVALID_INPUT', 'Cette heure se produit deux fois. Précisez la première ou la deuxième occurrence.')
  return disambiguation === 'later' ? candidates.at(-1)! : candidates[0]
}
export function addMinutes(instant: string, minutes: number): string {
  return new Date(Date.parse(instant) + minutes * 60_000).toISOString()
}
export function calendarWeekday(date: string): number { return new Date(`${date}T12:00:00Z`).getUTCDay() || 7 }
export function intervalsOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return Date.parse(startA) < Date.parse(endB) && Date.parse(startB) < Date.parse(endA)
}
export function calendarRange(from: string, to: string): { from: string; to: string } {
  if (!validCalendarDate(from) || !validCalendarDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) {
    throw new CalendarServiceError('INVALID_INPUT', 'La période du calendrier doit contenir de 1 à 93 jours.')
  }
  return { from: torontoLocalInstant(`${from}T00:00`), to: torontoLocalInstant(`${shiftCalendarDate(to, 1)}T00:00`) }
}
