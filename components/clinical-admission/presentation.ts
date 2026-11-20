import type { AdmissionAssignment, AdmissionWorkspace, ProfessionalCapacityRequest } from '@/lib/clinical-admission/types'
import type { ProspectStatus } from '@/lib/prospectsWorkspace'

/** A request with no remaining place must not hide other active requests. */
export function capacityPlaces(requests: Array<Pick<ProfessionalCapacityRequest, 'professionalId' | 'state' | 'enabled' | 'remainingCount'>>, professionalId: string): number {
  return requests.filter(item => item.professionalId === professionalId && item.enabled && item.state === 'active')
    .reduce((total, item) => total + Math.max(0, item.remainingCount), 0)
}
/** Filled places stop appearing as a request to fill, while pending results can still free a place. */
export function isCapacityRequestToFill(request: Pick<ProfessionalCapacityRequest, 'state' | 'enabled' | 'remainingCount'>): boolean {
  return request.enabled && request.state === 'active' && request.remainingCount > 0
}
/** Assigned places awaiting a contact result remain part of the current request. */
export function isCapacityRequestPending(request: Pick<ProfessionalCapacityRequest, 'state' | 'enabled' | 'requestedCount' | 'acceptedCount'>): boolean {
  return request.enabled && request.state === 'active' && request.acceptedCount < request.requestedCount
}
export function capacityRequestProgress(requestId: string, assignments: Array<Pick<AdmissionAssignment, 'capacityRequestId' | 'outcome' | 'canceledAt'>>) {
  const relevant = assignments.filter(item => item.capacityRequestId === requestId && !item.canceledAt)
  return {
    notTaken: relevant.filter(item => item.outcome === 'not_taken').length,
    toContact: relevant.filter(item => item.outcome === 'not_contacted').length,
    awaitingResponse: relevant.filter(item => item.outcome === 'pending').length,
  }
}
export function capacityRequestStatus(request: Pick<ProfessionalCapacityRequest, 'state' | 'remainingCount' | 'acceptedCount' | 'requestedCount'>): string {
  if (request.state === 'completed') return 'Complétée'
  if (request.state === 'inactive') return 'Désactivée'
  if (request.remainingCount === 0 && request.acceptedCount < request.requestedCount) return 'Assignations en cours · résultats à confirmer'
  return 'À combler'
}
export const prospectStatusLabels: Record<ProspectStatus, string> = {
  new: 'À contacter', scheduled: 'À contacter', callback_requested: 'À contacter', contacted: 'Contacté',
  service_taken: 'Service pris', service_not_taken: 'Service non pris', other: 'Autre', transferred_to_waiting_list: 'Transféré en liste d’attente',
}
const eventLabels: Record<string, string> = {
  admission_created: 'Demande créée', admission_updated: 'Demande modifiée', admission_classified: 'Demande classée', admission_restored: 'Demande remise en attente',
  assignment_created: 'Assignation créée', assignment_returned: 'Assignation annulée et retournée', assignment_result_recorded: 'Résultat de prise en charge enregistré',
  prospect_created: 'Demande d’appel créée', prospect_transferred: 'Demande d’appel transférée', prospect_followup_created: 'Nouveau rendez-vous créé', prospect_outcome_recorded: 'Résultat d’appel enregistré',
  calendar_blocked: 'Créneau bloqué', calendar_unblocked: 'Créneau libéré', capacity_created: 'Demande professionnelle créée', capacity_updated: 'Demande professionnelle modifiée', preferences_updated: 'Préférences modifiées',
  process_started: 'Démarche ouverte', process_updated: 'Démarche modifiée', process_reopened: 'Démarche rouverte', process_classified: 'Démarche classée', process_returned: 'Démarche retournée en attente',
  contact_call: 'Appel déclaré', contact_voicemail: 'Message vocal déclaré', contact_sms_manual: 'Texto déclaré manuellement', contact_email_simulated: 'Courriel simulé',
  task_created: 'Tâche créée', task_completed: 'Tâche terminée', task_note_added: 'Note ajoutée à la tâche',
  notification_prepared: 'Courriel préparé', notification_simulated: 'Communication simulée', notification_skipped: 'Courriel non envoyé',
  service_taken_confirmation_simulated: 'Confirmation du rendez-vous simulée',
}
export function admissionEventLabel(action: string) { return eventLabels[action] ?? 'Événement d’admission' }
export function notificationProfessionalTarget(data: Pick<AdmissionWorkspace, 'assignments' | 'processes'>, admissionId: string, processId?: string) {
  const assignment = data.assignments.filter(item => item.admissionId === admissionId && !item.canceledAt && item.status === 'active' && (!processId || item.processId === processId))
    .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))[0]
  const process = processId ? data.processes.find(item => item.id === processId && item.admissionId === admissionId) : undefined
  return { assignmentId: assignment?.id ?? null, available: Boolean(assignment || process?.prospectiveProfessionalId) }
}
/** A tab change is navigation: discard only the old detail selection after its guards allow it. */
export function waitingTabSelectionPatch(query: URLSearchParams, nextTab: 'waiting' | 'history'): Record<string, string | null> {
  const currentTab = query.get('tab') === 'history' ? 'history' : 'waiting'
  return currentTab === nextTab ? { tab: nextTab } : { tab: nextTab, admission: null }
}
