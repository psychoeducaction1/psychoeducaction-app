import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { runProspectTestAction } from '@/lib/prospectTestActions'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await runProspectTestAction('mark', id, await request.json().catch(() => null), {
    authorize: async () => {
      const direction = await getDirectionContext(request)
      return direction.error
        ? { error: direction.error.message, status: direction.error.status }
        : { actorId: direction.context.user.id }
    },
    rpc: (name, args) => getSupabaseAdmin().rpc(name, args),
  })
  return NextResponse.json(result.body, { status: result.status })
}
