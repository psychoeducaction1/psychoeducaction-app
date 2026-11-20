import { isLocalClinicalRuntime } from '@/lib/clinical-local/runtime'
import { localModuleUnavailable } from '@/lib/clinical-local/http'
import type { ClinicalActorInput } from '@/lib/clinical-core/types'
import { getClinicalFixtureActor, isClinicalFixtureEnabled } from '@/lib/clinical-core/fixtureAccess'
import { ClinicalError, isClinicalError, object, uuid } from '@/lib/clinical-core/validation'
import { readCalendarJson } from '@/lib/clinical-calendar/http'
import { isCalendarServiceError } from '@/lib/clinical-calendar/types'
import { isBillingError, type BillingLedgerKind, type BillingLedgerReason } from '@/lib/clinical-finance/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'X-Clinical-Fixture-Actor, X-Clinical-Context', 'X-Content-Type-Options': 'nosniff' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
async function handle(request: Request) {
  if (isLocalClinicalRuntime()) return localModuleUnavailable(request)
  if (!isClinicalFixtureEnabled()) return json({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
  const actor = getClinicalFixtureActor(request.headers.get('X-Clinical-Fixture-Actor'))
  if (!actor) return json({ error: 'Compte de démonstration non autorisé.', code: 'FORBIDDEN' }, 403)
  try {
    const context = request.headers.get('X-Clinical-Context')
    const actorInput:ClinicalActorInput = context === null ? actor.id : context === 'administration' || context === 'clinical' ? {actorId:actor.id,context} : (()=>{throw new ClinicalError(400,'INVALID_CONTEXT','Contexte invalide.')})()
    const { getFinanceFixtureServiceForActor } = await import('@/lib/clinical-finance/fixtures')
    const service = getFinanceFixtureServiceForActor(actorInput)
    if (request.method === 'GET') return json({ workspace: service.getWorkspace(actorInput) })
    const envelope = object(await readCalendarJson(request), ['action', 'invoiceId', 'input'])
    switch (envelope.action) {
      case 'draft': {
        object(envelope, ['action', 'input'])
        const input = object(envelope.input, ['appointmentId', 'payerId'])
        return json({ invoice: service.createInvoiceDraft(actorInput, { appointmentId: uuid(input.appointmentId), payerId: uuid(input.payerId) }) }, 201)
      }
      case 'validate': {
        object(envelope, ['action', 'invoiceId', 'input'])
        const input = object(envelope.input, ['expectedVersion', 'confirmed'])
        return json({ invoice: service.validateInvoice(actorInput, uuid(envelope.invoiceId), input as { expectedVersion: number; confirmed: true }) })
      }
      case 'ledger': {
        object(envelope, ['action', 'invoiceId', 'input'])
        const input = object(envelope.input, ['expectedVersion', 'kind', 'amountCents', 'reason', 'requestKey'])
        return json({ entry: service.appendLedgerEntry(actorInput, uuid(envelope.invoiceId), input as { expectedVersion: number; kind: BillingLedgerKind; amountCents: number; reason: BillingLedgerReason; requestKey: string }) })
      }
      case 'rate': {
        object(envelope, ['action', 'input'])
        const input = object(envelope.input, ['effectiveFrom', 'hourlyClientCents'])
        return json({ rate: service.addRate(actorInput, input as { effectiveFrom: string; hourlyClientCents: number }) }, 201)
      }
      default: return json({ error: 'Action financière invalide.', code: 'INVALID_INPUT' }, 400)
    }
  } catch (error) {
    if (isBillingError(error) || isClinicalError(error) || isCalendarServiceError(error)) return json({ error: error.message, code: error.code }, error.status)
    return json({ error: 'La simulation financière ne peut pas effectuer cette opération.', code: 'FIXTURE_ERROR' }, 503)
  }
}
export async function GET(request: Request) { return handle(request) }
export async function POST(request: Request) { return handle(request) }
