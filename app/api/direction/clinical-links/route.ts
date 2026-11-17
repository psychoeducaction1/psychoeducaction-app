import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { shouldUseClinicalLegacyBridge } from '@/lib/clinical-integration/legacyBridgeRuntime'
import { runClinicalLegacyLinkQuery } from '@/lib/clinical-integration/legacyLinkQuery'

const noStore = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest) {
  if (!shouldUseClinicalLegacyBridge()) return NextResponse.json({ error: 'Ressource introuvable.' }, { status: 404, headers: noStore })
  const direction = await getDirectionContext(request)
  if (direction.error) return NextResponse.json({ error: direction.error.message }, { status: direction.error.status, headers: noStore })
  const params = new URL(request.url).searchParams
  if ([...params.keys()].some(key => key !== 'sourceTable' && key !== 'sourceId')
    || params.getAll('sourceTable').length !== 1 || params.getAll('sourceId').length !== 1) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400, headers: noStore })
  }
  const result = await runClinicalLegacyLinkQuery({
    sourceTable: params.get('sourceTable'), sourceId: params.get('sourceId'),
    actorId: direction.context.user.id,
    rpc: (name, args) => getSupabaseAdmin().rpc(name, args),
  })
  return NextResponse.json(result.body, { status: result.status, headers: noStore })
}
