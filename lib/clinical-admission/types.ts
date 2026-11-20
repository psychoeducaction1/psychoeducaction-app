import type { ClinicalAccessContext } from '@/lib/clinical-core/types'
import type { AssignedClientStatus } from '@/app/professionnel/shared'
import type { IntakeAppointment, ProspectStatus } from '@/lib/prospectsWorkspace'
import type { ProfessionalStructuredPreferences } from '@/lib/professionalPreferences'

/** Local durable admission contract. No independent memory writer and no provider transport. */
export type AdmissionStage = 'waiting' | 'assignment_in_progress' | 'assigned' | 'active' | 'closed' | 'blacklisted'
export type AdmissionPriority = 'normal' | 'urgent' | 'existing_or_transfer'
export type AssignmentProcessStatus = 'to_contact' | 'voicemail_left' | 'text_sent' | 'email_sent' | 'text_email_sent' | 'contacted_waiting_response' | 'interested' | 'client_refusal' | 'no_response' | 'assigned' | 'classified' | 'returned'
export type AdmissionPerson = { firstName: string; lastName: string; birthDate: string | null }
export type AdmissionDetails = {
  service: string; consultationReason: string; internalNotes: string
  requesterNames: string[]; emails: string[]; phones: string[]
  address: string; modalities: string[]; availability: string
}
export type AdmissionAppointment = IntakeAppointment & { version: number }
export type AdmissionProspect = AdmissionPerson & AdmissionDetails & {
  id: string; clientId: string | null; admissionId: string | null; version: number
  contactRequestType: 'appointment' | 'rapid_callback'; status: ProspectStatus
  receivedAt: string; rapidCallbackRequestedAt: string | null; sourceLabel: string
  outcomeDetails: string; appointments: AdmissionAppointment[]
}
export type AdmissionCase = AdmissionPerson & AdmissionDetails & {
  id: string; clientId: string; serviceRequestId: string; prospectId: string | null
  stage: AdmissionStage; priority: AdmissionPriority; version: number; identityVersion: number
  contactDate: string; receivedAt: string; updatedAt: string
}
export type ProfessionalCapacityRequest = {
  id: string; professionalId: string; requestedCount: number; comment: string
  offerSlots: { day: string; startMinute: number; endMinute: number }[]
  schedulePreference: '' | 'grouped' | 'spread' | 'flexible' | 'other'
  enabled: boolean; state: 'active' | 'inactive' | 'completed'; version: number
  acceptedCount: number; occupiedCount: number; remainingCount: number
  createdAt: string; updatedAt: string; completedAt: string | null
}
export type AdmissionProfessional = {
  id: string; displayName: string; isActive: boolean; canPractice: boolean
  email: string | null; professionalTitle: string | null; professionalPhone: string | null; professionalLicenseNumber: string | null
  preferences: ProfessionalStructuredPreferences; preferencesVersion: number
}
export type AdmissionProcess = {
  id: string; admissionId: string; clientId: string
  prospectiveProfessionalId: string | null; responsibleActorId: string
  status: AssignmentProcessStatus; version: number; details: string
  startedAt: string; firstContactAt: string | null; nextFollowupAt: string | null
  assignedAt: string | null; classifiedAt: string | null; returnedAt: string | null
}
export type AdmissionAssignment = {
  id: string; admissionId: string | null; clientId: string | null; serviceRequestId: string | null
  episodeId: string | null; professionalId: string; capacityRequestId: string | null
  processId: string | null; outcome: AssignedClientStatus; version: number
  status: 'active' | 'closed'; refusalReason: string
  clientSnapshot: AdmissionPerson & Omit<AdmissionDetails, 'internalNotes'>
  assignedAt: string; closedAt: string | null
  canceledAt: string | null; canceledBy: string | null; cancellationReason: string
  firstAppointmentDate: string | null; firstAppointmentTime: string | null; firstAppointmentModality: string | null
}
export type AdmissionEvent = {
  id: string; actorId: string; action: string; createdAt: string; note: string
  clientId: string | null; admissionId: string | null; prospectId: string | null
  processId: string | null; assignmentId: string | null; capacityRequestId: string | null
}
export type AdmissionTask = {
  id: string; admissionId: string | null; processId: string | null; clientId: string | null
  title: string; description: string; assignedTo: 'hajar' | 'fatima' | 'both'
  dueAt: string | null; status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  version: number; createdAt: string; completedAt: string | null
  kind: 'general' | 'assignment_support'; targetProfessionalId: string | null
  notes: { id: string; note: string; authorName: string; createdAt: string }[]
}
export type AdmissionNotification = {
  id: string; admissionId: string | null; clientId: string | null; assignmentId: string | null
  processId: string | null; capacityRequestId: string | null; kind: 'client' | 'professional' | 'internal'
  channel: 'email' | 'internal'; status: 'prepared' | 'simulated' | 'skipped' | 'recorded'
  recipientLabel: string; cc: string[]; purpose: 'assignment' | 'service_taken_confirmation' | 'pending_contact_reminder' | 'other'; supersedesNotificationId: string | null
  subject: string; body: string; createdAt: string
}
export type AdmissionCalendarBlock = {
  id: string; start_at: string; end_at: string; reason: string; version: number; active: boolean
}
export type AdmissionWorkspace = {
  mode: 'isolated_local' | 'isolated_unified'; durable: true; actorId: string; context: ClinicalAccessContext
  prospects: AdmissionProspect[]; admissions: AdmissionCase[]
  capacityRequests: ProfessionalCapacityRequest[]; professionals: AdmissionProfessional[]
  processes: AdmissionProcess[]; assignments: AdmissionAssignment[]
  tasks: AdmissionTask[]; notifications: AdmissionNotification[]
  events: AdmissionEvent[]; calendarBlocks: AdmissionCalendarBlock[]
}
export const ADMISSION_ACTIONS = [
  'prospects.create', 'prospects.outcome', 'prospects.transfer', 'prospects.followup',
  'calendar.block', 'calendar.unblock',
  'admissions.create', 'admissions.update', 'admissions.assign', 'admissions.process',
  'admissions.classify', 'admissions.restore',
  'capacities.create', 'capacities.update', 'capacities.set-enabled', 'preferences.update',
  'processes.update', 'processes.contact', 'processes.assign', 'processes.classify',
  'processes.return', 'processes.reopen',
  'assignments.result', 'assignments.return',
  'tasks.create', 'tasks.update', 'tasks.note', 'tasks.complete', 'notifications.simulate', 'notifications.review',
] as const
export type AdmissionAction = typeof ADMISSION_ACTIONS[number]
export type AdmissionCommandResult = {
  workspace: AdmissionWorkspace
  result: { kind: 'prospect' | 'admission' | 'capacity' | 'preferences' | 'process' | 'assignment' | 'block' | 'task' | 'notification'; id: string }
}

