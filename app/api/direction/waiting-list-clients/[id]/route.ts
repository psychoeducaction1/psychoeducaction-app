import { NextRequest, NextResponse } from 'next/server'
import { recalculateAssignmentRequestFromActiveAssignments } from '@/lib/assignmentRequestsServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { getSuperAdminContext } from '@/lib/superAdminServer'

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const superAdminResult = await getSuperAdminContext(request)

  if (superAdminResult.error) {
    return jsonResponse(
      { error: superAdminResult.error.message },
      superAdminResult.error.status
    )
  }

  const { id } = await context.params
  const waitingListClientId = normalizeId(id)

  if (!waitingListClientId) {
    return jsonResponse({ error: "L'identifiant du client est requis." }, 400)
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data: client, error: clientError } = await supabaseAdmin
    .from('waiting_list_clients')
    .select('id, client_name, contact_email')
    .eq('id', waitingListClientId)
    .limit(1)
    .maybeSingle()

  if (clientError) return jsonResponse({ error: clientError.message }, 500)
  if (!client) return jsonResponse({ error: 'Client introuvable.' }, 404)

  const { data: assignedClients, error: assignedClientsError } = await supabaseAdmin
    .from('assigned_clients')
    .select('id, assignment_request_id')
    .eq('waiting_list_client_id', waitingListClientId)

  if (assignedClientsError) {
    return jsonResponse({ error: assignedClientsError.message }, 500)
  }

  const assignedClientIds = (assignedClients ?? []).map(
    (assignedClient) => assignedClient.id as string
  )
  const assignmentRequestIds = Array.from(
    new Set(
      (assignedClients ?? [])
        .map((assignedClient) => assignedClient.assignment_request_id as string | null)
        .filter((requestId): requestId is string => Boolean(requestId))
    )
  )

  if (assignedClientIds.length > 0) {
    const { error: historyDeleteError } = await supabaseAdmin
      .from('assigned_client_status_history')
      .delete()
      .in('assigned_client_id', assignedClientIds)

    if (historyDeleteError) {
      return jsonResponse({ error: historyDeleteError.message }, 500)
    }

    const { error: assignedDeleteError } = await supabaseAdmin
      .from('assigned_clients')
      .delete()
      .in('id', assignedClientIds)

    if (assignedDeleteError) {
      return jsonResponse({ error: assignedDeleteError.message }, 500)
    }
  }

  const { error: waitingDeleteError } = await supabaseAdmin
    .from('waiting_list_clients')
    .delete()
    .eq('id', waitingListClientId)

  if (waitingDeleteError) {
    return jsonResponse({ error: waitingDeleteError.message }, 500)
  }

  await Promise.all(
    assignmentRequestIds.map((requestId) =>
      recalculateAssignmentRequestFromActiveAssignments(requestId, supabaseAdmin)
    )
  )

  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: superAdminResult.context.user.id,
    actor_name:
      superAdminResult.context.profile.full_name ??
      superAdminResult.context.user.email ??
      null,
    actor_role: superAdminResult.context.profile.role,
    action: 'waiting_list_client_permanently_deleted',
    entity_type: 'waiting_list_client',
    entity_id: waitingListClientId,
    description: `Client ${client.client_name ?? 'sans nom'} supprimé définitivement.`,
    metadata: {
      client_name: client.client_name,
      contact_email: client.contact_email,
      assigned_clients_deleted: assignedClientIds.length,
      assignment_request_ids: assignmentRequestIds,
    },
  })

  return jsonResponse({ success: true }, 200)
}
