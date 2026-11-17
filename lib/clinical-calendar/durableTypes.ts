import type { ClinicalAccessContext, ClinicalNoteStatus, ClinicalNoteType } from '../clinical-core/types'
import type { AppointmentModality, AppointmentStatus, ClinicalAvailability } from './types'

// Durable local calendar contract; the older fixture DTOs remain independent.
export type CalendarEventKind = 'meeting' | 'documentation' | 'absence' | 'other'
export type CalendarScope = 'occurrence' | 'future'
export type CalendarRecurrence = { frequency: 'daily' | 'weekly' | 'monthly'; interval: number; count: number }
export type CalendarFeePercent = 0 | 50 | 100
export type CalendarAcceptedConditions = { reviewed: true; mandateRevisionId: string; documentId: string; documentHash: string; signatureId: string; allowedFeePercents: CalendarFeePercent[]; homeTravelPerformedAllowed: boolean; reason: string }
export type CalendarFinancialOverride = { hourlyRateCents: number | null; reason: string; payers: { personId: string; basisPoints: number }[] | null }
export type CalendarFinancialOptions = { mandateRevisionId: string | null; hourlyRateCents: number | null; hourlyOverrideCents: number | null; reason: string; payers: { personId: string; name: string; basisPoints: number }[]; conditionsId: string | null; acceptanceEvidence: { mandateRevisionId: string; documentId: string; documentHash: string; signatureId: string; signerName: string; signedAt: string }[] }
export type CalendarAbsenceDecision = { kind: 'none' | 'no_show' | 'late_cancellation' | 'timely_cancellation'; feePercent: CalendarFeePercent | null; noticeAt: string | null; recordedAt: string | null; travelPerformed: boolean; allowedFeePercents: CalendarFeePercent[]; homeTravelPerformedAllowed: boolean; nonzeroBlockedReason: 'ACCEPTED_CONDITIONS_REQUIRED' | 'HOME_TRAVEL_CONDITIONS_REQUIRED' | null }
export type CalendarFinancialContext = { episodeId: string; professionalId: string; serviceDate: string; billable: boolean; financialOptions: CalendarFinancialOptions | null; absenceDecision: CalendarAbsenceDecision }
export type CalendarFinancialInput = { billable?: boolean; financialOverride?: CalendarFinancialOverride; acceptedConditions?: CalendarAcceptedConditions }
export type CalendarCreateAbsence = { status: 'no_show' | 'cancelled'; feePercent: CalendarFeePercent; travelPerformed: boolean }
export type DurableCalendarProfessional = { id: string; name: string }
export type DurableCalendarClient = { clientId: string; episodeId: string; caseId: string | null; name: string; episodeLabel: string; serviceAddress: string; professionalIds: string[] }
export type DurableCalendarOffice = { id: string; name: string; color: string; active: boolean; version: number }
export type OfficeGrant = { officeId: string; professionalId: string; validFrom: string; validTo: string | null }
export type CalendarHistory = { id: string; appointmentId: string | null; professionalId: string | null; action: string; actorId: string | null; at: string; version: number | null }
export type CalendarActivity = { id: string; appointmentId: string; episodeId: string | null; professionalId: string; serviceDate: string; actualMinutes: number; travelKilometers: string; version: number; billingState: 'pending_future_rules'; billingNotBeforeDate: string }
export type CalendarClinicalLink = { recordId: string; canCreate: boolean; notes: { id: string; status: ClinicalNoteStatus; noteType: ClinicalNoteType; version: number }[] }
export type DurableCalendarEvent = {
  id: string; kind: CalendarEventKind; title: string; hiddenFromDirection: boolean; episodeId: string | null; caseId: string | null
  clientId: string | null; clientName: string | null; professionalId: string; startAt: string; endAt: string
  modality: AppointmentModality | null; officeId: string | null; location: string
  travelBeforeMinutes: number; travelAfterMinutes: number; travelKilometers: string; status: AppointmentStatus
  seriesId: string | null; seriesRevision: number | null; occurrenceIndex: number | null; isException: boolean
  version: number; createdAt: string; updatedAt: string; cancelledAt: string | null
  cancellationReason: 'client' | 'professional' | 'clinic' | null
  canRemove?: boolean; canCorrectEncounter?: boolean; canReschedule: boolean; canCancel: boolean; canRecordOutcome: boolean; canCorrectActivity: boolean
  activity: CalendarActivity | null; clinicalLink: CalendarClinicalLink | null
  billable: boolean; financialOptions: CalendarFinancialOptions | null; absenceDecision: CalendarAbsenceDecision; canChangeProfessional: boolean
}
export type DurableCalendarWorkspace = {
  mode: 'isolated_local' | 'isolated_unified'; durable: true; actorId: string; context: ClinicalAccessContext; currentTime: string; from: string; to: string
  professionals: DurableCalendarProfessional[]; clients: DurableCalendarClient[]; offices: DurableCalendarOffice[]
  officeGrants: OfficeGrant[]; officeGrantRevisions: Record<string, number>; availability: ClinicalAvailability[]; availabilityRevisions: Record<string, number>
  appointments: DurableCalendarEvent[]; busy: { officeId: string; startAt: string; endAt: string; kind: 'busy' }[]; history: CalendarHistory[]
}
export type CalendarEventInput = CalendarFinancialInput & {
  kind: CalendarEventKind; title: string; hiddenFromDirection?: boolean; episodeId: string | null; professionalId: string; startLocal: string; durationMinutes: number
  modality: AppointmentModality | null; officeId: string | null; location: string; travelBeforeMinutes?: number; travelAfterMinutes?: number; travelKilometers: string
  absenceDecision?: CalendarCreateAbsence
  disambiguation?: 'earlier' | 'later'; recurrence?: CalendarRecurrence
}
export type CalendarCommand =
  | { action: 'appointments.create'; id: null; data: CalendarEventInput }
  | { action: 'appointments.reschedule'; id: string; data: Omit<CalendarEventInput, 'recurrence' | 'episodeId' | 'professionalId' | 'kind' | 'absenceDecision'> & { absenceDecision?: CalendarCreateAbsence; professionalId?: string; expectedVersion: number; scope: CalendarScope; expectedSeriesRevision?: number } }
  | { action: 'appointments.correct'; id: string; data: { expectedVersion: number; previewHash: string; confirmed: true; reason: string; title: string; startLocal: string; durationMinutes: number; modality: AppointmentModality | null; officeId: string | null; location: string; travelBeforeMinutes: number; travelAfterMinutes: number; travelKilometers: string; disambiguation?: 'earlier' | 'later' } }
  | { action: 'appointments.remove'; id: string; data: { expectedVersion: number; previewHash: string; confirmed: true } }
  | { action: 'appointments.cancel'; id: string; data: { expectedVersion: number; scope: CalendarScope; expectedSeriesRevision?: number; reason: 'client' | 'professional' | 'clinic'; feePercent?: CalendarFeePercent; travelPerformed?: boolean } }
  | { action: 'appointments.outcome'; id: string; data: { expectedVersion: number; status: 'completed' | 'no_show'; actualMinutes?: number; travelKilometers?: string; feePercent?: CalendarFeePercent; travelPerformed?: boolean } }
  | { action: 'availability.set'; id: string; data: { expectedRevision: number; windows: { weekday: number; startMinute: number; endMinute: number; validFrom: string; validTo: string | null }[] } }
  | { action: 'offices.create'; id: null; data: { name: string; color: string } }
  | { action: 'offices.update'; id: string; data: { expectedVersion: number; name: string; color: string; active: boolean } }
  | { action: 'office-grants.set'; id: string; data: { expectedRevision: number; grants: { officeId: string; validFrom: string; validTo: string | null }[] } }
  | { action: 'activities.correct'; id: string; data: { expectedVersion: number; actualMinutes: number; travelKilometers: string; reason: string } }
export type CalendarCommandAck = { mode: 'isolated_local' | 'isolated_unified'; durable: true; actorId: string; context: ClinicalAccessContext; result: { kind: string; id: string; affectedIds: string[]; version: number | null } }
