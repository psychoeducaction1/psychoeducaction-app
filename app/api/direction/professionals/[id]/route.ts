import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { getSuperAdminContext } from '@/lib/superAdminServer'

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function getProfessionalSummary(
  professionalId: string,
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>
) {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, role')
    .eq('id', professionalId)
    .limit(1)
    .maybeSingle()

  if (profileError) throw profileError
  if (!profile || profile.role !== 'professionnel') return null

  const [requestsResponse, clientsResponse] = await Promise.all([
    supabaseAdmin
      .from('assignment_requests')
      .select('id')
      .eq('professional_id', professionalId),
    supabaseAdmin
      .from('assigned_clients')
      .select('id, is_active')
      .eq('professional_id', professionalId)
      .is('canceled_at', null),
  ])

  if (requestsResponse.error) throw requestsResponse.error
  if (clientsResponse.error) throw clientsResponse.error

  const clients = clientsResponse.data ?? []

  return {
    profile,
    requestsCount: requestsResponse.data?.length ?? 0,
    assignmentsCount: clients.length,
    clientsCount: clients.length,
    serviceTaken: clients.filter((client) => client.is_active === true).length,
    serviceNotTaken: clients.filter((client) => client.is_active === false).length,
    pending: clients.filter((client) => client.is_active === null).length,
  }
}

export async function GET(
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
  const professionalId = normalizeId(id)

  if (!professionalId) {
    return jsonResponse(
      { error: "L'identifiant du professionnel est requis." },
      400
    )
  }

  const supabaseAdmin = getSupabaseAdmin()
  const summary = await getProfessionalSummary(professionalId, supabaseAdmin)

  if (!summary) return jsonResponse({ error: 'Professionnel introuvable.' }, 404)

  return jsonResponse(summary, 200)
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
  const professionalId = normalizeId(id)

  if (!professionalId) {
    return jsonResponse(
      { error: "L'identifiant du professionnel est requis." },
      400
    )
  }

  const supabaseAdmin = getSupabaseAdmin()
  const summary = await getProfessionalSummary(professionalId, supabaseAdmin)

  if (!summary) return jsonResponse({ error: 'Professionnel introuvable.' }, 404)

  if (summary.pending > 0) {
    return jsonResponse(
      {
        error:
          'Suppression impossible : ce professionnel possède encore des assignations en attente.',
      },
      409
    )
  }

  const { data: assignedClients, error: assignedClientsError } = await supabaseAdmin
    .from('assigned_clients')
    .select('id, waiting_list_client_id')
    .eq('professional_id', professionalId)

  if (assignedClientsError) {
    return jsonResponse({ error: assignedClientsError.message }, 500)
  }

  const assignedClientIds = (assignedClients ?? []).map(
    (assignedClient) => assignedClient.id as string
  )
  const waitingListClientIds = (assignedClients ?? [])
    .map((assignedClient) => assignedClient.waiting_list_client_id as string | null)
    .filter((clientId): clientId is string => Boolean(clientId))

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

  if (waitingListClientIds.length > 0) {
    const { error: waitingUpdateError } = await supabaseAdmin
      .from('waiting_list_clients')
      .update({
        status: 'waiting',
        assigned_professional_id: null,
        assigned_at: null,
      })
      .in('id', waitingListClientIds)

    if (waitingUpdateError) {
      return jsonResponse({ error: waitingUpdateError.message }, 500)
    }
  }

  const { error: requestsDeleteError } = await supabaseAdmin
    .from('assignment_requests')
    .delete()
    .eq('professional_id', professionalId)

  if (requestsDeleteError) {
    return jsonResponse({ error: requestsDeleteError.message }, 500)
  }

  const { error: profileDeleteError } = await supabaseAdmin
    .from('profiles')
    .delete()
    .eq('id', professionalId)

  if (profileDeleteError) {
    return jsonResponse({ error: profileDeleteError.message }, 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: superAdminResult.context.user.id,
    actor_name:
      superAdminResult.context.profile.full_name ??
      superAdminResult.context.user.email ??
      null,
    actor_role: superAdminResult.context.profile.role,
    action: 'professional_deleted',
    entity_type: 'profile',
    entity_id: professionalId,
    description: `Professionnel ${summary.profile.full_name ?? 'sans nom'} supprimé.`,
    metadata: {
      professional_name: summary.profile.full_name,
      professional_email: summary.profile.email,
      requests_count: summary.requestsCount,
      assignments_count: summary.assignmentsCount,
      service_taken: summary.serviceTaken,
      service_not_taken: summary.serviceNotTaken,
    },
  })

  return jsonResponse({ success: true }, 200)
}
