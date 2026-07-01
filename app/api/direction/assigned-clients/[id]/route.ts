import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { getSuperAdminContext } from '@/lib/superAdminServer'

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function recalculateAssignmentRequest(
  requestId: string,
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>
) {
  const { data: request } = await supabaseAdmin
    .from('assignment_requests')
    .select('requested_count')
    .eq('id', requestId)
    .limit(1)
    .maybeSingle()

  const { data: clients } = await supabaseAdmin
    .from('assigned_clients')
    .select('is_active')
    .eq('assignment_request_id', requestId)

  const assignedCount = (clients ?? []).length
  const remainingCount = Math.max((request?.requested_count ?? 0) - assignedCount, 0)

  await supabaseAdmin
    .from('assignment_requests')
    .update({
      assigned_count: assignedCount,
      remaining_count: remainingCount,
    })
    .eq('id', requestId)
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
  const assignedClientId = normalizeId(id)

  if (!assignedClientId) {
    return jsonResponse({ error: "L'identifiant de l'assignation est requis." }, 400)
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data: assignedClient, error: assignedClientError } = await supabaseAdmin
    .from('assigned_clients')
    .select(
      'id, assignment_request_id, waiting_list_client_id, professional_id, first_name, last_name, email, is_active'
    )
    .eq('id', assignedClientId)
    .limit(1)
    .maybeSingle()

  if (assignedClientError) {
    return jsonResponse({ error: assignedClientError.message }, 500)
  }
  if (!assignedClient) return jsonResponse({ error: 'Assignation introuvable.' }, 404)

  const { data: professional } = await supabaseAdmin
    .from('profiles')
    .select('full_name, email')
    .eq('id', assignedClient.professional_id)
    .limit(1)
    .maybeSingle()

  const { error: historyDeleteError } = await supabaseAdmin
    .from('assigned_client_status_history')
    .delete()
    .eq('assigned_client_id', assignedClientId)

  if (historyDeleteError) {
    return jsonResponse({ error: historyDeleteError.message }, 500)
  }

  const { error: assignedDeleteError } = await supabaseAdmin
    .from('assigned_clients')
    .delete()
    .eq('id', assignedClientId)

  if (assignedDeleteError) {
    return jsonResponse({ error: assignedDeleteError.message }, 500)
  }

  if (assignedClient.waiting_list_client_id) {
    const { error: waitingUpdateError } = await supabaseAdmin
      .from('waiting_list_clients')
      .update({
        status: 'waiting',
        assigned_professional_id: null,
        assigned_at: null,
      })
      .eq('id', assignedClient.waiting_list_client_id)

    if (waitingUpdateError) {
      return jsonResponse({ error: waitingUpdateError.message }, 500)
    }
  }

  if (assignedClient.assignment_request_id) {
    await recalculateAssignmentRequest(
      assignedClient.assignment_request_id,
      supabaseAdmin
    )
  }

  const clientName = `${assignedClient.first_name ?? ''} ${
    assignedClient.last_name ?? ''
  }`.trim()

  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: superAdminResult.context.user.id,
    actor_name:
      superAdminResult.context.profile.full_name ??
      superAdminResult.context.user.email ??
      null,
    actor_role: superAdminResult.context.profile.role,
    action: 'assigned_client_deleted',
    entity_type: 'assigned_client',
    entity_id: assignedClientId,
    description: `Assignation supprimée pour ${clientName || 'client sans nom'}.`,
    metadata: {
      client_name: clientName || null,
      client_email: assignedClient.email,
      professional_name: professional?.full_name ?? null,
      professional_email: professional?.email ?? null,
      assignment_request_id: assignedClient.assignment_request_id,
      waiting_list_client_id: assignedClient.waiting_list_client_id,
      previous_status: assignedClient.is_active,
    },
  })

  return jsonResponse({ success: true }, 200)
}
