import { NextRequest, NextResponse } from 'next/server'
import { syncAdSpend } from '@/lib/adSpendSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET est manquant.' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }
  const result = await syncAdSpend(45)
  return NextResponse.json(result, {
    status: result.results.some((item) => item.status === 'error') ? 207 : 200,
  })
}

