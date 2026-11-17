import { createHmac, timingSafeEqual } from 'node:crypto'
import type { StripeTestConfig } from '@/lib/clinical-local/runtime'

const stripeId = (value: unknown, prefix: string): value is string =>
  typeof value === 'string' && new RegExp('^' + prefix + '_[A-Za-z0-9]+$').test(value)

async function stripePost(config: StripeTestConfig, path: string, fields: Record<string, string>, key: string) {
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + config.secretKey, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': key },
    body: new URLSearchParams(fields),
  })
  if (!response.ok) {
    if (response.status === 402) throw new Error('STRIPE_CARD_DECLINED')
    const failure: unknown = await response.json().catch(() => null)
    const detail = failure && typeof failure === 'object' && 'error' in failure && failure.error && typeof failure.error === 'object'
      && 'code' in failure.error && typeof failure.error.code === 'string' && /^[a-z_]{1,50}$/.test(failure.error.code)
      ? failure.error.code : 'unknown'
    throw new Error(`STRIPE_TEST_HTTP_${response.status}_${detail}`)
  }
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || (value as { livemode?: unknown }).livemode !== false) throw new Error('STRIPE_TEST_INVALID_RESPONSE')
  return value as Record<string, unknown>
}

async function stripeGet(config: StripeTestConfig, path: string) {
  const response = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + config.secretKey },
  })
  if (!response.ok) throw new Error('STRIPE_TEST_UNAVAILABLE')
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object' || (value as { livemode?: unknown }).livemode !== false) throw new Error('STRIPE_TEST_INVALID_RESPONSE')
  return value as Record<string, unknown>
}

export async function createFictionalCustomer(config: StripeTestConfig, patientId: string, payerId: string) {
  const row = await stripePost(config, 'customers', {
    'metadata[fictional]': 'true', 'metadata[patientId]': patientId, 'metadata[payerId]': payerId,
  }, 'pea-lab-customer-' + patientId + '-' + payerId)
  if (!stripeId(row.id, 'cus')) throw new Error('STRIPE_TEST_INVALID_RESPONSE')
  return row.id
}

export async function createCardSetup(config: StripeTestConfig, customerId: string, key: string) {
  const row = await stripePost(config, 'setup_intents', {
    customer: customerId, 'payment_method_types[0]': 'card', usage: 'off_session',
    'metadata[fictional]': 'true',
  }, 'pea-lab-card-setup-' + key)
  if (!stripeId(row.id, 'seti') || typeof row.client_secret !== 'string' ||
    !/^seti_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(row.client_secret) || row.customer !== customerId)
    throw new Error('STRIPE_TEST_INVALID_RESPONSE')
  return { setupIntentId: row.id, clientSecret: row.client_secret }
}

export async function retrieveCardSetup(config: StripeTestConfig, setupIntentId: string) {
  if (!stripeId(setupIntentId, 'seti')) throw new Error('STRIPE_TEST_INPUT_REFUSED')
  const row = await stripeGet(config, 'setup_intents/' + setupIntentId)
  if (row.id !== setupIntentId || row.status !== 'succeeded' || !stripeId(row.customer, 'cus') || !stripeId(row.payment_method, 'pm'))
    throw new Error('STRIPE_SETUP_INCOMPLETE')
  return { customerId: row.customer, paymentMethodId: row.payment_method }
}

export async function retrieveCardDetails(config: StripeTestConfig, paymentMethodId: string) {
  if (!stripeId(paymentMethodId, 'pm')) throw new Error('STRIPE_TEST_INPUT_REFUSED')
  const row = await stripeGet(config, 'payment_methods/' + paymentMethodId)
  const card = row.card && typeof row.card === 'object' ? row.card as Record<string, unknown> : null
  if (row.id !== paymentMethodId || row.type !== 'card' || !stripeId(row.customer, 'cus') ||
    !card || typeof card.brand !== 'string' || typeof card.last4 !== 'string' ||
    !/^[0-9]{4}$/.test(card.last4) || !Number.isInteger(card.exp_month) || !Number.isInteger(card.exp_year))
    throw new Error('STRIPE_TEST_INVALID_RESPONSE')
  return { customerId: row.customer, brand: card.brand.slice(0, 40), last4: card.last4,
    expMonth: card.exp_month as number, expYear: card.exp_year as number }
}

export async function chargeSavedCard(config: StripeTestConfig, input: {
  checkoutId: string; invoiceId: string; customerId: string; paymentMethodId: string; amountCents: number
}) {
  const row = await stripePost(config, 'payment_intents', {
    amount: String(input.amountCents), currency: 'cad', customer: input.customerId,
    payment_method: input.paymentMethodId, confirm: 'true', off_session: 'true',
    error_on_requires_action: 'true', 'payment_method_types[0]': 'card',
    'metadata[fictional]': 'true', 'metadata[checkoutId]': input.checkoutId,
    'metadata[invoiceId]': input.invoiceId, 'metadata[amountCents]': String(input.amountCents),
  }, 'pea-lab-saved-charge-' + input.checkoutId)
  if (!stripeId(row.id, 'pi') || row.customer !== input.customerId ||
    row.payment_method !== input.paymentMethodId || row.amount !== input.amountCents || row.currency !== 'cad' ||
    (row.status === 'succeeded' && row.amount_received !== input.amountCents))
    throw new Error('STRIPE_TEST_INVALID_RESPONSE')
  return { paymentIntentId: row.id, status: row.status }
}

export function verifyStripeSavedEvent(raw: string, header: string | null, secret: string, now = Date.now()) {
  if (raw.length > 128 * 1024 || !header || !/^whsec_[A-Za-z0-9]+$/.test(secret)) throw new Error('STRIPE_SIGNATURE_REFUSED')
  const fields = header.split(',').map(item => item.trim().split('='))
  const timestamp = fields.find(item => item[0] === 't')?.[1]
  const signatures = fields.filter(item => item[0] === 'v1').map(item => item[1])
  if (!timestamp || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300)
    throw new Error('STRIPE_SIGNATURE_REFUSED')
  const expected = createHmac('sha256', secret).update(timestamp + '.' + raw).digest()
  if (!signatures.some(value => /^[a-f0-9]{64}$/i.test(value) && timingSafeEqual(Buffer.from(value, 'hex'), expected)))
    throw new Error('STRIPE_SIGNATURE_REFUSED')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('STRIPE_EVENT_REFUSED')
  const event = value as Record<string, unknown>
  const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>).object : null
  if (!stripeId(event.id, 'evt') || event.livemode !== false || !data || typeof data !== 'object')
    throw new Error('STRIPE_EVENT_REFUSED')
  return { id: event.id, type: event.type, object: data as Record<string, unknown> }
}

