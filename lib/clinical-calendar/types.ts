import type { ClinicalAccessContext, ClinicalActorInput, ClinicalCapability } from '../clinical-core/types'
export type CalendarRole = 'admin' | 'assistant' | 'professional' | 'supervisor'
export type CalendarActor = { id: string; role: CalendarRole; name: string; capabilities?: ClinicalCapability[]; context?: ClinicalAccessContext }
export type CalendarClient = { id: string; firstName: string; lastName: string }
export type CalendarCase = { id: string; clientId: string; professionalIds: string[]; status: 'open' | 'closed' }
export type CalendarDirectory = {
  actors: () => readonly CalendarActor[]
  clientsFor: (actorId: ClinicalActorInput) => readonly CalendarClient[]
  casesFor: (actorId: string) => readonly CalendarCase[]
}
export type AppointmentModality = 'office' | 'home' | 'phone' | 'video'
export type AppointmentStatus = 'planned' | 'completed' | 'cancelled' | 'no_show'
export type ClinicalOffice = { id: string; name: string; color: string; active: boolean }
export type ClinicalAvailability = {
  id: string; professionalId: string; weekday: number; startMinute: number; endMinute: number
  validFrom: string; validTo: string | null
}
export type ClinicalAppointment = {
  id: string; caseId: string; clientId: string; professionalId: string; startAt: string; endAt: string
  modality: AppointmentModality; officeId: string | null; travelBeforeMinutes: number; travelAfterMinutes: number
  status: AppointmentStatus; seriesId: string | null; version: number; createdAt: string; updatedAt: string
  cancelledAt: string | null; cancellationReason: 'client' | 'professional' | 'clinic' | null
}
export type CalendarAuditEvent = {
  id: string; actorId: string; context?: ClinicalAccessContext; appointmentId: string | null; professionalId: string; action: string; at: string; version: number | null
}
export type CalendarStore = {
  appointments: ClinicalAppointment[]; offices: ClinicalOffice[]; availability: ClinicalAvailability[]; availabilityRevisions: Record<string, number>; audit: CalendarAuditEvent[]
}
export type CalendarClientChoice = { clientId: string; caseId: string; name: string; professionalIds: string[] }
export type CalendarBusy = { professionalId: string; officeId: string | null; startAt: string; endAt: string; kind: 'busy'; resource: 'professional' | 'office' }
export type CalendarAppointmentView = ClinicalAppointment & { clientName: string; canManage: boolean }
export type CalendarWorkspace = {
  mode: 'isolated_fixture'; durable: false; context: ClinicalAccessContext; currentTime: string; actor: CalendarActor; professionals: CalendarActor[]
  clients: CalendarClientChoice[]; offices: ClinicalOffice[]; appointments: CalendarAppointmentView[]; busy: CalendarBusy[]
  availability: ClinicalAvailability[]; availabilityRevisions: Record<string, number>; audit: CalendarAuditEvent[]; from: string; to: string
}
export type CreateAppointmentInput = {
  caseId: string; professionalId: string; startLocal: string; durationMinutes: number; modality: AppointmentModality
  officeId?: string | null; travelBeforeMinutes?: number; travelAfterMinutes?: number
  recurrence?: { frequency: 'weekly'; count: number }; disambiguation?: 'earlier' | 'later'
}
export type RescheduleAppointmentInput = Omit<CreateAppointmentInput, 'caseId' | 'professionalId' | 'recurrence'> & { expectedVersion: number }
export type NoteAppointmentReference = Pick<ClinicalAppointment, 'id' | 'caseId' | 'clientId' | 'professionalId' | 'startAt' | 'endAt' | 'modality' | 'status' | 'version'>
export type CalendarServiceErrorCode = 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'OUTSIDE_AVAILABILITY' | 'VERSION_CONFLICT' | 'INVALID_TRANSITION'
const CALENDAR_ERROR_BRAND = Symbol.for('pea.clinical.calendar.error.v1')
export class CalendarServiceError extends Error {
  readonly [CALENDAR_ERROR_BRAND] = true
  code: CalendarServiceErrorCode
  status: number
  constructor(code: CalendarServiceErrorCode, message: string, status: number = 400) { super(message); this.code = code; this.status = status }
}
export function isCalendarServiceError(value: unknown): value is CalendarServiceError {
  return value instanceof CalendarServiceError || (value instanceof Error && CALENDAR_ERROR_BRAND in value && value[CALENDAR_ERROR_BRAND] === true && 'status' in value && typeof value.status === 'number' && 'code' in value && typeof value.code === 'string')
}
