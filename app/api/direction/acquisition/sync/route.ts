import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { isSuperAdmin } from '@/lib/superAdmin'
import { syncAdSpend } from '@/lib/adSpendSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const direction = await getDirectionContext(request)
  if (direction.error) {
    return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  }
  if (!isSuperAdmin(direction.context.user, direction.context.profile)) {
    return NextResponse.json({ error: 'Accès réservé à la super administration.' }, { status: 403 })
  }
  const body = await request.json().catch(() => ({})) as { days?: unknown }
  const days = Number(body.days ?? 90)
  const result = await syncAdSpend(Number.isFinite(days) ? days : 90)
  return NextResponse.json(result, {
    status: result.results.some((item) => item.status === 'error') ? 207 : 200,
  })
}

