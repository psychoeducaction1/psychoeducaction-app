import { NextRequest, NextResponse } from 'next/server'
import { recalculateAssignmentRequestFromActiveAssignments } from '@/lib/assignmentRequestsServer'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

type HistoryAction = 'reopen' | 'return_to_waiting'

type RequestBody = {
  action?: unknown
}

type AssignmentProcessRow = {
  id: string
  waiting_list_client_id: string
  status: string
  prospective_professional_id: string | null
}

type WaitingListClientRow = {
  id: string
  client_name: string | null
  status: string | null
  assigned_professional_id: string | null
  assigned_at: string | null
}

type AssignedClientRow = {
  id: string
  assignment_request_id: string | null
  professional_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  is_active: boolean | null
}

const historicalStatuses = new Set(['assigned', 'classified', 'returned'])

function json(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeAction(value: unknown): HistoryAction | null {
  return value === 'reopen' || value === 'return_to_waiting'
    ? value
    : null
}

function getClientName(client: AssignedClientRow | null) {
  if (!client) return ''
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
    return json(
      { error: directionResult.error.message },
      directionResult.error.status
    )
  }

  const { id } = await context.params
  const processId = id.trim()
  const payload = (await request.json().catch(() => null)) as RequestBody | null
  const action = normalizeAction(payload?.action)

  if (!processId) return json({ error: 'La démarche est requise.' }, 400)
  if (!action) return json({ error: 'Action invalide.' }, 400)

  const supabaseAdmin = getSupabaseAdmin()
  const actor = directionResult.context
  const { data: processData, error: processError } = await supabaseAdmin
    .from('assignment_processes')
    .select(
      'id, waiting_list_client_id, status, prospective_professional_id'
    )
    .eq('id', processId)
    .limit(1)
    .maybeSingle()

  if (processError) return json({ error: processError.message }, 500)
  const process = processData as AssignmentProcessRow | null
  if (!process) return json({ error: 'Démarche introuvable.' }, 404)
  if (!historicalStatuses.has(process.status)) {
    return json({ error: 'Cette démarche est déjà active.' }, 409)
  }

  const { data: waitingClientData, error: waitingClientError } =
    await supabaseAdmin
      .from('waiting_list_clients')
      .select(
        'id, client_name, status, assigned_professional_id, assigned_at'
      )
      .eq('id', process.waiting_list_client_id)
      .limit(1)
      .maybeSingle()

  if (waitingClientError) return json({ error: waitingClientError.message }, 500)
  const waitingClient = waitingClientData as WaitingListClientRow | null
  if (!waitingClient) {
    return json({ error: 'Le client source est introuvable.' }, 404)
  }

  const { data: clientProcesses, error: clientProcessesError } =
    await supabaseAdmin
      .from('assignment_processes')
      .select('id, status')
      .eq('waiting_list_client_id', process.waiting_list_client_id)

  if (clientProcessesError) {
    return json({ error: clientProcessesError.message }, 500)
  }

  const otherActiveProcess = (clientProcesses ?? []).find(
    (candidate) =>
      candidate.id !== process.id && !historicalStatuses.has(candidate.status)
  )
  if (otherActiveProcess) {
    return json(
      { error: 'Une autre démarche active existe déjà pour ce client.' },
      409
    )
  }

  let assignedClient: AssignedClientRow | null = null
  if (process.status === 'assigned') {
    let assignmentQuery = supabaseAdmin
      .from('assigned_clients')
      .select(
        'id, assignment_request_id, professional_id, first_name, last_name, email, is_active'
      )
      .eq('waiting_list_client_id', process.waiting_list_client_id)
      .is('canceled_at', null)
      .order('assigned_date', { ascending: false })
      .limit(1)

    if (process.prospective_professional_id) {
      assignmentQuery = assignmentQuery.eq(
        'professional_id',
        process.prospective_professional_id
      )
    }

    const { data: assignmentData, error: assignmentError } =
      await assignmentQuery.maybeSingle()
    if (assignmentError) return json({ error: assignmentError.message }, 500)
    assignedClient = assignmentData as AssignedClientRow | null
  }

  const changedAt = new Date().toISOString()
  const cancelReason =
    action === 'reopen'
      ? 'Démarche d’assignation réactivée par la direction'
      : 'Client retourné en liste d’attente depuis l’historique'

  const rollbackAssignment = async () => {
    if (!assignedClient) return
    await supabaseAdmin
      .from('assigned_clients')
      .update({ canceled_at: null, canceled_by: null, cancel_reason: null })
      .eq('id', assignedClient.id)
    if (assignedClient.assignment_request_id) {
      await recalculateAssignmentRequestFromActiveAssignments(
        assignedClient.assignment_request_id,
        supabaseAdmin
      ).catch(() => undefined)
    }
  }

  if (assignedClient) {
    const { error: cancelError } = await supabaseAdmin
      .from('assigned_clients')
      .update({
        canceled_at: changedAt,
        canceled_by: actor.user.id,
        cancel_reason: cancelReason,
      })
      .eq('id', assignedClient.id)
    if (cancelError) return json({ error: cancelError.message }, 500)

    if (assignedClient.assignment_request_id) {
      try {
        await recalculateAssignmentRequestFromActiveAssignments(
          assignedClient.assignment_request_id,
          supabaseAdmin
        )
      } catch (recalculateError) {
        await rollbackAssignment()
        return json(
          {
            error:
              recalculateError instanceof Error
                ? recalculateError.message
                : 'Le recalcul de la demande a échoué.',
          },
          500
        )
      }
    }
  }

  const nextWaitingStatus =
    action === 'reopen' ? 'assignment_in_progress' : 'waiting'
  const { error: waitingUpdateError } = await supabaseAdmin
    .from('waiting_list_clients')
    .update({
      status: nextWaitingStatus,
      assigned_professional_id: null,
      assigned_at: null,
    })
    .eq('id', waitingClient.id)

  if (waitingUpdateError) {
    await rollbackAssignment()
    return json({ error: waitingUpdateError.message }, 500)
  }

  const nextProcessValues =
    action === 'reopen'
      ? {
          status: 'to_contact',
          assigned_at: null,
          classified_at: null,
          returned_at: null,
          classification_reason: null,
          classification_details: null,
        }
      : {
          status: 'returned',
          returned_at: changedAt,
        }

  const { error: processUpdateError } = await supabaseAdmin
    .from('assignment_processes')
    .update(nextProcessValues)
    .eq('id', process.id)

  if (processUpdateError) {
    await supabaseAdmin
      .from('waiting_list_clients')
      .update({
        status: waitingClient.status,
        assigned_professional_id: waitingClient.assigned_professional_id,
        assigned_at: waitingClient.assigned_at,
      })
      .eq('id', waitingClient.id)
    await rollbackAssignment()
    return json({ error: processUpdateError.message }, 500)
  }

  await supabaseAdmin
    .from('administrative_tasks')
    .update({ status: 'canceled', completed_at: null })
    .eq('source_type', 'assignment_process_follow_up')
    .eq('source_id', process.id)
    .in('status', ['pending', 'in_progress'])

  const nextStatus = action === 'reopen' ? 'to_contact' : 'returned'
  await supabaseAdmin.from('assignment_process_events').insert({
    assignment_process_id: process.id,
    event_type:
      action === 'reopen' ? 'status_changed' : 'returned_to_waiting_list',
    status: nextStatus,
    note:
      action === 'reopen'
        ? 'Démarche réactivée depuis l’historique; historique conservé.'
        : 'Client retourné dans la liste d’attente depuis l’historique.',
    actor_profile_id: actor.user.id,
    actor_name: actor.profile.full_name ?? actor.user.email ?? null,
    metadata: {
      previous_status: process.status,
      canceled_assigned_client_id: assignedClient?.id ?? null,
    },
  })

  if (assignedClient) {
    const clientName =
      getClientName(assignedClient) || waitingClient.client_name || 'client sans nom'
    await supabaseAdmin.from('audit_logs').insert({
      actor_profile_id: actor.user.id,
      actor_name: actor.profile.full_name ?? actor.user.email ?? null,
      actor_role: actor.profile.role,
      action: 'assigned_client_canceled',
      entity_type: 'assigned_client',
      entity_id: assignedClient.id,
      description: `Assignation annulée pour ${clientName}.`,
      metadata: {
        client_name: clientName,
        client_email: assignedClient.email,
        professional_id: assignedClient.professional_id,
        assignment_request_id: assignedClient.assignment_request_id,
        waiting_list_client_id: waitingClient.id,
        previous_status: assignedClient.is_active,
        cancel_reason: cancelReason,
        canceled_at: changedAt,
      },
    })
  }

  const auditAction =
    action === 'reopen'
      ? 'assignment_process_reopened'
      : 'waiting_list_client_restored'
  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: actor.user.id,
    actor_name: actor.profile.full_name ?? actor.user.email ?? null,
    actor_role: actor.profile.role,
    action: auditAction,
    entity_type:
      action === 'reopen' ? 'assignment_process' : 'waiting_list_client',
    entity_id: action === 'reopen' ? process.id : waitingClient.id,
    description:
      action === 'reopen'
        ? `Démarche de ${waitingClient.client_name ?? 'client sans nom'} réactivée.`
        : `Client ${waitingClient.client_name ?? 'sans nom'} remis dans la liste d’attente.`,
    metadata: {
      assignment_process_id: process.id,
      waiting_list_client_id: waitingClient.id,
      client_name: waitingClient.client_name,
      previous_process_status: process.status,
      canceled_assigned_client_id: assignedClient?.id ?? null,
    },
  })

  return json({
    success: true,
    action,
    assignmentCanceled: Boolean(assignedClient),
  }, 200)
}
