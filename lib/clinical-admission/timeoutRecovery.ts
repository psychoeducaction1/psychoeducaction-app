import type { AdmissionAction, AdmissionCommandResult, AdmissionWorkspace } from './types'

/** A timed-out response is successful only when the refreshed projection proves this exact booking. */
export function confirmedAssignmentAfterTimeout(workspace: AdmissionWorkspace, action: AdmissionAction, processId: string | null, data: Record<string, unknown>): AdmissionCommandResult | null {
  if (action !== 'processes.assign' || !processId) return null
  const process = workspace.processes.find(item => item.id === processId)
  if (process?.status !== 'assigned' || !Number.isInteger(data.expectedVersion) || process.version <= Number(data.expectedVersion)) return null
  const assignment = workspace.assignments.find(item => item.processId === processId
    && item.status === 'active' && item.canceledAt === null
    && item.firstAppointmentDate === data.appointmentDate
    && item.firstAppointmentTime === data.appointmentTime
    && item.firstAppointmentModality === data.appointmentModality)
  return assignment ? { workspace, result: { kind: 'assignment', id: assignment.id } } : null
}

export function hasAvailableAssignmentCapacity(workspace: AdmissionWorkspace, professionalId: string): boolean {
  return workspace.capacityRequests.some(item => item.professionalId === professionalId
    && item.enabled && item.state === 'active' && item.remainingCount > 0)
}
