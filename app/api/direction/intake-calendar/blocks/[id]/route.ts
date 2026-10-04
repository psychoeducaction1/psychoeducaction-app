import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const direction = await getDirectionContext(request)
  if (direction.error) {
    return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  }
  const { id } = await params
  const supabase = getSupabaseAdmin()
  const { data: block, error: readError } = await supabase
    .from('intake_calendar_blocks')
    .select('id, start_at, end_at')
    .eq('id', id)
    .maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!block) return NextResponse.json({ error: 'Plage bloquée introuvable.' }, { status: 404 })

  const { error } = await supabase.from('intake_calendar_blocks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await supabase.from('audit_logs').insert({
    actor_profile_id: direction.context.user.id,
    actor_name: direction.context.profile.full_name ?? direction.context.user.email ?? null,
    actor_role: direction.context.profile.role,
    action: 'intake_calendar_block_deleted',
    entity_type: 'intake_calendar_block',
    entity_id: id,
    description: 'Blocage retiré du calendrier des appels.',
    metadata: { start_at: block.start_at, end_at: block.end_at },
  })
  return NextResponse.json({ success: true })
}
