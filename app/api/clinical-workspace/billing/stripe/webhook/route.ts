import { isLocalClinicalRuntime, readLocalClinicalRuntime, readStripeTestConfig } from '@/lib/clinical-local/runtime'
import { localJson, localRpc } from '@/lib/clinical-local/http'
import { verifyStripeTestEvent } from '@/lib/clinical-finance/stripeTest'
import { verifyStripeSavedEvent } from '@/lib/clinical-finance/stripeSavedCard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export async function POST(request: Request) {
  if (!isLocalClinicalRuntime()) return localJson({ error: 'Ressource introuvable.' }, 404)
  try {
    const config = readStripeTestConfig()
    if (!config || Number(request.headers.get('Content-Length') ?? 0) > 128 * 1024)
      return localJson({ error: 'Signature Stripe refusée.' }, 400)
    const raw = await request.text(), signature = request.headers.get('Stripe-Signature')
    const event = verifyStripeSavedEvent(raw, signature, config.webhookSecret)
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.object
      const meta = intent.metadata && typeof intent.metadata === 'object'
        ? intent.metadata as Record<string, unknown> : {}
      if (intent.livemode !== false || intent.status !== 'succeeded' || intent.currency !== 'cad' ||
        typeof intent.id !== 'string' || !/^pi_[A-Za-z0-9]+$/.test(intent.id) ||
        !uuid(meta.checkoutId) || !uuid(meta.invoiceId) ||
        !Number.isInteger(intent.amount_received) || intent.amount_received !== Number(meta.amountCents) ||
        typeof intent.customer !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(intent.customer) ||
        typeof intent.payment_method !== 'string' || !/^pm_[A-Za-z0-9]+$/.test(intent.payment_method))
        return localJson({ error: 'Événement Stripe test incohérent.' }, 400)
      const local = readLocalClinicalRuntime()
      await localRpc(local, local.serviceRoleKey, 'lab_billing_stripe_saved_settle', {
        p_checkout_id: meta.checkoutId, p_invoice_id: meta.invoiceId,
        p_payment_intent_id: intent.id, p_amount_cents: intent.amount_received,
        p_event_id: event.id, p_customer_id: intent.customer, p_payment_method_id: intent.payment_method,
      })
      return localJson({ received: true })
    }
    if (event.type !== 'checkout.session.completed') return localJson({ received: true })
    const checkout = verifyStripeTestEvent(raw, signature, config.webhookSecret)
    if (checkout.session.payment_status !== 'paid') return localJson({ received: true })
    const session = checkout.session, meta = session.metadata
    if (session.currency.toLowerCase() !== 'cad' || !uuid(meta.checkoutId) || !uuid(meta.invoiceId)
      || !Number.isInteger(Number(meta.amountCents)) || Number(meta.amountCents) !== session.amount_total
      || !session.payment_intent) return localJson({ error: 'Événement Stripe test incohérent.' }, 400)
    const local = readLocalClinicalRuntime()
    await localRpc(local, local.serviceRoleKey, 'lab_billing_stripe_test_settle', {
      p_checkout_id: meta.checkoutId, p_invoice_id: meta.invoiceId, p_session_id: session.id,
      p_payment_intent_id: session.payment_intent, p_amount_cents: session.amount_total, p_event_id: checkout.id,
    })
    return localJson({ received: true })
  } catch {
    return localJson({ error: 'La confirmation Stripe test n’a pas été acceptée.' }, 400)
  }
}

