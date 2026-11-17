import type { RealAppointment } from './workspaceClient'
import type { OfficeOccupation } from '@/components/clinical-calendar/officeModel'

export type OfficeCalendar = {
  appointments: RealAppointment[]
  busy: { officeId: string | null; startAt: string; endAt: string; resource: string }[]
  offices: { id: string; name: string }[]
}

/** A professional sees anonymous office occupancy for appointments outside their own caseload. */
export function officeOccupations(calendar: OfficeCalendar, officeId: string) {
  const intervals = [
    ...calendar.appointments.filter(item => item.officeId === officeId && item.status !== 'cancelled')
      .map(item => ({ startAt: item.startAt, endAt: item.endAt })),
    ...calendar.busy.filter(item => item.resource === 'office' && item.officeId === officeId)
      .map(item => ({ startAt: item.startAt, endAt: item.endAt })),
  ]
  return [...new Map(intervals.map(item => [item.startAt + '|' + item.endAt,
    { officeId, startAt: item.startAt, endAt: item.endAt, kind: 'busy' } as OfficeOccupation])).values()]
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
}
