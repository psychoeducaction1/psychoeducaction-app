import { readBoundedJsonObject } from '@/lib/boundedJsonBody'
import { hasCapability } from '@/lib/clinical-core/capabilities'
import { ClinicalError, isClinicalError } from '@/lib/clinical-core/validation'
import { contextOf, localIdentity, localJson, localRpc } from '@/lib/clinical-local/http'
import { isLocalClinicalRuntime, readStripeTestConfig } from '@/lib/clinical-local/runtime'
import { createCardSetup, createFictionalCustomer, retrieveCardDetails, retrieveCardSetup } from '@/lib/clinical-finance/stripeSavedCard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

async function handle(request: Request) {
  if (process.env.NEXT_PUBLIC_PEA_CLINICAL_UNIFICATION === 'true') {
    if (request.method !== 'GET') return localJson({ code: 'STRIPE_DISABLED', error: 'Les paiements bancaires sont désactivés sur cette copie isolée.' }, 409)
    return (await import('@/lib/clinical-unification/financeHttp')).handleUnifiedFinanceHttp(request, ['stripe', 'card'])
  }
  if (!isLocalClinicalRuntime()) return localJson({ error: 'Ressource introuvable.' }, 404)
  try {
    const { runtime: local, token, actor } = await localIdentity(request)
    if (contextOf(request) !== 'administration' || !hasCapability(actor, 'administration'))
      throw new ClinicalError(403, 'FORBIDDEN', 'Seule l’administration peut gérer une carte.')
    const config = readStripeTestConfig()
    if (!config) throw new ClinicalError(503, 'STRIPE_TEST_NOT_CONFIGURED', 'Stripe test n’est pas configuré dans ce laboratoire.')
    const input = request.method === 'GET'
      ? Object.fromEntries(new URL(request.url).searchParams)
      : await readBoundedJsonObject(request, 1024)
    if (!input || typeof input !== 'object' || !uuid(input.patientId) || !uuid(input.payerId))
      throw new ClinicalError(400, 'INVALID_INPUT', 'Payeur invalide.')
    const patientId = input.patientId, payerId = input.payerId
    if (request.method === 'GET') {
      return localJson(await localRpc(local, token, 'lab_billing_stripe_card_query', { p_patient_id: patientId, p_payer_id: payerId }))
    }
    if (request.method === 'POST') {
      if (!uuid(input.key)) throw new ClinicalError(400, 'INVALID_INPUT', 'Intention invalide.')
      const known = await localRpc<{ customerId: string | null }>(local, token, 'lab_billing_stripe_card_customer',
        { p_patient_id: patientId, p_payer_id: payerId, p_customer_id: null })
      const customerId = known.customerId ?? await createFictionalCustomer(config, patientId, payerId)
      if (!known.customerId) await localRpc(local, token, 'lab_billing_stripe_card_customer',
        { p_patient_id: patientId, p_payer_id: payerId, p_customer_id: customerId })
      const setup = await createCardSetup(config, customerId, input.key)
      return localJson({ ...setup, publishableKey: config.publishableKey })
    }
    if (request.method === 'PATCH') {
      if (input.authorized !== true) throw new ClinicalError(400, 'CARD_AUTHORIZATION_REQUIRED', 'Confirmez l’autorisation du titulaire.')
      if (typeof input.setupIntentId !== 'string' || !/^seti_[A-Za-z0-9]+$/.test(input.setupIntentId))
        throw new ClinicalError(400, 'INVALID_INPUT', 'Enregistrement invalide.')
      const known = await localRpc<{ customerId: string | null }>(local, token, 'lab_billing_stripe_card_customer',
        { p_patient_id: patientId, p_payer_id: payerId, p_customer_id: null })
      const setup = await retrieveCardSetup(config, input.setupIntentId)
      if (known.customerId !== setup.customerId) throw new ClinicalError(409, 'PAYER_MISMATCH', 'Cette carte n’appartient pas à ce payeur.')
      const card = await retrieveCardDetails(config, setup.paymentMethodId)
      if (card.customerId !== setup.customerId) throw new ClinicalError(409, 'PAYER_MISMATCH', 'Cette carte n’appartient pas à ce payeur.')
      await localRpc(local, local.serviceRoleKey, 'lab_billing_stripe_card_save', {
        p_patient_id: patientId, p_payer_id: payerId, p_customer_id: setup.customerId,
        p_payment_method_id: setup.paymentMethodId, p_brand: card.brand, p_last4: card.last4,
        p_exp_month: card.expMonth, p_exp_year: card.expYear, p_actor_id: actor.id,
      })
      return localJson(await localRpc(local, token, 'lab_billing_stripe_card_query', { p_patient_id: patientId, p_payer_id: payerId }))
    }
    return localJson({ error: 'Méthode refusée.' }, 405)
  } catch (error) {
    if (isClinicalError(error)) return localJson({ error: error.message, code: error.code }, error.status)
    return localJson({ error: 'La carte Stripe test n’a pas pu être confirmée.' }, 503)
  }
}
export const GET = handle
export const POST = handle
export const PATCH = handle


