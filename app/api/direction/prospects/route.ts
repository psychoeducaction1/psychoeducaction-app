import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(request: NextRequest) {
  const direction = await getDirectionContext(request)
  if (direction.error) {
    return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  }

  const { data, error } = await getSupabaseAdmin()
    .from('public_intake_prospects')
    .select('*, appointments:intake_appointments(id, prospect_id, start_at, end_at, status, events:intake_appointment_events(id, event_type, previous_start_at, new_start_at, note, actor_name, created_at))')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ prospects: data ?? [] })
}
