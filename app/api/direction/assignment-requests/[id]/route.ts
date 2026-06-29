import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { getSuperAdminContext } from '@/lib/superAdminServer'

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
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
  const assignmentRequestId = normalizeId(id)

  if (!assignmentRequestId) {
    return jsonResponse({ error: "L'identifiant de la demande est requis." }, 400)
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data: clients, error: clientsError } = await supabaseAdmin
    .from('assigned_clients')
    .select('is_active')
    .eq('assignment_request_id', assignmentRequestId)

  if (clientsError) return jsonResponse({ error: clientsError.message }, 500)

  const assignedClients = clients ?? []

  return jsonResponse(
    {
      linkedClients: assignedClients.length,
      serviceTaken: assignedClients.filter((client) => client.is_active === true)
        .length,
      serviceNotTaken: assignedClients.filter(
        (client) => client.is_active === false
      ).length,
      pending: assignedClients.filter((client) => client.is_active === null).length,
    },
    200
  )
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
  const assignmentRequestId = normalizeId(id)

  if (!assignmentRequestId) {
    return jsonResponse({ error: "L'identifiant de la demande est requis." }, 400)
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data: assignmentRequest, error: requestError } = await supabaseAdmin
    .from('assignment_requests')
    .select('id, professional_id, requested_count')
    .eq('id', assignmentRequestId)
    .limit(1)
    .maybeSingle()

  if (requestError) return jsonResponse({ error: requestError.message }, 500)
  if (!assignmentRequest) return jsonResponse({ error: 'Demande introuvable.' }, 404)

  const { data: professional } = await supabaseAdmin
    .from('profiles')
    .select('full_name, email')
    .eq('id', assignmentRequest.professional_id)
    .limit(1)
    .maybeSingle()

  const { data: clients, error: clientsError } = await supabaseAdmin
    .from('assigned_clients')
    .select('is_active')
    .eq('assignment_request_id', assignmentRequestId)

  if (clientsError) return jsonResponse({ error: clientsError.message }, 500)

  const linkedClients = clients ?? []
  const summary = {
    linkedClients: linkedClients.length,
    serviceTaken: linkedClients.filter((client) => client.is_active === true).length,
    serviceNotTaken: linkedClients.filter((client) => client.is_active === false)
      .length,
    pending: linkedClients.filter((client) => client.is_active === null).length,
  }

  const { error: detachError } = await supabaseAdmin
    .from('assigned_clients')
    .update({ assignment_request_id: null })
    .eq('assignment_request_id', assignmentRequestId)

  if (detachError) return jsonResponse({ error: detachError.message }, 500)

  const { error: deleteError } = await supabaseAdmin
    .from('assignment_requests')
    .delete()
    .eq('id', assignmentRequestId)

  if (deleteError) return jsonResponse({ error: deleteError.message }, 500)

  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: superAdminResult.context.user.id,
    actor_name:
      superAdminResult.context.profile.full_name ??
      superAdminResult.context.user.email ??
      null,
    actor_role: superAdminResult.context.profile.role,
    action: 'assignment_request_deleted',
    entity_type: 'assignment_request',
    entity_id: assignmentRequestId,
    description: `Demande supprimée pour ${professional?.full_name ?? 'professionnel inconnu'}.`,
    metadata: {
      professional_name: professional?.full_name ?? null,
      professional_email: professional?.email ?? null,
      requested_count: assignmentRequest.requested_count,
      ...summary,
    },
  })

  return jsonResponse({ success: true }, 200)
}
