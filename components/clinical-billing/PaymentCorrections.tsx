'use client'

import { BillingForm } from './primitives'
import type { BillingUi } from './InvoiceDetail'
import type { DurableBillingCommand } from '@/lib/clinical-finance/durableTypes'
import { money, dateLabel, paymentLabels } from './model'

export function PaymentCorrections({ ui }: { ui: BillingUi }) {
  const selected = ui.data.selected
  if (!selected || !ui.data.canManagePayments) return null
  const { invoice, ledger } = selected
  const payments = ledger.filter(entry => entry.kind === 'payment')
  const active = payments.filter(entry => !entry.removedAt), removed = payments.filter(entry => entry.removedAt)
  const payment = (entry: typeof payments[number], restore: boolean) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eadfd2] p-3 text-sm">
    <span>{money(entry.amountCents)} · {dateLabel(entry.at)}{entry.method && ` · ${paymentLabels[entry.method]}`}{entry.reference && ` · ${entry.reference}`}</span>
    <BillingForm build={(): DurableBillingCommand => ({ action: restore ? 'payment.restore' : 'payment.remove', data: { invoiceId: invoice.id, expectedVersion: invoice.version, paymentId: entry.id, confirmed: true, reason: restore ? 'Restauration du paiement enregistré' : 'Correction de saisie du paiement' } })} execute={ui.run} disabled={ui.busy} submitLabel={restore ? 'Rétablir le paiement' : 'Retirer le paiement'} confirmation={restore ? 'Rétablir ce paiement dans la facture ? Aucun débit bancaire ne sera effectué.' : 'Retirer cet enregistrement de paiement ? Aucun remboursement bancaire ne sera effectué.'}><span className="sr-only">{restore ? 'Rétablir' : 'Retirer'} le paiement de {money(entry.amountCents)}</span></BillingForm>
  </div>
  if (!payments.length) return null
  return <section className="grid gap-3 rounded-2xl border border-[#eadfd2] bg-white p-5">
    {active.length > 0 && <><h4 className="font-semibold">Paiements enregistrés</h4>{active.map(entry => payment(entry, false))}</>}
    {removed.length > 0 && <details><summary className="cursor-pointer text-sm">Paiements retirés</summary><div className="mt-3 grid gap-3">{removed.map(entry => payment(entry, true))}</div></details>}
  </section>
}
