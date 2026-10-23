import type { SupabaseClient } from '@supabase/supabase-js'
import type { ServiceAppointmentInput, ServiceAppointment } from '@/lib/serviceAppointment'
export type ActiveWaitingListAssignmentRequest = {
  id: string
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  occupied_count?: number | null
}

export type AssignableWaitingListClient = {
  id: string
  client_name: string | null
  first_requester_name: string | null
  second_requester_name: string | null
  contact_email: string | null
  contact_phone: string | null
  contact_emails?: string[] | null
  contact_phones?: string[] | null
  consultation_reason: string | null
  meeting_modality: string[] | string | null
  city: string | null
}

export async function getFreshActiveAssignmentRequest(
  supabase: SupabaseClient,
  professionalId: string
): Promise<ActiveWaitingListAssignmentRequest | null> {
  const { data: requests, error: requestsError } = await supabase
    .from('assignment_requests')
    .select('id, professional_id, is_active, requested_count, assigned_count, remaining_count')
    .eq('professional_id', professionalId)
    .eq('is_active', true)
    .gt('requested_count', 0)
    .order('created_at', { ascending: false })

  if (requestsError) throw requestsError

  const activeRequests = (requests ?? []) as ActiveWaitingListAssignmentRequest[]
  const requestIds = activeRequests.map((request) => request.id)
  if (requestIds.length === 0) return null

  const { data: assignedClients, error: assignedClientsError } = await supabase
    .from('assigned_clients')
    .select('assignment_request_id, is_active')
    .in('assignment_request_id', requestIds)
    .is('canceled_at', null)

  if (assignedClientsError) throw assignedClientsError

  const serviceTakenByRequest = new Map<string, number>()
  const occupiedByRequest = new Map<string, number>()

  ;((assignedClients ?? []) as Array<{
    assignment_request_id: string | null
    is_active: boolean | null
  }>).forEach((client) => {
    if (!client.assignment_request_id) return
    if (client.is_active === true) {
      serviceTakenByRequest.set(
        client.assignment_request_id,
        (serviceTakenByRequest.get(client.assignment_request_id) ?? 0) + 1
      )
      occupiedByRequest.set(
        client.assignment_request_id,
        (occupiedByRequest.get(client.assignment_request_id) ?? 0) + 1
      )
    } else if (client.is_active === null) {
      occupiedByRequest.set(
        client.assignment_request_id,
        (occupiedByRequest.get(client.assignment_request_id) ?? 0) + 1
      )
    }
  })

  return (
    activeRequests
      .map((request) => {
        const requestedCount = Math.max(request.requested_count ?? 0, 0)
        const assignedCount = serviceTakenByRequest.get(request.id) ?? 0
        const occupiedCount = occupiedByRequest.get(request.id) ?? 0
        return {
          ...request,
          assigned_count: assignedCount,
          occupied_count: occupiedCount,
          remaining_count: Math.max(requestedCount - occupiedCount, 0),
        }
      })
      .find(
        (request) =>
          (request.assigned_count ?? 0) < (request.requested_count ?? 0) &&
          (request.remaining_count ?? 0) > 0
      ) ?? null
  )
}

export type WaitingListAssignmentResult = {
  serviceAppointment?: ServiceAppointment
  assignedClientId: string
  assignmentRequest: ActiveWaitingListAssignmentRequest
  requesterName: string | null
  assignedAt: string
  updatedClient: Record<string, unknown>
  reused: boolean
}

// Conserve la clé après une erreur réseau/réponse perdue. Aucun contenu client ici.
const pendingAssignmentKeys = new Map<string, string>()

export async function createAssignmentFromWaitingListClient({
  supabase, client, professionalId, outcome = 'pending', assignmentProcessId, appointment,
}: {
  supabase: SupabaseClient
  client: AssignableWaitingListClient
  professionalId: string
  outcome?: 'pending' | 'service_taken'
  assignmentProcessId?: string
  appointment?: ServiceAppointmentInput
}): Promise<WaitingListAssignmentResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Session expirée. Veuillez vous reconnecter.')
  const intent = [session.user.id, client.id, professionalId, outcome, assignmentProcessId ?? '',
    appointment?.date ?? '', appointment?.time ?? '', appointment?.modality ?? ''].join('/')
  let idempotencyKey = pendingAssignmentKeys.get(intent)
  if (!idempotencyKey) {
    idempotencyKey = crypto.randomUUID()
    if (pendingAssignmentKeys.size >= 100) pendingAssignmentKeys.delete(pendingAssignmentKeys.keys().next().value!)
    pendingAssignmentKeys.set(intent, idempotencyKey)
  }
  const response = await fetch(`/api/direction/waiting-list-clients/${encodeURIComponent(client.id)}/assign`, {
    method: 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ professionalId, outcome, assignmentProcessId, idempotencyKey, appointment }),
  })
  const result = await response.json().catch(() => null) as (WaitingListAssignmentResult & { error?: string }) | null
  if (!response.ok) {
    // Un refus explicite n'est pas un resultat perdu : une prochaine action
    // volontaire apres correction/actualisation doit pouvoir obtenir une autre cle.
    if (response.status >= 400 && response.status < 500) pendingAssignmentKeys.delete(intent)
    throw new Error(result?.error ?? 'L’assignation n’a pas pu être confirmée.')
  }
  if (!result?.assignedClientId || !result.assignmentRequest?.id || !result.updatedClient) {
    throw new Error('Le résultat de l’assignation est incomplet. Actualisez la fiche.')
  }
  pendingAssignmentKeys.delete(intent)
  return result
}
