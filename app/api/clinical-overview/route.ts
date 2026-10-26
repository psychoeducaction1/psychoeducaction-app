import { NextRequest, NextResponse } from 'next/server'
import { getClinicalOverviewContext } from '@/lib/clinicalOverviewServer'
import { clinicalOverviewViews, type ClinicalOverviewView } from '@/lib/clinicalOverview'

export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' }
  const result = await getClinicalOverviewContext(request)
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status, headers })
  const view = request.nextUrl.searchParams.get('view')
  const isDirectionPage = view === 'direction-dashboard' || view === 'direction-waiting-list'
  if (!isDirectionPage && !clinicalOverviewViews.includes(view as ClinicalOverviewView)) return NextResponse.json({ error: 'Vue invalide.' }, { status: 400, headers })
  const { data, error } = await result.context.db.rpc(isDirectionPage ? 'read_clinical_direction_pages' : 'read_clinical_overview', { requested_view: view })
  if (error) return NextResponse.json({ error: 'Consultation indisponible. Réessayez plus tard.' }, { status: error.code === '42501' ? 403 : 503, headers })
  return NextResponse.json(data, { headers })
}
