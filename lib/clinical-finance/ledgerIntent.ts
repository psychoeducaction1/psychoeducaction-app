import type { BillingLedgerKind, BillingLedgerReason } from './types'

export type LedgerIntent = { actorId: string; invoiceId: string; expectedVersion: number; kind: BillingLedgerKind; amountCents: number; reason: BillingLedgerReason }
const fingerprint = (intent: LedgerIntent) => JSON.stringify([intent.actorId, intent.invoiceId, intent.expectedVersion, intent.kind, intent.amountCents, intent.reason])

/** Mémoire de l'onglet uniquement : le même essai survit à une réponse réseau perdue. */
export function createLedgerIntentTracker(newKey: () => string = () => crypto.randomUUID()) {
  let pending: { fingerprint: string; requestKey: string } | null = null
  return {
    keyFor(intent: LedgerIntent) {
      const signature = fingerprint(intent)
      if (pending?.fingerprint !== signature) pending = { fingerprint: signature, requestKey: newKey() }
      return pending.requestKey
    },
    acknowledge(intent: LedgerIntent) { if (pending?.fingerprint === fingerprint(intent)) pending = null },
    clear() { pending = null },
  }
}
