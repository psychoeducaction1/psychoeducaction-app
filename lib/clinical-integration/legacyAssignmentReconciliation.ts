import { getAssignedClientStatus } from '@/app/professionnel/shared'

export type LegacyAssignment = {
  id: string
  waiting_list_client_id: string | null
  created_at?: string | null
  contacted: boolean | null
  is_active: boolean | null
  canceled_at: string | null
}

export type ClinicalSourceLink = {
  source_table: 'waiting_list_clients' | 'assigned_clients'
  source_id: string
  patient_id: string
  episode_id: string
}

export type LegacyAssignmentReconciliation = {
  assignmentId: string
  waitingListClientId: string | null
  status: 'not_contacted' | 'pending' | 'taken' | 'not_taken' | 'canceled'
  patientId: string | null
  episodeId: string | null
  action: 'already_linked' | 'link_waiting_source' | 'link_assignment' | 'link_waiting_source_and_assignment' | 'create_patient_and_episode' | 'create_episode_after_waiting_source' | 'review'
  reason: 'missing_waiting_source' | 'conflicting_patient' | 'duplicate_source_link' | null
}

/** Read-only preparation. Never infer identity from a name or grant clinical access here. */
export function reconcileLegacyAssignments(
  assignments: readonly LegacyAssignment[],
  links: readonly ClinicalSourceLink[],
): LegacyAssignmentReconciliation[] {
  const bySource = new Map<string, ClinicalSourceLink>()
  const duplicates = new Set<string>()
  for (const link of links) {
    const key = `${link.source_table}:${link.source_id}`
    if (bySource.has(key)) duplicates.add(key)
    else bySource.set(key, link)
  }

  const byWaiting = new Map<string, LegacyAssignment[]>()
  for (const assignment of assignments) {
    if (!assignment.waiting_list_client_id) continue
    const siblings = byWaiting.get(assignment.waiting_list_client_id) ?? []
    siblings.push(assignment)
    byWaiting.set(assignment.waiting_list_client_id, siblings)
  }
  for (const siblings of byWaiting.values()) {
    siblings.sort((left, right) => {
      const byDate = (left.created_at ?? '\uffff').localeCompare(right.created_at ?? '\uffff')
      return byDate || left.id.localeCompare(right.id)
    })
  }

  return assignments.map(assignment => {
    const waitingKey = assignment.waiting_list_client_id
      ? `waiting_list_clients:${assignment.waiting_list_client_id}` : null
    const assignmentKey = `assigned_clients:${assignment.id}`
    const waiting = waitingKey ? bySource.get(waitingKey) : undefined
    const linked = bySource.get(assignmentKey)
    const siblings = assignment.waiting_list_client_id
      ? byWaiting.get(assignment.waiting_list_client_id) ?? [] : []
    const linkedPatients = new Set(siblings.map(sibling =>
      bySource.get(`assigned_clients:${sibling.id}`)?.patient_id,
    ).filter((patientId): patientId is string => Boolean(patientId)))
    const siblingPatientId = linkedPatients.size === 1 ? [...linkedPatients][0] : null
    const base = {
      assignmentId: assignment.id,
      waitingListClientId: assignment.waiting_list_client_id,
      status: assignment.canceled_at ? 'canceled' as const : getAssignedClientStatus(assignment),
      patientId: linked?.patient_id ?? waiting?.patient_id ?? siblingPatientId,
      episodeId: linked?.episode_id ?? null,
    }
    if ((waitingKey && duplicates.has(waitingKey)) || duplicates.has(assignmentKey)) {
      return { ...base, action: 'review' as const, reason: 'duplicate_source_link' as const }
    }
    if (linkedPatients.size > 1 || (waiting && linkedPatients.size === 1
      && waiting.patient_id !== siblingPatientId)) {
      return { ...base, action: 'review' as const, reason: 'conflicting_patient' as const }
    }
    if (linked && waitingKey && !waiting) {
      return { ...base, action: 'link_waiting_source' as const, reason: null }
    }
    if (linked) return { ...base, action: 'already_linked' as const, reason: null }
    if (!waitingKey) return { ...base, action: 'review' as const, reason: 'missing_waiting_source' as const }
    if (waiting) return { ...base, action: 'link_assignment' as const, reason: null }
    if (siblingPatientId) return { ...base, action: 'link_waiting_source_and_assignment' as const, reason: null }
    return { ...base,
      action: siblings[0]?.id === assignment.id
        ? 'create_patient_and_episode' as const : 'create_episode_after_waiting_source' as const,
      reason: null }
  })
}
