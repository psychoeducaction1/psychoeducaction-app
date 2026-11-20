import type { AdmissionAssignment, ProfessionalCapacityRequest } from './types'

export function isAdministrativeAssignmentProcessed(assignment: Pick<AdmissionAssignment, 'canceledAt' | 'status' | 'outcome'>): boolean {
  return Boolean(assignment.canceledAt) || assignment.status === 'closed' || assignment.outcome === 'taken' || assignment.outcome === 'not_taken'
}

export function isProfessionalAssignmentHistory(assignment: Pick<AdmissionAssignment, 'canceledAt' | 'status' | 'outcome' | 'capacityRequestId'>, requests: readonly Pick<ProfessionalCapacityRequest, 'id' | 'state'>[]): boolean {
  void requests
  return Boolean(assignment.canceledAt) || assignment.status === 'closed' || assignment.outcome === 'not_taken'
}
