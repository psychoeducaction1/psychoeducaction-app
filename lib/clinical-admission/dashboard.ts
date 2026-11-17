import type { AdmissionWorkspace } from './types'

type DashboardProfessional = {
  id: string
  name: string
  requestComment: string
  pendingClients: number
  noResponseClients: number
  remainingCount: number
}

/** Match the assignment dashboard's per-professional view using the isolated admission records. */
export function buildAdministrationDashboard(data: AdmissionWorkspace) {
  const activeProfessionals = data.professionals.filter(person => person.isActive)
  const assignments = data.assignments.filter(item => !item.canceledAt)
  const rows: DashboardProfessional[] = activeProfessionals.map(person => {
    const requests = data.capacityRequests.filter(item => item.professionalId === person.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const activeRequests = requests.filter(item => item.enabled && item.state === 'active')
    const request = activeRequests[0] ?? requests.find(item => item.state === 'completed') ?? requests[0]
    const ownAssignments = assignments.filter(item => item.professionalId === person.id)
    return {
      id: person.id,
      name: person.displayName,
      requestComment: request?.comment.trim() || '—',
      pendingClients: ownAssignments.filter(item => item.outcome === 'not_contacted' || item.outcome === 'pending').length,
      noResponseClients: ownAssignments.filter(item => item.outcome === 'not_taken').length,
      remainingCount: activeRequests.reduce((total, item) => total + Math.max(0, item.remainingCount), 0),
    }
  })
  const waiting = data.admissions.filter(item => item.stage === 'waiting')
  return {
    waiting: waiting.length,
    urgent: waiting.filter(item => item.priority !== 'normal').length,
    remaining: rows.reduce((total, item) => total + item.remainingCount, 0),
    pending: rows.reduce((total, item) => total + item.pendingClients, 0),
    taken: assignments.filter(item => item.outcome === 'taken' && activeProfessionals.some(person => person.id === item.professionalId)).length,
    refused: rows.reduce((total, item) => total + item.noResponseClients, 0),
    available: rows.filter(item => item.remainingCount > 0).sort((a, b) => b.remainingCount - a.remainingCount).slice(0, 8),
    attention: rows.filter(item => item.noResponseClients >= 3 || item.pendingClients > 0)
      .sort((a, b) => b.pendingClients - a.pendingClients).slice(0, 8),
  }
}
