import { readBoundedJsonObject, JsonBodyError } from '@/lib/boundedJsonBody'
import { hasCapability } from '@/lib/clinical-core/capabilities'
import { ClinicalError, isClinicalError } from '@/lib/clinical-core/validation'
import { contextOf, localIdentity, localJson, localRpc } from '@/lib/clinical-local/http'
import { isLocalClinicalRuntime, readStripeTestConfig } from '@/lib/clinical-local/runtime'
import { ISOLATED_APP_ORIGIN } from '@/lib/developmentIsolation'
import { createStripeTestSession, retrieveStripeTestSession } from '@/lib/clinical-finance/stripeTest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export async function POST(request: Request) {
  if (!isLocalClinicalRuntime()) return localJson({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
  try {
    const { runtime: local, token, actor } = await localIdentity(request)
    if (contextOf(request) !== 'administration' || !hasCapability(actor, 'administration')) throw new ClinicalError(403, 'FORBIDDEN', 'Seule l’administration peut créer un lien de paiement.')
    const config = readStripeTestConfig()
    if (!config) throw new ClinicalError(503, 'STRIPE_TEST_NOT_CONFIGURED', 'Stripe en mode test n’est pas configuré dans ce laboratoire.')
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new ClinicalError(400, 'INVALID_INPUT', 'Demande invalide.')
    const body = await readBoundedJsonObject(request, 1024)
    if (Object.keys(body).sort().join(',') !== 'amountCents,expectedVersion,invoiceId,key' || !uuid(body.invoiceId) || !uuid(body.key)
      || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1
      || !Number.isInteger(body.amountCents) || Number(body.amountCents) < 1 || Number(body.amountCents) > 100000000) throw new ClinicalError(400, 'INVALID_INPUT', 'Demande invalide.')
    const reserved = await localRpc<unknown>(local, token, 'lab_billing_stripe_test_reserve', {
      p_invoice_id: body.invoiceId, p_expected_version: body.expectedVersion, p_amount_cents: body.amountCents, p_key: body.key,
    })
    if (!reserved || typeof reserved !== 'object') throw new ClinicalError(502, 'INVALID_RESPONSE', 'La réservation Stripe n’a pas pu être confirmée.')
    const row = reserved as Record<string, unknown>
    if (!uuid(row.checkoutId) || row.invoiceId !== body.invoiceId || row.amountCents !== body.amountCents
      || row.status !== 'pending' || row.sessionId !== null && (typeof row.sessionId !== 'string' || !/^cs_test_[A-Za-z0-9]+$/.test(row.sessionId))
      || row.invoiceNumber !== null && typeof row.invoiceNumber !== 'string') throw new ClinicalError(502, 'INVALID_RESPONSE', 'La réservation Stripe n’a pas pu être confirmée.')
    await localRpc(local, token, 'lab_billing_stripe_checkout_verify', { p_checkout_id: row.checkoutId })
    const session = row.sessionId
      ? await retrieveStripeTestSession(config, row.sessionId as string)
      : await createStripeTestSession(config, { checkoutId: row.checkoutId, invoiceId: row.invoiceId as string, amountCents: row.amountCents as number, invoiceNumber: row.invoiceNumber as string | null, origin: ISOLATED_APP_ORIGIN })
    if (!row.sessionId) await localRpc(local, token, 'lab_billing_stripe_test_attach', { p_checkout_id: row.checkoutId, p_session_id: session.id, p_expires_at: session.expiresAt })
    return localJson({ checkoutId: row.checkoutId, clientSecret: session.clientSecret, publishableKey: config.publishableKey, expiresAt: session.expiresAt, amountCents: row.amountCents })
  } catch (error) {
    if (error instanceof JsonBodyError) return localJson({ error: 'Demande invalide.', code: 'INVALID_INPUT' }, error.status)
    if (isClinicalError(error)) return localJson({ error: error.message, code: error.code }, error.status)
    return localJson({ error: 'La page de paiement Stripe test est indisponible. Aucun paiement n’a été enregistré.', code: 'STRIPE_TEST_UNAVAILABLE' }, 503)
  }
}

