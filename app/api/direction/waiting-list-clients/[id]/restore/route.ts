import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

type WaitingListClientRow = {
  id: string
  status: string | null
  client_name: string | null
  contact_email: string | null
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
    .select('id, status, client_name, contact_email')
    .eq('id', waitingListClientId)
    .limit(1)
    .maybeSingle()

  if (clientError) {
    return jsonResponse({ error: clientError.message }, 500)
  }

  const client = clientData as WaitingListClientRow | null

  if (!client) {
    return jsonResponse(
      {
        error:
          "Le client ne peut pas être remis automatiquement dans la liste d'attente puisque l'enregistrement source est introuvable.",
      },
      404
    )
  }

  if (client.status === 'waiting') {
    return jsonResponse(
      {
        skipped: true,
        reason: 'already_waiting',
        message: "Ce client est déjà présent dans la liste d'attente.",
      },
      200
    )
  }

  const { error: updateError } = await supabaseAdmin
    .from('waiting_list_clients')
    .update({
      status: 'waiting',
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
    action: 'waiting_list_client_restored',
    entity_type: 'waiting_list_client',
    entity_id: client.id,
    description: `Client ${client.client_name ?? 'sans nom'} remis dans la liste d'attente.`,
    metadata: {
      client_name: client.client_name,
      contact_email: client.contact_email,
      previous_waiting_list_status: client.status,
      restore_source: 'manual_action',
    },
  })

  return jsonResponse({ success: true, restoredToWaitingList: true }, 200)
}
