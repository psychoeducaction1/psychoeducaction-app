import type { DurableCalendarOffice, DurableCalendarWorkspace } from '@/lib/clinical-calendar/durableTypes'
import { localDateTime, shiftCalendarDate, torontoLocalInstant } from '@/lib/clinical-calendar/time'

export type OfficeOccupation = { officeId: string; startAt: string; endAt: string; kind: 'busy' }
/** Both own and colleague reservations become the same anonymous interval before rendering. */
export function officeOccupations(data: Pick<DurableCalendarWorkspace, 'appointments' | 'busy' | 'offices'>): OfficeOccupation[] {
  const allowed = new Set(data.offices.map(office => office.id)), result = new Map<string, OfficeOccupation>()
  for (const row of [...data.appointments.filter(event => event.status !== 'cancelled' && event.officeId).map(event => ({ officeId: event.officeId!, startAt: event.startAt, endAt: event.endAt })), ...data.busy]) {
    if (!allowed.has(row.officeId)) continue
    const occupation: OfficeOccupation = { officeId: row.officeId, startAt: row.startAt, endAt: row.endAt, kind: 'busy' }
    result.set([occupation.officeId, occupation.startAt, occupation.endAt].join('|'), occupation)
  }
  return [...result.values()].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.officeId.localeCompare(b.officeId))
}
export function selectedOfficeIds(query: string | null, offices: readonly (Pick<DurableCalendarOffice, 'id'> & Partial<Pick<DurableCalendarOffice, 'name'>>)[]): string[] {
  if (query === null || query === '') return offices.map(office => office.id)
  if (query === 'none') return []
  const requested = new Set(query.split(/[,.]/))
  return offices.filter(office => requested.has(office.id) || requested.has(officeUrlKey(office, offices))).map(office => office.id)
}
export function officeSelectionQuery(ids: readonly string[], offices: readonly Pick<DurableCalendarOffice, 'id'>[]): string | null {
  const selected = offices.filter(office => ids.includes(office.id)).map(office => office.id)
  return selected.length === offices.length ? null : selected.length ? selected.map(id => officeUrlKey(offices.find(office => office.id === id)!, offices)).join('.') : 'none'
}
const fallbackColors = ['#245f70', '#a65b31', '#62559b', '#38764c', '#b03e68', '#3569a4', '#887420', '#974545', '#4d7375', '#8e5281', '#546b36', '#a95c51']
function hashId(id: string) { let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return hash }
/** Stored unique colors remain unchanged. Duplicate colors get a deterministic display-only fallback. */
export function officeDisplayColors(offices: readonly Pick<DurableCalendarOffice, 'id' | 'color'>[]): Record<string, string> {
  const counts = new Map<string, number>()
  for (const office of offices) counts.set(office.color.toLowerCase(), (counts.get(office.color.toLowerCase()) ?? 0) + 1)
  const used = new Set(offices.filter(office => counts.get(office.color.toLowerCase()) === 1).map(office => office.color.toLowerCase()))
  const result: Record<string, string> = {}
  for (const office of [...offices].sort((a, b) => a.id.localeCompare(b.id))) {
    if (counts.get(office.color.toLowerCase()) === 1) { result[office.id] = office.color; continue }
    const seed = hashId(office.id)
    let color = fallbackColors[seed % fallbackColors.length], step = 0
    while (used.has(color.toLowerCase())) { step++; color = step < fallbackColors.length ? fallbackColors[(seed + step) % fallbackColors.length] : 'hsl(' + ((seed + step * 137.508) % 360).toFixed(3) + ' 55% 38%)' }
    used.add(color.toLowerCase()); result[office.id] = color
  }
  return result
}

export type OfficeDayTimeline = { startAt: string; endAt: string; minutes: number; ticks: { minute: number; label: string }[]; repeatedHours: string[] }
const timelineCache = new Map<string, OfficeDayTimeline>()
/** Elapsed UTC minutes preserve real intervals through both local clock transitions. */
export function officeDayTimeline(day: string): OfficeDayTimeline {
  const cached = timelineCache.get(day)
  if (cached) return cached
  const startAt = torontoLocalInstant(day + 'T00:00'), endAt = torontoLocalInstant(shiftCalendarDate(day, 1) + 'T00:00')
  const minutes = (Date.parse(endAt) - Date.parse(startAt)) / 60000
  const hours = Array.from({ length: Math.ceil(minutes / 60) }, (_, hour) => localDateTime(new Date(Date.parse(startAt) + hour * 3600000)).slice(11, 13))
  const repeatedHours = [...new Set(hours.filter((hour, index) => hours.indexOf(hour) !== index))]
  const ticks = hours.map((hour, index) => ({ minute: index * 60, label: hour + ' h' + (repeatedHours.includes(hour) ? hours.slice(0, index + 1).filter(value => value === hour).length === 1 ? ' · 1re' : ' · 2e' : '') }))
  const result = { startAt, endAt, minutes, ticks, repeatedHours }
  if (timelineCache.size >= 64) timelineCache.delete(timelineCache.keys().next().value!)
  timelineCache.set(day, result)
  return result
}
export function officeSlotAtElapsed(day: string, minute: number): { day: string; minute: number; instant: string; disambiguation?: 'earlier' | 'later' } {
  const timeline = officeDayTimeline(day)
  if (!Number.isInteger(minute) || minute < 0 || minute >= timeline.minutes) throw new Error('Plage horaire hors de cette journée.')
  const instant = new Date(Date.parse(timeline.startAt) + minute * 60000).toISOString(), local = localDateTime(instant)
  const wallMinute = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16))
  const disambiguation = timeline.repeatedHours.includes(local.slice(11, 13)) ? torontoLocalInstant(local, 'earlier') === instant ? 'earlier' as const : 'later' as const : undefined
  return { day: local.slice(0, 10), minute: wallMinute, instant, ...(disambiguation ? { disambiguation } : {}) }
}
export type OfficeTimeSegment = { row: OfficeOccupation; start: number; end: number }
export function officeSegments(rows: readonly OfficeOccupation[], officeId: string, day: string): OfficeTimeSegment[] {
  const timeline = officeDayTimeline(day), midnight = Date.parse(timeline.startAt)
  return rows.filter(row => row.officeId === officeId && Date.parse(row.startAt) < Date.parse(timeline.endAt) && Date.parse(row.endAt) > midnight).map(row => ({
    row, start: Math.max(0, (Date.parse(row.startAt) - midnight) / 60000), end: Math.min(timeline.minutes, (Date.parse(row.endAt) - midnight) / 60000),
  })).filter(segment => segment.start < segment.end)
}
export function firstFreeMinuteInOfficeSegments(segments: readonly OfficeTimeSegment[], start: number, end: number, maximum: number): number | null {
  let candidate = Math.max(0, Math.floor(start))
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    if (segment.end <= candidate) continue
    if (segment.start > candidate) break
    candidate = Math.max(candidate, Math.ceil(segment.end))
  }
  return candidate < Math.min(maximum, end) ? candidate : null
}
export function firstFreeOfficeMinute(rows: readonly OfficeOccupation[], officeId: string, day: string, start: number, end: number): number | null {
  return firstFreeMinuteInOfficeSegments(officeSegments(rows, officeId, day), start, end, officeDayTimeline(day).minutes)
}

export function officeReservationProfessional(data: Pick<DurableCalendarWorkspace, 'actorId' | 'professionals' | 'officeGrants'>, administrative: boolean, officeId: string, day: string): string | null {
  const candidates = administrative ? data.professionals.map(pro => pro.id) : [data.actorId]
  return candidates.find(id => data.officeGrants.some(grant => grant.officeId === officeId && grant.professionalId === id && grant.validFrom <= day && (!grant.validTo || grant.validTo >= day))) ?? null
}

/** Distinguish the two local occurrences without exposing any reservation identity. */
export function officeClock(instant: string): string {
  const local = localDateTime(instant), timeline = officeDayTimeline(local.slice(0, 10))
  if (!timeline.repeatedHours.includes(local.slice(11, 13))) return local.slice(11)
  const earlier = Date.parse(torontoLocalInstant(local, 'earlier'))
  return local.slice(11) + (Date.parse(instant) < earlier + 60000 ? ' (1re)' : ' (2e)')
}

/** Presentation only: retain the original office IDs and stored names. */
export function officeDisplayName(office: Pick<DurableCalendarOffice, 'id' | 'name'>): string {
  const legacyLongueuil = office.id === '546baf24-c0ef-48f5-90c5-3e904074693a' || office.id === 'fee9ad73-9f51-40cb-b610-f81196c00fe2'
  return legacyLongueuil && /^bureau\s+(101|102)$/i.test(office.name.trim()) ? 'Longueuil — bureau ' + office.name.trim().match(/(101|102)$/)![1] : office.name
}
export function officeShortLabel(office: Pick<DurableCalendarOffice, 'name'>): string {
  const number = office.name.match(/\bbureau\s+(\d+[a-z]?)\s*$/i)?.[1]
  return number ? 'B' + number : office.name
}

/** Human-readable filters resolve only within the already-authorized office catalog. */
function officeUrlKey(office: Pick<DurableCalendarOffice, 'id'> & Partial<Pick<DurableCalendarOffice, 'name'>>, offices: readonly (Pick<DurableCalendarOffice, 'id'> & Partial<Pick<DurableCalendarOffice, 'name'>>)[]): string {
  const key = (name: string) => { const number = name.match(/\bbureau\s+(\d+[a-z]?)\s*$/i)?.[1]; return number ? 'b' + number.toLowerCase() : '' }
  const token = key(office.name ?? '')
  return token && offices.filter(candidate => key(candidate.name ?? '') === token).length === 1 ? token : office.id
}
