import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { runWaitingListAssignmentAction } from '@/lib/waitingListAssignmentActions'
import { JsonBodyError, readBoundedJsonObject } from '@/lib/boundedJsonBody'
import { getServiceOfficeAddresses } from '@/lib/serviceAppointmentServer'
import { shouldUseClinicalLegacyBridge } from '@/lib/clinical-integration/legacyBridgeRuntime'
import { assertUnificationRuntime } from '@/lib/clinical-unification/isolation'
import { controlledAssignmentEnabled } from '@/lib/clinical-unification/controlledMergeProfile'
import { unifiedAssignmentRpc } from '@/lib/clinical-unification/assignmentRpc'
import { realClinicalTransport } from '@/lib/clinical-real/transport'
import { getBearerToken } from '@/lib/superAdminServer'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const direction = await getDirectionContext(request)
  if (direction.error) return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await readBoundedJsonObject(request, 2_048) } catch (error) {
    if (error instanceof JsonBodyError) return NextResponse.json({ error: error.status === 413
      ? 'La requête d’assignation dépasse la taille autorisée.' : error.message }, { status: error.status })
    return NextResponse.json({ error: 'Lecture de la requête impossible.' }, { status: 400 })
  }
  const unified = process.env.PEA_UNIFICATION_PILOT === 'true'
    || controlledAssignmentEnabled(process.env, direction.context.user.id, body.professionalId)
  if (unified) assertUnificationRuntime()
  const result = await runWaitingListAssignmentAction('assign', id, body, {
    authorize: async () => ({ actorId: direction.context.user.id }),
    officeAddresses: getServiceOfficeAddresses,
    linkClinicalAssignment: unified || shouldUseClinicalLegacyBridge(),
    rpc: unified ? unifiedAssignmentRpc(realClinicalTransport(), getBearerToken(request)!)
      : (name, args) => getSupabaseAdmin().rpc(name, args),
  })
  return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } })
}
