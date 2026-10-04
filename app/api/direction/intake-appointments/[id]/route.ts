import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { INTAKE_CALL_MINUTES, INTAKE_SLOT_MINUTES, isValidIntakeSlot } from '@/lib/publicIntakeSchedule'

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
    | { action?: unknown; startAt?: unknown; note?: unknown }
    | null
  const action = body?.action === 'cancel' || body?.action === 'reschedule' ? body.action : null
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : ''
  if (!action) return NextResponse.json({ error: 'Action invalide.' }, { status: 400 })

  let startAt: Date | null = null
  if (action === 'reschedule') {
    startAt = typeof body?.startAt === 'string' ? new Date(body.startAt) : new Date('invalid')
    if (!isValidIntakeSlot(startAt)) {
      return NextResponse.json({ error: 'Le nouveau créneau est invalide.' }, { status: 400 })
    }
  }

  const { data, error } = await getSupabaseAdmin().rpc('update_intake_appointment', {
    p_appointment_id: id,
    p_action: action,
    p_new_start_at: startAt?.toISOString() ?? null,
    p_new_end_at: startAt
      ? new Date(startAt.getTime() + INTAKE_CALL_MINUTES * 60_000).toISOString()
      : null,
    p_new_buffer_end_at: startAt
      ? new Date(startAt.getTime() + INTAKE_SLOT_MINUTES * 60_000).toISOString()
      : null,
    p_note: note,
    p_actor_id: direction.context.user.id,
    p_actor_name: direction.context.profile.full_name ?? direction.context.user.email ?? 'Direction',
  })
  if (error) {
    const conflict = error.message.includes('SLOT_UNAVAILABLE')
    const missing = error.message.includes('APPOINTMENT_NOT_FOUND')
    return NextResponse.json(
      { error: conflict ? 'Ce créneau n’est pas disponible.' : missing ? 'Rendez-vous introuvable.' : error.message },
      { status: conflict ? 409 : missing ? 404 : 500 }
    )
  }
  return NextResponse.json(data)
}
