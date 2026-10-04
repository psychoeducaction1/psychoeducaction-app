import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(request: NextRequest) {
  const direction = await getDirectionContext(request)
  if (direction.error) {
    return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  }
  const body = (await request.json().catch(() => null)) as
    | { startAt?: unknown; endAt?: unknown; reason?: unknown }
    | null
  const startAt = typeof body?.startAt === 'string' ? body.startAt : ''
  const endAt = typeof body?.endAt === 'string' ? body.endAt : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : ''
  if (!startAt || !endAt || Number.isNaN(Date.parse(startAt)) || Number.isNaN(Date.parse(endAt))) {
    return NextResponse.json({ error: 'La plage est invalide.' }, { status: 400 })
  }

  const { data, error } = await getSupabaseAdmin().rpc('create_intake_calendar_block', {
    p_start_at: startAt,
    p_end_at: endAt,
    p_reason: reason,
    p_actor_id: direction.context.user.id,
    p_actor_name: direction.context.profile.full_name ?? direction.context.user.email ?? 'Direction',
  })
  if (error) {
    const conflict = error.message.includes('RANGE_UNAVAILABLE')
    return NextResponse.json(
      { error: conflict ? 'Cette plage contient déjà un rendez-vous ou une retenue.' : error.message },
      { status: conflict ? 409 : 500 }
    )
  }
  return NextResponse.json({ success: true, blockId: data }, { status: 201 })
}
