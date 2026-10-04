import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

const priorities = new Set(['normal', 'urgent', 'existing_or_transfer'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const direction = await getDirectionContext(request)
  if (direction.error) {
    return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  }
  const { id } = await params
  const body = (await request.json().catch(() => null)) as
    | { priorityLevel?: unknown }
    | null
  const priorityLevel = typeof body?.priorityLevel === 'string'
    ? body.priorityLevel
    : ''
  if (!priorities.has(priorityLevel)) {
    return NextResponse.json({ error: 'Priorité invalide.' }, { status: 400 })
  }

  const { data, error } = await getSupabaseAdmin().rpc(
    'transfer_prospect_to_waiting_list',
    {
      p_prospect_id: id,
      p_priority_level: priorityLevel,
      p_actor_id: direction.context.user.id,
      p_actor_name:
        direction.context.profile.full_name ??
        direction.context.user.email ??
        'Direction',
    }
  )
  if (error) {
    const status = error.message.includes('PROSPECT_NOT_FOUND')
      ? 404
      : error.message.includes('SERVICE_NOT_CONFIRMED')
        ? 409
        : 500
    return NextResponse.json(
      {
        error:
          status === 404
            ? 'Prospect introuvable.'
            : status === 409
              ? 'Confirmez d’abord que le service a été pris.'
              : error.message,
      },
      { status }
    )
  }
  return NextResponse.json(data)
}
