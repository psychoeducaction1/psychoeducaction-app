import { NextRequest, NextResponse } from 'next/server'
import { recalculateAssignmentRequestFromActiveAssignments } from '@/lib/assignmentRequestsServer'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

const cancelReasons = new Set([
  'Mauvais professionnel',
  'Mauvais client',
  'Doublon',
  'Erreur administrative',
  'Client déjà pris en charge',
  'Autre',
])

type CancelBody = {
  reason?: unknown
  otherReason?: unknown
  restoreToWaitingList?: unknown
}

type AssignedClientRow = {
  id: string
  assignment_request_id: string | null
  waiting_list_client_id: string | null
  professional_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  is_active: boolean | null
  canceled_at: string | null
}

type WaitingListClientRow = {
  id: string
  status: string | null
  client_name: string | null
  contact_email: string | null
}

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeBoolean(value: unknown) {
  return value === true
}

function getClientName(client: AssignedClientRow) {
  return [client.first_name, client.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
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
  const assignedClientId = normalizeText(id)

  if (!assignedClientId) {
    return jsonResponse({ error: "L'identifiant de l'assignation est requis." }, 400)
  }

  let body: CancelBody

  try {
    body = (await request.json()) as CancelBody
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const reason = normalizeText(body.reason)
  const otherReason = normalizeText(body.otherReason)
  const restoreToWaitingList = normalizeBoolean(body.restoreToWaitingList)

  if (!cancelReasons.has(reason)) {
    return jsonResponse({ error: "Le motif d'annulation est requis." }, 400)
  }

  if (reason === 'Autre' && !otherReason) {
    return jsonResponse({ error: 'Veuillez préciser le motif.' }, 400)
  }

  const cancelReason = reason === 'Autre' ? `Autre : ${otherReason}` : reason
  const supabaseAdmin = getSupabaseAdmin()
  const { data: assignedClientData, error: assignedClientError } =
    await supabaseAdmin
      .from('assigned_clients')
      .select(
        'id, assignment_request_id, waiting_list_client_id, professional_id, first_name, last_name, email, is_active, canceled_at'
      )
      .eq('id', assignedClientId)
      .limit(1)
      .maybeSingle()

  if (assignedClientError) {
    return jsonResponse({ error: assignedClientError.message }, 500)
  }

  const assignedClient = assignedClientData as AssignedClientRow | null

  if (!assignedClient) {
    return jsonResponse({ error: 'Assignation introuvable.' }, 404)
  }

  if (assignedClient.canceled_at) {
    return jsonResponse(
      { skipped: true, reason: 'assignation_deja_annulee' },
      200
    )
  }

  const canceledAt = new Date().toISOString()
  const actor = directionResult.context
  const { error: updateError } = await supabaseAdmin
    .from('assigned_clients')
    .update({
      canceled_at: canceledAt,
      canceled_by: actor.user.id,
      cancel_reason: cancelReason,
    })
    .eq('id', assignedClientId)

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500)
  }

  if (assignedClient.assignment_request_id) {
    try {
      await recalculateAssignmentRequestFromActiveAssignments(
        assignedClient.assignment_request_id,
        supabaseAdmin
      )
    } catch (recalculateError) {
      return jsonResponse(
        {
          error:
            recalculateError instanceof Error
              ? recalculateError.message
              : 'Erreur pendant le recalcul de la demande.',
        },
        500
      )
    }
  }

  const { data: professional } = await supabaseAdmin
    .from('profiles')
    .select('full_name, email')
    .eq('id', assignedClient.professional_id)
    .limit(1)
    .maybeSingle()

  const clientName = getClientName(assignedClient)

  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: actor.user.id,
    actor_name: actor.profile.full_name ?? actor.user.email ?? null,
    actor_role: actor.profile.role,
    action: 'assigned_client_canceled',
    entity_type: 'assigned_client',
    entity_id: assignedClient.id,
    description: `Assignation annulée pour ${clientName || 'client sans nom'}.`,
    metadata: {
      client_name: clientName || null,
      client_email: assignedClient.email,
      professional_id: assignedClient.professional_id,
      professional_name: professional?.full_name ?? null,
      professional_email: professional?.email ?? null,
      assignment_request_id: assignedClient.assignment_request_id,
      waiting_list_client_id: assignedClient.waiting_list_client_id,
      previous_status: assignedClient.is_active,
      cancel_reason: cancelReason,
      canceled_at: canceledAt,
    },
  })

  if (!restoreToWaitingList) {
    return jsonResponse({ success: true, restoredToWaitingList: false }, 200)
  }

  if (!assignedClient.waiting_list_client_id) {
    return jsonResponse(
      {
        success: true,
        restoredToWaitingList: false,
        restoreWarning:
          "Le client ne peut pas être remis automatiquement dans la liste d'attente puisque le lien avec la liste d'attente est introuvable.",
      },
      200
    )
  }

  const { data: waitingListClientData, error: waitingListLoadError } =
    await supabaseAdmin
      .from('waiting_list_clients')
      .select('id, status, client_name, contact_email')
      .eq('id', assignedClient.waiting_list_client_id)
      .limit(1)
      .maybeSingle()

  if (waitingListLoadError) {
    return jsonResponse({ error: waitingListLoadError.message }, 500)
  }

  const waitingListClient =
    waitingListClientData as WaitingListClientRow | null

  if (!waitingListClient) {
    return jsonResponse(
      {
        success: true,
        restoredToWaitingList: false,
        restoreWarning:
          "Le client ne peut pas être remis automatiquement dans la liste d'attente puisque l'enregistrement source est introuvable.",
      },
      200
    )
  }

  if (waitingListClient.status === 'waiting') {
    return jsonResponse(
      {
        success: true,
        restoredToWaitingList: false,
        restoreWarning: "Ce client est déjà présent dans la liste d'attente.",
      },
      200
    )
  }

  const { error: waitingListUpdateError } = await supabaseAdmin
    .from('waiting_list_clients')
    .update({
      status: 'waiting',
      assigned_professional_id: null,
      assigned_at: null,
    })
    .eq('id', waitingListClient.id)

  if (waitingListUpdateError) {
    return jsonResponse({ error: waitingListUpdateError.message }, 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: actor.user.id,
    actor_name: actor.profile.full_name ?? actor.user.email ?? null,
    actor_role: actor.profile.role,
    action: 'waiting_list_client_restored',
    entity_type: 'waiting_list_client',
    entity_id: waitingListClient.id,
    description: `Client ${
      waitingListClient.client_name ?? (clientName || 'sans nom')
    } remis dans la liste d'attente.`,
    metadata: {
      client_name: waitingListClient.client_name ?? (clientName || null),
      contact_email: waitingListClient.contact_email,
      assigned_client_id: assignedClient.id,
      assignment_request_id: assignedClient.assignment_request_id,
      professional_id: assignedClient.professional_id,
      previous_waiting_list_status: waitingListClient.status,
    },
  })

  return jsonResponse({ success: true, restoredToWaitingList: true }, 200)
}
