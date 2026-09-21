import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getServiceTakenCount,
  getUsedAssignmentCount,
} from '@/app/professionnel/shared'

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
  contact_emails: string[] | null
  contact_phones: string[] | null
  consultation_reason: string | null
  meeting_modality: string[] | string | null
  city: string | null
}

function normalizeTextList(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])
  )
}

function nullableText(value: string | null | undefined): string | null {
  return value?.trim() || null
}

function splitClientName(clientName: string | null) {
  const parts = clientName?.trim().split(/\s+/).filter(Boolean) ?? []
  if (parts.length === 0) return { firstName: 'Client', lastName: 'liste d’attente' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '-' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function getModalities(value: AssignableWaitingListClient['meeting_modality']) {
  if (Array.isArray(value)) return value.filter(Boolean)
  return value?.trim() ? [value.trim()] : []
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

export async function recalculateAssignmentRequest(
  supabase: SupabaseClient,
  requestId: string
) {
  const { data: request } = await supabase
    .from('assignment_requests')
    .select('requested_count')
    .eq('id', requestId)
    .limit(1)
    .maybeSingle()
  if (!request) return

  const { data: assignedClients } = await supabase
    .from('assigned_clients')
    .select('is_active')
    .eq('assignment_request_id', requestId)
    .is('canceled_at', null)
  if (!assignedClients) return

  const assignedCount = getServiceTakenCount(assignedClients)
  const occupiedCount = getUsedAssignmentCount(assignedClients)
  const requestedCount = Math.max(request.requested_count ?? 0, 0)

  await supabase
    .from('assignment_requests')
    .update({
      assigned_count: assignedCount,
      remaining_count: Math.max(requestedCount - occupiedCount, 0),
      is_active: assignedCount < requestedCount,
    })
    .eq('id', requestId)
}

export async function createAssignmentFromWaitingListClient({
  supabase,
  client,
  professionalId,
  outcome = 'pending',
}: {
  supabase: SupabaseClient
  client: AssignableWaitingListClient
  professionalId: string
  outcome?: 'pending' | 'service_taken'
}) {
  const assignmentRequest = await getFreshActiveAssignmentRequest(
    supabase,
    professionalId
  )

  if (!assignmentRequest) {
    throw new Error('Ce professionnel n’a aucune demande active avec place restante.')
  }

  const { firstName, lastName } = splitClientName(client.client_name)
  const requesterName = nullableText(
    [client.first_requester_name, client.second_requester_name]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(' / ')
  )
  const assignedAt = new Date().toISOString()

  const { data: insertedAssignment, error: insertError } = await supabase
    .from('assigned_clients')
    .insert({
      assignment_request_id: assignmentRequest.id,
      waiting_list_client_id: client.id,
      professional_id: professionalId,
      first_name: firstName,
      last_name: lastName,
      email: normalizeTextList([client.contact_email, ...(client.contact_emails ?? [])])[0] ?? null,
      phone: normalizeTextList([client.contact_phone, ...(client.contact_phones ?? [])])[0] ?? null,
      requester_name: requesterName,
      short_comment: nullableText(client.consultation_reason),
      meeting_modality: nullableText(getModalities(client.meeting_modality).join(', ')),
      service_address: nullableText(client.city),
      assigned_date: assignedAt.slice(0, 10),
      contacted: outcome === 'service_taken',
      is_active: outcome === 'service_taken' ? true : null,
      dossier_closed: false,
      closure_reason: null,
      meeting_count: 0,
    })
    .select('id')
    .limit(1)
    .maybeSingle()

  if (insertError) throw insertError
  if (!insertedAssignment?.id) {
    throw new Error("L'assignation a été créée, mais son identifiant est introuvable.")
  }

  await recalculateAssignmentRequest(supabase, assignmentRequest.id)

  const { data: updatedClient, error: updateError } = await supabase
    .from('waiting_list_clients')
    .update({
      status: 'assigned',
      assigned_professional_id: professionalId,
      assigned_at: assignedAt,
    })
    .eq('id', client.id)
    .select('*')
    .limit(1)
    .maybeSingle()

  if (updateError) throw updateError

  return {
    assignedClientId: insertedAssignment.id as string,
    assignmentRequest,
    requesterName,
    assignedAt,
    updatedClient,
  }
}
