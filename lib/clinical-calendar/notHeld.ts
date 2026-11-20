import type { CalendarFeePercent, DurableCalendarEvent } from './durableTypes'

/** Fees come from accepted conditions, never from a free-form amount. */
export function notHeldFeeChoices(event: DurableCalendarEvent, status: 'cancelled' | 'no_show', reason: 'client' | 'professional' | 'clinic', now: number): CalendarFeePercent[] {
  if (!event.billable || status === 'cancelled' && (reason !== 'client' || Date.parse(event.startAt) - now >= 86400000)) return [0]
  return [0, ...event.absenceDecision.allowedFeePercents.filter(value => value !== 0)]
}

export type NotHeldPreview = { appointmentId: string; version: number; hash: string; noteCount: number; invoiceCount: number; paidInvoiceCount: number }
export function isNotHeldPreview(value: unknown, event: DurableCalendarEvent): value is NotHeldPreview {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return p.appointmentId === event.id && p.version === event.version && typeof p.hash === 'string' && /^[a-f0-9]{64}$/.test(p.hash)
    && ['noteCount', 'invoiceCount', 'paidInvoiceCount'].every(key => Number.isSafeInteger(p[key]) && Number(p[key]) >= 0 && Number(p[key]) <= 10000)
}
