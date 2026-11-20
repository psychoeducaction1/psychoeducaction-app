import { readBoundedJsonObject } from '@/lib/boundedJsonBody'
import { hasCapability } from '@/lib/clinical-core/capabilities'
import { ClinicalError, isClinicalError } from '@/lib/clinical-core/validation'
import { contextOf, localIdentity, localJson, localRpc } from '@/lib/clinical-local/http'
import { isLocalClinicalRuntime, readStripeTestConfig } from '@/lib/clinical-local/runtime'
import { chargeSavedCard } from '@/lib/clinical-finance/stripeSavedCard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export async function POST(request: Request) {
  if (!isLocalClinicalRuntime()) return localJson({ error: 'Ressource introuvable.' }, 404)
  let checkoutId: string | null = null
  let local: Awaited<ReturnType<typeof localIdentity>>['runtime'] | null = null
  let token: string | null = null
  try {
    const identity = await localIdentity(request)
    local = identity.runtime; token = identity.token
    if (contextOf(request) !== 'administration' || !hasCapability(identity.actor, 'administration'))
      throw new ClinicalError(403, 'FORBIDDEN', 'Seule l’administration peut encaisser une carte.')
    const config = readStripeTestConfig()
    if (!config) throw new ClinicalError(503, 'STRIPE_TEST_NOT_CONFIGURED', 'Stripe test n’est pas configuré dans ce laboratoire.')
    const body = await readBoundedJsonObject(request, 1024)
    if (Object.keys(body).sort().join(',') !== 'amountCents,expectedVersion,invoiceId,key'
      || !uuid(body.invoiceId) || !uuid(body.key) || !Number.isInteger(body.expectedVersion)
      || !Number.isInteger(body.amountCents) || Number(body.amountCents) < 1 || Number(body.amountCents) > 100000000)
      throw new ClinicalError(400, 'INVALID_INPUT', 'Paiement invalide.')
    const reserved = await localRpc<Record<string, unknown>>(local, token, 'lab_billing_stripe_test_reserve', {
      p_invoice_id: body.invoiceId, p_expected_version: body.expectedVersion,
      p_amount_cents: body.amountCents, p_key: body.key,
    })
    if (!uuid(reserved.checkoutId) || reserved.invoiceId !== body.invoiceId || reserved.amountCents !== body.amountCents)
      throw new ClinicalError(502, 'INVALID_RESPONSE', 'La réservation du paiement est incohérente.')
    checkoutId = reserved.checkoutId
    const prepared = await localRpc<Record<string, unknown>>(local, token, 'lab_billing_stripe_saved_prepare', {
      p_checkout_id: checkoutId, p_invoice_id: body.invoiceId,
    })
    if (!/^cus_[A-Za-z0-9]+$/.test(String(prepared.customerId)) ||
      !/^pm_[A-Za-z0-9]+$/.test(String(prepared.paymentMethodId)) || prepared.amountCents !== body.amountCents)
      throw new ClinicalError(502, 'INVALID_RESPONSE', 'La carte du payeur est incohérente.')
    const result = await chargeSavedCard(config, {
      checkoutId, invoiceId: body.invoiceId, customerId: String(prepared.customerId),
      paymentMethodId: String(prepared.paymentMethodId), amountCents: Number(body.amountCents),
    })
    if (result.status === 'succeeded') {
      await localRpc(local, local.serviceRoleKey, 'lab_billing_stripe_saved_settle', {
        p_checkout_id: checkoutId, p_invoice_id: body.invoiceId,
        p_payment_intent_id: result.paymentIntentId, p_amount_cents: body.amountCents,
        p_event_id: null, p_customer_id: prepared.customerId, p_payment_method_id: prepared.paymentMethodId,
      })
    }
    return localJson({ checkoutId, paymentIntentId: result.paymentIntentId, status: result.status === 'succeeded' ? 'confirme' : 'en_cours' })
  } catch (error) {
    if (error instanceof Error && error.message === 'STRIPE_CARD_DECLINED' && checkoutId && local && token) {
      try { await localRpc(local, local.serviceRoleKey, 'lab_billing_stripe_saved_fail', { p_checkout_id: checkoutId }) } catch { /* Retain the reserved attempt for reconciliation. */ }
      return localJson({ error: 'La carte a été refusée. Aucun paiement n’a été inscrit.', code: 'CARD_DECLINED' }, 402)
    }
    if (isClinicalError(error)) return localJson({ error: error.message, code: error.code }, error.status)
    return localJson({ error: 'La réponse Stripe est incertaine. Vérifiez cette tentative avant de recommencer.', code: 'STRIPE_UNCERTAIN' }, 503)
  }
}

