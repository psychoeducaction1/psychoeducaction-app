import { NextRequest, NextResponse } from 'next/server'
import { getClinicalCoordinationContext } from '@/lib/clinicalCoordinationServer'

export async function GET(request: NextRequest) {
  const result = await getClinicalCoordinationContext(request)
  const headers = { 'Cache-Control': 'private, no-store' }
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status, headers })
  const { isManager, staff, profile } = result.context
  return NextResponse.json({ isManager, staff, name: profile.full_name ?? 'Utilisateur' }, { headers })
}
