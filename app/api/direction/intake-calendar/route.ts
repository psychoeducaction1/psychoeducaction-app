import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(request: NextRequest) {
  const direction = await getDirectionContext(request)
  if (direction.error) {
    return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  }

  const from = request.nextUrl.searchParams.get('from')
  const to = request.nextUrl.searchParams.get('to')
  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json({ error: 'La plage demandée est invalide.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const [appointments, blocks, callbacks] = await Promise.all([
    supabase
      .from('intake_appointments')
      .select('id, prospect_id, start_at, end_at, buffer_end_at, status, source, cancellation_reason, created_at')
      .gte('start_at', from)
      .lt('start_at', to)
      .order('start_at'),
    supabase
      .from('intake_calendar_blocks')
      .select('id, start_at, end_at, reason, created_at')
      .lt('start_at', to)
      .gt('end_at', from)
      .order('start_at'),
    supabase
      .from('public_intake_prospects')
      .select('id, first_name, last_name, phone, rapid_callback_requested_at, potential_duplicate')
      .eq('status', 'callback_requested')
      .order('rapid_callback_requested_at', { ascending: true }),
  ])
  const queryError = appointments.error || blocks.error || callbacks.error
  if (queryError) return NextResponse.json({ error: queryError.message }, { status: 500 })

  const prospectIds = [...new Set((appointments.data ?? []).map((row) => row.prospect_id))]
  const appointmentIds = (appointments.data ?? []).map((row) => row.id)
  const prospectsResponse = prospectIds.length
    ? await supabase
        .from('public_intake_prospects')
        .select('id, first_name, last_name, phone, email, potential_duplicate')
        .in('id', prospectIds)
    : { data: [], error: null }
  if (prospectsResponse.error) {
    return NextResponse.json({ error: prospectsResponse.error.message }, { status: 500 })
  }
  const prospects = new Map((prospectsResponse.data ?? []).map((prospect) => [prospect.id, prospect]))
  const eventsResponse = appointmentIds.length
    ? await supabase
        .from('intake_appointment_events')
        .select('id, appointment_id, event_type, previous_start_at, new_start_at, note, actor_name, created_at')
        .in('appointment_id', appointmentIds)
        .order('created_at', { ascending: false })
    : { data: [], error: null }
  if (eventsResponse.error) {
    return NextResponse.json({ error: eventsResponse.error.message }, { status: 500 })
  }

  return NextResponse.json({
    appointments: (appointments.data ?? []).map((appointment) => ({
      ...appointment,
      prospect: prospects.get(appointment.prospect_id) ?? null,
      events: (eventsResponse.data ?? []).filter(
        (event) => event.appointment_id === appointment.id
      ),
    })),
    blocks: blocks.data ?? [],
    rapidCallbacks: callbacks.data ?? [],
  })
}
