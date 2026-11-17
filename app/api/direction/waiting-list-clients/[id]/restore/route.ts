import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { runWaitingListAssignmentAction } from '@/lib/waitingListAssignmentActions'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const direction = await getDirectionContext(request)
  if (direction.error) return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  const { id } = await params
  const result = await runWaitingListAssignmentAction('restore', id, null, {
    authorize: async () => ({ actorId: direction.context.user.id }),
    rpc: (name, args) => getSupabaseAdmin().rpc(name, args),
  })
  return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } })
}
