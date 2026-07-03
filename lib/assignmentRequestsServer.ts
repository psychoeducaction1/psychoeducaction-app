import 'server-only'

import type { getSupabaseAdmin } from '@/lib/supabaseAdmin'

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdmin>

export async function recalculateAssignmentRequestFromActiveAssignments(
  requestId: string,
  supabaseAdmin: SupabaseAdminClient
) {
  const { data: request, error: requestError } = await supabaseAdmin
    .from('assignment_requests')
    .select('requested_count')
    .eq('id', requestId)
    .limit(1)
    .maybeSingle()

  if (requestError) throw requestError
  if (!request) return

  const { data: clients, error: clientsError } = await supabaseAdmin
    .from('assigned_clients')
    .select('is_active')
    .eq('assignment_request_id', requestId)
    .is('canceled_at', null)

  if (clientsError) throw clientsError

  const activeClients = clients ?? []
  const requestedCount = Math.max(request.requested_count ?? 0, 0)
  const serviceTakenCount = activeClients.filter(
    (client) => client.is_active === true
  ).length
  const occupiedCount = activeClients.filter(
    (client) => client.is_active !== false
  ).length
  const remainingCount = Math.max(requestedCount - occupiedCount, 0)

  const { error: updateError } = await supabaseAdmin
    .from('assignment_requests')
    .update({
      assigned_count: serviceTakenCount,
      remaining_count: remainingCount,
      is_active: serviceTakenCount < requestedCount,
    })
    .eq('id', requestId)

  if (updateError) throw updateError
}
