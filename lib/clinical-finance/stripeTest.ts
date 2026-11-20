import { createHmac, timingSafeEqual } from 'node:crypto'
import type { StripeTestConfig } from '@/lib/clinical-local/runtime'

export type StripeTestSession = { id: string; clientSecret: string; expiresAt: string }
export type StripeTestEvent = { id: string; type: string; livemode: false; session: {
  id: string; livemode: false; mode: 'payment'; payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total: number; currency: string; payment_intent: string | null; metadata: Record<string, string>
} }

const sessionId = (value: unknown): value is string => typeof value === 'string' && /^cs_test_[A-Za-z0-9]+$/.test(value)
const sessionSecret = (value: unknown): value is string => typeof value === 'string' && /^cs_test_[A-Za-z0-9]+_secret_(?:[A-Za-z0-9]|%[A-Fa-f0-9]{2})+$/.test(value)
const paymentIntentId = (value: unknown): value is string => typeof value === 'string' && /^pi_[A-Za-z0-9]+$/.test(value)
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export async function createStripeTestSession(config: StripeTestConfig, input: { checkoutId: string; invoiceId: string; amountCents: number; invoiceNumber: string | null; origin: string }, request: typeof fetch = fetch): Promise<StripeTestSession> {
  if (!uuid(input.checkoutId) || !uuid(input.invoiceId) || !Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 100000000
    || !['http://127.0.0.1:3100', 'http://127.0.0.1:3101'].includes(input.origin)) throw new Error('STRIPE_TEST_INPUT_REFUSED')
  const body = new URLSearchParams({
    mode: 'payment', ui_mode: 'embedded', 'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'cad',
    'line_items[0][price_data][unit_amount]': String(input.amountCents),
    'line_items[0][price_data][product_data][name]': `Facture fictive ${input.invoiceNumber ?? input.invoiceId}`,
    'line_items[0][quantity]': '1',
    client_reference_id: input.checkoutId,
    'metadata[checkoutId]': input.checkoutId,
    'metadata[invoiceId]': input.invoiceId,
    'metadata[amountCents]': String(input.amountCents),
    return_url: `${input.origin}/administration/facturation?invoiceId=${input.invoiceId}&stripe=test-retour&session_id={CHECKOUT_SESSION_ID}`,
  })
  const response = await request('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${config.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `pea-lab-${input.checkoutId}` }, body,
  })
  if (!response.ok) throw new Error('STRIPE_TEST_UNAVAILABLE')
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object') throw new Error('STRIPE_TEST_INVALID_RESPONSE')
  const session = payload as Record<string, unknown>
  if (session.livemode !== false || !sessionId(session.id) || !sessionSecret(session.client_secret) || !Number.isInteger(session.expires_at)) throw new Error('STRIPE_TEST_INVALID_RESPONSE')
  return { id: session.id, clientSecret: session.client_secret, expiresAt: new Date(Number(session.expires_at) * 1000).toISOString() }
}

export async function retrieveStripeTestSession(config: StripeTestConfig, id: string, request: typeof fetch = fetch): Promise<StripeTestSession> {
  if (!sessionId(id)) throw new Error('STRIPE_TEST_INPUT_REFUSED')
  const response = await request(`https://api.stripe.com/v1/checkout/sessions/${id}`, {
    method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${config.secretKey}` },
  })
  if (!response.ok) throw new Error('STRIPE_TEST_UNAVAILABLE')
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object') throw new Error('STRIPE_TEST_INVALID_RESPONSE')
  const session = payload as Record<string, unknown>
  if (session.id !== id || session.livemode !== false || !sessionSecret(session.client_secret) || !Number.isInteger(session.expires_at)) throw new Error('STRIPE_TEST_INVALID_RESPONSE')
  return { id, clientSecret: session.client_secret, expiresAt: new Date(Number(session.expires_at) * 1000).toISOString() }
}

/** Verify the exact raw request body before parsing any Stripe-supplied fields. */
export function verifyStripeTestEvent(raw: string, signature: string | null, secret: string, now = Date.now()): StripeTestEvent {
  if (raw.length > 128 * 1024 || !signature || !/^whsec_[A-Za-z0-9]+$/.test(secret)) throw new Error('STRIPE_SIGNATURE_REFUSED')
  const pieces = signature.split(',').map(part => part.trim().split('='))
  const timestamp = pieces.find(part => part[0] === 't')?.[1]
  const candidates = pieces.filter(part => part[0] === 'v1').map(part => part[1])
  if (!timestamp || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !candidates.length) throw new Error('STRIPE_SIGNATURE_REFUSED')
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest()
  if (!candidates.some(candidate => /^[a-f0-9]{64}$/i.test(candidate) && timingSafeEqual(Buffer.from(candidate, 'hex'), expected))) throw new Error('STRIPE_SIGNATURE_REFUSED')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('STRIPE_EVENT_REFUSED')
  const event = value as Record<string, unknown>
  const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>).object : null
  if (typeof event.id !== 'string' || !/^evt_[A-Za-z0-9]+$/.test(event.id) || typeof event.type !== 'string' || event.livemode !== false || !data || typeof data !== 'object') throw new Error('STRIPE_EVENT_REFUSED')
  const session = data as Record<string, unknown>
  if (!sessionId(session.id) || session.livemode !== false || session.mode !== 'payment' || !['paid', 'unpaid', 'no_payment_required'].includes(String(session.payment_status))
    || !Number.isInteger(session.amount_total) || !Number.isSafeInteger(session.amount_total) || typeof session.currency !== 'string'
    || session.payment_intent !== null && !paymentIntentId(session.payment_intent)
    || !session.metadata || typeof session.metadata !== 'object') throw new Error('STRIPE_EVENT_REFUSED')
  return { id: event.id, type: event.type, livemode: false, session: session as StripeTestEvent['session'] }
}
