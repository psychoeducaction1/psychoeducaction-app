import type { AdmissionAssignment } from './types'
import type { WorkspaceView } from '../clinical-core/types'

export const professionalClientLabels = { not_contacted: 'À contacter', pending: 'En attente de réponse', taken: 'Suivi actif', archived: 'Archivé' } as const
export type ProfessionalClientStatus = keyof typeof professionalClientLabels
export type ProfessionalClientRow = { key: string; clientId: string | null; firstName: string; lastName: string; status: ProfessionalClientStatus; assignments: AdmissionAssignment[] }
const priority: Record<ProfessionalClientStatus, number> = { not_contacted: 0, pending: 1, taken: 2, archived: 3 }

/** Group only by persistent identity; never merge homonyms. No workflow state is written. */
export function professionalClientRows(workspace: WorkspaceView, assignments: readonly AdmissionAssignment[], professionalId: string): ProfessionalClientRow[] {
  const rows = new Map<string, ProfessionalClientRow>()
  const records = [...workspace.records, ...workspace.managedRecords].filter(record => record.members.some(member => member.actorId === professionalId && member.canRead))
  for (const assignment of assignments.filter(item => item.professionalId === professionalId)) {
    const key = assignment.clientId ?? `assignment:${assignment.id}`
    const archived = Boolean(assignment.canceledAt || assignment.status === 'closed' || assignment.outcome === 'not_taken')
    const ownRecords = records.filter(record => record.clientId === assignment.clientId && (!assignment.episodeId || record.episodeId === assignment.episodeId))
    const status: ProfessionalClientStatus = archived || (assignment.outcome === 'taken' && ownRecords.length > 0 && ownRecords.every(record => record.status === 'closed')) ? 'archived' : assignment.outcome === 'not_taken' ? 'archived' : assignment.outcome
    const row = rows.get(key)
    if (row) {
      row.assignments.push(assignment)
      if (priority[status] < priority[row.status]) row.status = status
    } else rows.set(key, { key, clientId: assignment.clientId, firstName: assignment.clientSnapshot.firstName, lastName: assignment.clientSnapshot.lastName, status, assignments: [assignment] })
  }
  // Include imported clinical dossiers even when no operational assignment was created.
  for (const client of workspace.clients) {
    const ownRecords = records.filter(record => record.clientId === client.id)
    const ownAssignments = client.assignments.filter(item => item.professionalId === professionalId)
    if (!ownRecords.length && !ownAssignments.length) continue
    const active = ownRecords.length ? ownRecords.some(record => record.status === 'open') : ownAssignments.some(item => item.status === 'active')
    const row = rows.get(client.id)
    if (row) { if (active && row.status === 'archived') row.status = 'taken' }
    else rows.set(client.id, { key: client.id, clientId: client.id, firstName: client.firstName, lastName: client.lastName, status: active ? 'taken' : 'archived', assignments: [] })
  }
  return [...rows.values()].sort((a, b) => priority[a.status] - priority[b.status] || `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr') || a.key.localeCompare(b.key))
}
