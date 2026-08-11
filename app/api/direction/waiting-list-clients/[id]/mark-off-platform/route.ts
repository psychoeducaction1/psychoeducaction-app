import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

type WaitingListClientRow = {
  id: string
  status: string | null
  client_name: string | null
  contact_email: string | null
  assigned_professional_id: string | null
  assigned_at: string | null
}

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const directionResult = await getDirectionContext(request)

  if (directionResult.error) {
    return jsonResponse(
      { error: directionResult.error.message },
      directionResult.error.status
    )
  }

  const { id } = await context.params
  const waitingListClientId = normalizeId(id)

  if (!waitingListClientId) {
    return jsonResponse({ error: "L'identifiant du client est requis." }, 400)
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data: clientData, error: clientError } = await supabaseAdmin
    .from('waiting_list_clients')
    .select(
      'id, status, client_name, contact_email, assigned_professional_id, assigned_at'
    )
    .eq('id', waitingListClientId)
    .limit(1)
    .maybeSingle()

  if (clientError) {
    return jsonResponse({ error: clientError.message }, 500)
  }

  const client = clientData as WaitingListClientRow | null

  if (!client) {
    return jsonResponse({ error: 'Client introuvable.' }, 404)
  }

  if (client.status === 'closed') {
    return jsonResponse(
      {
        skipped: true,
        reason: 'already_closed',
        message: 'Ce client est déjà retiré de la liste active.',
      },
      200
    )
  }

  const { error: updateError } = await supabaseAdmin
    .from('waiting_list_clients')
    .update({
      status: 'closed',
      assigned_professional_id: null,
      assigned_at: null,
    })
    .eq('id', client.id)

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500)
  }

  const actor = directionResult.context

  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: actor.user.id,
    actor_name: actor.profile.full_name ?? actor.user.email ?? null,
    actor_role: actor.profile.role,
    action: 'waiting_list_client_marked_off_platform',
    entity_type: 'waiting_list_client',
    entity_id: client.id,
    description: `Client ${client.client_name ?? 'sans nom'} marqué comme pris en charge hors plateforme.`,
    metadata: {
      client_name: client.client_name,
      contact_email: client.contact_email,
      previous_waiting_list_status: client.status,
      previous_assigned_professional_id: client.assigned_professional_id,
      previous_assigned_at: client.assigned_at,
      new_waiting_list_status: 'closed',
      source: 'manual_direction_action',
    },
  })

  return jsonResponse({ success: true, markedOffPlatform: true }, 200)
}
