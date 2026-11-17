import { ClinicalApiError } from '@/lib/clinical-workspace/api'
import type { DurableBillingFilter, DurableBillingWorkspace, DurableInvoice } from '@/lib/clinical-finance/durableTypes'

export const money = (cents: number) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
export const moneyInput = (cents: number) => (cents / 100).toFixed(2)
export const dateLabel = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z')) : new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' }).format(new Date(value))
export const invoiceStatusLabels = { all: 'Toutes', draft: 'Ouvertes', issued: 'Fermées', unpaid: 'À payer', partial: 'Partiellement payées', paid: 'Payées' }
export const paymentLabels = { card_demo: 'Carte enregistrée manuellement — simulation', cash_demo: 'Comptant — simulation', transfer_demo: 'Virement Interac — simulation', deposit_demo: 'Dépôt — simulation' }
export const documentLabels = { invoice: 'Facture', receipt: 'Reçu de paiement', credit: 'Document d’avoir', refund: 'Reçu de remboursement' }
export const reasonLabels = { billing_correction: 'Correction de facturation', service_adjustment: 'Ajustement de service' }
export function invoiceCalendarQuery(invoice: Pick<DurableInvoice,'clientId'|'professionalId'|'appointmentId'|'serviceDate'>): Record<string,string> {
  return { client: invoice.clientId, pro: invoice.professionalId, appointment: invoice.appointmentId, day: invoice.serviceDate, scope: 'client', view: 'day' }
}
/** UUID scopes survive module navigation; names remain optional search text only. */
export function billingFiltersFromQuery(query: URLSearchParams): DurableBillingFilter & { invoiceId?: string } {
  const status = query.get('status') ?? 'unpaid', size = Number(query.get('pageSize') ?? 25)
  const dateFrom = query.get('dateFrom'), dateTo = query.get('dateTo'), recurring = query.get('recurring') ?? 'all'
  return { search: (query.get('search') ?? '').slice(0, 120), status: Object.hasOwn(invoiceStatusLabels, status) ? status as DurableBillingFilter['status'] : 'unpaid',
    page: Math.min(100000, Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1)), pageSize: [10, 25, 50].includes(size) ? size as 10 | 25 | 50 : 25,
    clientId: query.get('client')?.toLowerCase() ?? null, activityId: query.get('activity')?.toLowerCase() ?? null,
    professional: (query.get('professional') ?? '').slice(0, 120), clientName: (query.get('clientName') ?? '').slice(0, 120),
    invoiceNumber: (query.get('invoiceNumber') ?? '').slice(0, 80), clientNumber: (query.get('clientNumber') ?? '').slice(0, 20),
    dateFrom: dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? dateFrom : null, dateTo: dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? dateTo : null,
    recurring: recurring === 'yes' || recurring === 'no' ? recurring : 'all',
    ...(query.get('invoiceId') ? { invoiceId: query.get('invoiceId')!.toLowerCase() } : {}) }
}
/** Never render a prior client/activity/selection while the next request is loading. */
export function billingMatchesRequest(data: DurableBillingWorkspace, filters: DurableBillingFilter & { invoiceId?: string }): boolean {
  return (['search','status','page','pageSize','clientId','activityId','professional','clientName','invoiceNumber','clientNumber','dateFrom','dateTo','recurring'] as const).every(key => data.filters[key] === filters[key])
    && (data.selected?.invoice.id ?? null) === (filters.invoiceId ?? null)
}
export function parseCents(value: string, maximum = 100_000_000): number {
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(value.trim())
  if (!match) throw new Error('Saisissez un montant positif avec au maximum deux décimales.')
  const result = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum) throw new Error('Le montant dépasse le solde ou la limite autorisée.')
  return result
}
export function uncertainWrite(cause: unknown): boolean {
  return !(cause instanceof ClinicalApiError && cause.status >= 400 && cause.status < 500 && ![408, 429].includes(cause.status))
}
/** A confirmed write is never reissued because its later read failed. */
export async function acknowledgeAndRefresh<T>(write: () => Promise<T>, refresh: () => Promise<boolean>, confirmed: (ack: T) => void): Promise<{ ack: T; refreshed: boolean }> {
  const ack = await write()
  confirmed(ack)
  try { return { ack, refreshed: await refresh() } } catch { return { ack, refreshed: false } }
}
export function historyLabel(action: string): string {
  return ({ 'batch.prepare': 'Rencontres vérifiées pour la facturation', 'opening.confirm': 'Premier rendez-vous confirmé', 'invoice.issue': 'Facture fermée et numérotée', 'invoice.send_demo': 'Envoi simulé enregistré', 'receipt.send_demo': 'Envoi simulé du reçu enregistré', 'payment.record': 'Paiement simulé enregistré', 'credit.record': 'Avoir enregistré', 'refund.record': 'Remboursement simulé enregistré',
    opening_prepared: 'Frais d’ouverture ajoutés', activity_prepared: 'Rencontre ajoutée à la facturation', invoice_prepared: 'Facture ouverte', invoice_issued: 'Facture fermée', invoice_sent_demo: 'Envoi simulé', payment_recorded: 'Paiement simulé', 'stripe.test.payment': 'Paiement Stripe test confirmé', credit_recorded: 'Avoir', refund_recorded: 'Remboursement simulé', opening_confirmed: 'Frais d’ouverture confirmés', batch_prepared: 'Rencontres vérifiées pour la facturation' } as Record<string, string>)[action] ?? 'Événement financier'
}


/** A lost response freezes the exact monetary intention, including its CAS version. */
export function createBillingFormIntent<C>() {
  let pending: { command: C } | null = null, acknowledged = false
  return {
    hasPending() { return pending !== null },
    capture(build: () => C): C { if (acknowledged) throw new ClinicalApiError('Cette opération est déjà confirmée. Modifiez explicitement la saisie pour une nouvelle opération.', 409, 'ALREADY_CONFIRMED'); if (!pending) pending = { command: structuredClone(build()) }; return pending.command },
    acknowledge() { pending = null; acknowledged = true },
    changed() { if (!pending) acknowledged = false },
    cancel() { pending = null; acknowledged = false },
    reject(cause: unknown): boolean { const unknown = pending !== null && uncertainWrite(cause); if (!unknown) pending = null; return unknown },
  }
}

export function blockReasonLabel(code: string): string {
  return ({ NOT_BILLABLE: 'Cette activité est non facturable.', FINANCIAL_REVIEW_REQUIRED: 'Une révision financière est requise : vérifiez les exceptions et le mandat applicable.', ACTIVITY_UNAVAILABLE: 'Cette activité n’est pas une prestation réalisée facturable.', SIGNED_MANDATE_REQUIRED: 'Le tarif ou la répartition des payeurs manque dans le mandat attribué.', RATE_UNSUPPORTED: 'Le tarif du mandat ne permet pas encore cette prestation.', TRAVEL_RATE_REQUIRED: 'Un tarif kilométrique daté manque pour le déplacement.', MEETING_NOT_FINISHED: 'La facture sera préparée après la fin de la rencontre.', ACTIVITY_CHANGED: 'L’activité a été corrigée : réconciliez les brouillons avant émission.' } as Record<string, string>)[code] ?? 'Cette activité nécessite une vérification administrative avant préparation.'
}
