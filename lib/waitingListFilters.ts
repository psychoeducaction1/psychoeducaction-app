type SpecialProgramClient = {
  service_requested?: string | null
  consultation_reason?: string | null
  internal_notes?: string | null
  availability?: string | null
  first_requester_name?: string | null
  second_requester_name?: string | null
}

type AssignmentProcessSummary = {
  waiting_list_client_id: string
  status: string
}

export function getActiveAssignmentProcessClientIds(
  processes: readonly AssignmentProcessSummary[]
) {
  return new Set(
    processes
      .filter((process) => !['assigned', 'classified', 'returned'].includes(process.status))
      .map((process) => process.waiting_list_client_id)
  )
}

export function getWaitingListClientSections<
  T extends { id: string; status: string | null }
>(clients: readonly T[], activeAssignmentProcessClientIds: ReadonlySet<string>) {
  const visibleClients = clients.filter(
    (client) => !activeAssignmentProcessClientIds.has(client.id)
  )

  return {
    waiting: visibleClients.filter((client) => client.status === 'waiting'),
    assigned: visibleClients.filter((client) => client.status === 'assigned'),
    // La vue des assignés est aussi un sous-ensemble de l'historique consultable.
    history: visibleClients.filter((client) =>
      ['assigned', 'active', 'closed', 'blacklisted'].includes(client.status ?? '')
    ),
  }
}

export function hasSpecialProgramMarker(client: SpecialProgramClient) {
  const searchableText = [
    client.service_requested,
    client.consultation_reason,
    client.internal_notes,
    client.availability,
    client.first_requester_name,
    client.second_requester_name,
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return /\b(ivac|pae|cnesst)\b/.test(searchableText)
}
