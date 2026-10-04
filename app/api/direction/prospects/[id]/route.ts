import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

const editableStatuses = new Set([
  'contacted',
  'service_taken',
  'service_not_taken',
  'other',
])

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const direction = await getDirectionContext(request)
  if (direction.error) {
    return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  }
  const { id } = await params
  const body = (await request.json().catch(() => null)) as
    | { status?: unknown; outcomeReason?: unknown }
    | null
  const status = typeof body?.status === 'string' ? body.status : ''
  const outcomeReason = typeof body?.outcomeReason === 'string'
    ? body.outcomeReason.trim().slice(0, 1000)
    : ''
  if (!editableStatuses.has(status)) {
    return NextResponse.json({ error: 'Statut invalide.' }, { status: 400 })
  }
  if ((status === 'service_not_taken' || status === 'other') && !outcomeReason) {
    return NextResponse.json(
      {
        error: status === 'other'
          ? 'Ajoutez une note pour préciser la situation.'
          : 'Précisez pourquoi le service n’a pas été pris.',
      },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()
  const { data: prospect, error: readError } = await supabase
    .from('public_intake_prospects')
    .select('id, status, waiting_list_client_id')
    .eq('id', id)
    .maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!prospect) return NextResponse.json({ error: 'Prospect introuvable.' }, { status: 404 })
  if (prospect.waiting_list_client_id) {
    return NextResponse.json(
      { error: 'Ce prospect a déjà été transféré vers la liste d’attente.' },
      { status: 409 }
    )
  }

  const { data, error } = await supabase
    .from('public_intake_prospects')
    .update({
      status,
      outcome_reason: status === 'service_not_taken' || status === 'other'
        ? outcomeReason
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('audit_logs').insert({
    actor_profile_id: direction.context.user.id,
    actor_name: direction.context.profile.full_name ?? direction.context.user.email ?? null,
    actor_role: direction.context.profile.role,
    action: 'public_intake_prospect_status_updated',
    entity_type: 'public_intake_prospect',
    entity_id: id,
    description: 'Statut du prospect mis à jour.',
    metadata: {
      previous_status: prospect.status,
      new_status: status,
      has_outcome_reason: Boolean(outcomeReason),
    },
  })
  return NextResponse.json({ success: true, prospect: data })
}
