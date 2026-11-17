type PaymentInput = { actorId: string; invoiceId: string; version: number;
  amountCents: number; method: string }
type IntentStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

/** Keep only an intent fingerprint and UUID in this browser session, never a payment payload. */
export async function realPaymentIntent(input: PaymentInput, store: IntentStore,
  makeKey = () => crypto.randomUUID(), now = () => new Date().toISOString()) {
  if (!uuid(input.actorId) || !uuid(input.invoiceId) || !Number.isInteger(input.version)
    || input.version < 1 || !Number.isInteger(input.amountCents) || input.amountCents < 1
    || !['transfer', 'cash', 'cheque', 'card_external', 'other'].includes(input.method))
    throw new Error('Paiement invalide.')
  const hash = async (parts: unknown[]) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(parts)))), byte => byte.toString(16).padStart(2, '0')).join('')
  const storageKey = `pea.real.payment.v1:${await hash([input.actorId, input.invoiceId, input.version])}`
  const fingerprint = await hash([input.amountCents, input.method])
  try {
    const saved = store.getItem(storageKey)
    const parsed: unknown = saved ? JSON.parse(saved) : null
    const previous = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null
    if (previous && previous.fingerprint !== fingerprint)
      throw new Error('Une intention de paiement est déjà en attente pour cette facture. Actualisez avant de modifier le montant ou la méthode.')
    const key = previous ? previous.key : makeKey()
    const receivedAt = previous ? previous.receivedAt : now()
    if (!uuid(key) || typeof receivedAt !== 'string' || !Number.isFinite(Date.parse(receivedAt)))
      throw new Error('INVALID_INTENT')
    store.setItem(storageKey, JSON.stringify({ key, receivedAt, fingerprint }))
    if (store.getItem(storageKey) !== JSON.stringify({ key, receivedAt, fingerprint })) throw new Error('INTENT_NOT_STORED')
    return { key, receivedAt, clear() { try { store.removeItem(storageKey) } catch { /* ACK already confirmed. */ } } }
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('Une intention de paiement')) throw cause
    throw new Error('Le stockage de session doit être disponible pour reprendre un paiement sans doublon.')
  }
}
