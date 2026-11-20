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
    .select('id, full_name, email, role, administrative_access')
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

// Compatibilite des anciens onglets : refus avant tout client privilegie ou
// lecture du professionnel, pour ne jamais supprimer partiellement son historique.
export async function DELETE(request: NextRequest) {
  const authorization = await getSuperAdminContext(request)
  if (authorization.error) return jsonResponse({ error: authorization.error.message }, authorization.error.status)
  return NextResponse.json({
    error: 'La suppression définitive des professionnels est désactivée. Utilisez la désactivation ou l’archivage pour conserver leur historique.',
  }, { status: 410, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } })
}
