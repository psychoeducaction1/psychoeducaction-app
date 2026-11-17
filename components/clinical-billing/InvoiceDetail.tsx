'use client'
import { PaymentCorrections } from './PaymentCorrections'

import { useState } from 'react'
import { Badge, buttonClass } from '@/components/Ui'
import type { BillingPdfDocument, DurableBillingAck, DurableBillingCommand, DurableBillingWorkspace } from '@/lib/clinical-finance/durableTypes'
import { billingDocumentDownloadUrl, saveOpeningFeePolicy } from '@/lib/clinical-finance/durableClient'
import { BillingForm, Field, clinicalCard, inputClass, read } from './primitives'
import { dateLabel, invoiceStatusLabels, money, moneyInput, parseCents, paymentLabels, reasonLabels } from './model'
import { SavedCardChargePanel } from './SavedCardChargePanel'

export type BillingUi = { data: DurableBillingWorkspace; busy: boolean; run: (command: DurableBillingCommand) => Promise<DurableBillingAck>; select: (patch: Record<string, string | null>) => Promise<void>; openModule: (module: 'clients' | 'mandates' | 'calendar', query: Record<string, string>) => Promise<void>; refresh: () => Promise<void> }

function quantityLabel(quantity: string, unit: 'minute' | 'km' | 'service') {
  if (unit === 'minute') {
    const minutes = Number(quantity)
    return minutes % 60 === 0 ? `${minutes / 60} h` : `${quantity} min`
  }
  return unit === 'km' ? `${quantity} km` : quantity
}

export function BillingDocuments({ documents, context }: { documents: BillingPdfDocument[]; context: 'administration' | 'clinical' }) {
  if (!documents.length) return <p className="text-sm text-[#8a6f5d]">Aucun PDF disponible pour le moment.</p>
  return <div className="flex flex-wrap gap-2">{documents.map(document => <a key={document.id} href={billingDocumentDownloadUrl(document.id, context) + '?view=inline'} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary')}>{document.kind === 'invoice' ? 'Consulter la facture PDF' : document.kind === 'receipt' ? 'Consulter le reçu PDF' : document.kind === 'refund' ? 'Consulter le remboursement PDF' : 'Consulter l’ajustement PDF'}</a>)}</div>
}

export function InvoiceDetail({ ui }: { ui: BillingUi }) {
  const selected = ui.data.selected
  const [operation, setOperation] = useState<'payment' | 'refund'>('payment')
  const [openingReason, setOpeningReason] = useState('')
  const [openingPending, setOpeningPending] = useState(false)
  const [openingError, setOpeningError] = useState('')
  if (!selected) return <section className={clinicalCard}>Sélectionnez une facture pour voir son détail.</section>
  const realApplication = process.env.NEXT_PUBLIC_PEA_CONTROLLED_MERGE === 'true'
  const invoice = selected.invoice
  const base = { invoiceId: invoice.id, expectedVersion: invoice.version }
  const refundable = invoice.refundableCents > 0 ? invoice.refundableCents : Math.max(0, Math.min(invoice.paidCents - invoice.refundedCents, invoice.totalCents - invoice.creditedCents))
  const limit = operation === 'payment' ? invoice.dueCents : refundable
  const relatedDocuments = invoice.documents.filter(document => document.kind !== 'invoice' && document.kind !== 'credit')
  const invoiceDocuments = invoice.documents.filter(document => document.kind === 'invoice')
  const meetingCount = invoice.lines.filter(line => line.kind === 'clinical' || line.kind === 'report').length
  const openingLine = invoice.lines.find(line => line.kind === 'opening')
  return <div className="grid min-w-0 gap-4">
    <section className={clinicalCard}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{invoice.clientName} · {invoice.professionalName}</p><p className="text-sm">Payeur : <strong>{invoice.payerName}</strong></p></div><Badge tone={invoice.status === 'draft' ? 'warning' : invoice.paymentStatus === 'paid' ? 'success' : 'neutral'}>{invoice.status === 'draft' ? 'Facture ouverte' : invoiceStatusLabels[invoice.paymentStatus]}</Badge></div>
      <div className="mt-4 flex flex-wrap gap-2 text-sm"><span>{meetingCount > 1 ? `Rencontres : ${meetingCount}` : `Rencontre : ${dateLabel(invoice.serviceDate)}`}</span><span>·</span><span>Solde : <strong>{money(invoice.dueCents)}</strong></span></div>
      {invoiceDocuments.length > 0 && <div className="mt-4"><BillingDocuments documents={invoiceDocuments} context="administration" /></div>}
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">Service</th><th className="py-2">Quantité</th><th className="py-2 text-right">Montant</th></tr></thead><tbody>{invoice.lines.map(line => <tr key={line.id} className="border-b border-[#f0e5d8]"><td className="py-2">{line.description}</td><td className="py-2">{quantityLabel(line.quantity, line.unit)}</td><td className="py-2 text-right">{money(line.amountCents)}</td></tr>)}</tbody></table></div>
      <div className="mt-3 grid gap-1 rounded-xl bg-[#f8f2e9] p-3 text-sm"><p className="flex justify-between"><strong>Total</strong><strong>{money(invoice.totalCents)}</strong></p><p className="flex justify-between"><span>Payé</span><span>{money(invoice.paidCents - invoice.refundedCents)}</span></p>{invoice.creditedCents > 0 && <p className="flex justify-between"><span>Ajustements</span><span>{money(invoice.creditedCents)}</span></p>}<p className="flex justify-between text-base"><strong>À payer</strong><strong>{money(invoice.dueCents)}</strong></p></div>
    </section>
    {openingLine && <section className={clinicalCard}><h4 className="mb-2 font-semibold">Frais d’ouverture</h4><p className="mb-3 text-sm">Ces frais de {money(openingLine.amountCents)} représentent la part de ce payeur. Une annulation sur une facture ouverte retire la ligne de toutes les parts; sur une facture fermée, elle produit un ajustement pour cette part.</p>
      <form className="grid gap-3" onSubmit={async event => { event.preventDefault(); if (!openingReason.trim() || openingPending) return; setOpeningPending(true); setOpeningError(''); try { if (invoice.status === 'draft') await saveOpeningFeePolicy({ actorId: ui.data.actor.id, context: 'administration' }, invoice.clientId, false, openingReason.trim()); else await ui.run({ action: 'credit.record', data: { ...base, amountCents: openingLine.amountCents, reason: 'billing_correction', note: openingReason.trim() } }); await ui.refresh() } catch (cause) { setOpeningError(cause instanceof Error ? cause.message : 'L’annulation n’a pas pu être confirmée.') } finally { setOpeningPending(false) } }}>
        <Field label="Motif de l’annulation"><textarea className={inputClass} required maxLength={500} value={openingReason} onChange={event => setOpeningReason(event.target.value)} rows={2} /></Field>
        <button type="submit" className={buttonClass('secondary')} disabled={ui.busy || openingPending || (invoice.status === 'issued' && !ui.data.canCreditRefund)}>{invoice.status === 'draft' ? 'Retirer les frais d’ouverture' : 'Créer un ajustement des frais d’ouverture'}</button>
        {openingError && <p role="alert" className="text-sm text-red-700">{openingError}</p>}
      </form>
    </section>}
    {invoice.sourceChanged && <section role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">L’activité a changé après la préparation. Vérifiez la facture avant de poursuivre.{invoice.status === 'draft' && <BillingForm build={() => ({ action: 'draft.refresh', data: { sourceId: invoice.sourceId, expectedVersion: invoice.sourceVersion } }) as DurableBillingCommand} execute={ui.run} disabled={ui.busy} submitLabel="Actualiser la facture"><span className="sr-only">Recalculer depuis l’activité corrigée</span></BillingForm>}</section>}
    {invoice.voidedAt && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">Cette facture est annulée.{invoice.replacementInvoiceId && <button type="button" className="ml-2 underline" onClick={() => void ui.select({ invoiceId: invoice.replacementInvoiceId!, status: 'all', invoiceNumber: null, search: null, dateFrom: null, dateTo: null, page: '1' })}>Voir la facture de remplacement</button>}</p>}
    {Boolean(invoice.paymentReviewInvoiceIds?.length) && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p>Un paiement de la facture annulée reste à vérifier avant de finaliser cette facture.</p>{invoice.paymentReviewInvoiceIds?.map(id => <button key={id} type="button" className="mt-2 block underline" onClick={() => void ui.select({ invoiceId: id, status: 'voided', invoiceNumber: null, search: null, dateFrom: null, dateTo: null, page: '1' })}>Vérifier le paiement de la facture annulée</button>)}</div>}
    <PaymentCorrections ui={ui} />
    {!invoice.voidedAt && !invoice.paymentReviewInvoiceIds?.length && invoice.status === 'draft' && <section id="invoice-action-close" className={clinicalCard}><h4 className="mb-2 font-semibold">Terminer cette facture</h4><p className="mb-3 text-sm">Les prochaines rencontres du même client et payeur s’ajoutent à cette facture tant qu’elle reste ouverte. Vous pouvez la fermer maintenant pour séparer les rencontres suivantes. L’envoi de la facture ou l’enregistrement d’un paiement la ferme aussi automatiquement et lui attribue un numéro et un PDF.</p><BillingForm build={() => ({ action: 'invoice.issue', data: { ...base, confirmed: true } }) as DurableBillingCommand} execute={ui.run} disabled={ui.busy || invoice.sourceChanged} submitLabel="Fermer cette facture" confirmation="Arrêter d’ajouter des rencontres à cette facture ? Les prochaines rencontres iront sur une nouvelle facture."><span className="sr-only">Fermer le groupe de rencontres de cette facture</span></BillingForm></section>}
    {!invoice.voidedAt && !invoice.paymentReviewInvoiceIds?.length && !invoice.sentDemoAt && <section id="invoice-action-send" className={clinicalCard}><BillingForm build={() => ({ action: 'invoice.send_demo', data: { ...base, confirmed: true } }) as DurableBillingCommand} execute={ui.run} disabled={ui.busy || invoice.sourceChanged} submitLabel="Envoyer la facture" confirmation={invoice.status === 'draft' ? 'L’envoi fermera et numérotera cette facture. Les prochaines rencontres iront sur une nouvelle facture. Confirmer l’envoi simulé ?' : 'Confirmer l’envoi simulé de cette facture ?'}><p className="text-sm">Destinataire : {invoice.payerName}{invoice.payerEmail && ' · ' + invoice.payerEmail}</p></BillingForm></section>}
    {!invoice.voidedAt && !invoice.paymentReviewInvoiceIds?.length && ui.data.canManagePayments && invoice.dueCents > 0 && <SavedCardChargePanel key={invoice.id + ':' + invoice.version} invoiceId={invoice.id} patientId={invoice.clientId} payerId={invoice.payerId} payerName={invoice.payerName} expectedVersion={invoice.version} dueCents={invoice.dueCents} disabled={ui.busy || invoice.sourceChanged} openPayer={() => void ui.openModule('clients', { client: invoice.clientId, payerCard: '1' })} refresh={ui.refresh} />}
    {!invoice.voidedAt && !invoice.paymentReviewInvoiceIds?.length && ui.data.canManagePayments && <section id="invoice-action-payment" className={clinicalCard}><div className="mb-3 flex flex-wrap gap-2"><button className={buttonClass(operation === 'payment' ? 'primary' : 'secondary')} onClick={() => setOperation('payment')}>Paiement et reçu</button>{ui.data.canCreditRefund && invoice.paidCents > invoice.refundedCents && <button className={buttonClass(operation === 'refund' ? 'primary' : 'secondary')} onClick={() => setOperation('refund')}>Remboursement</button>}</div>
      {limit > 0 ? <BillingForm key={invoice.id + ':' + operation} build={(form, choice): DurableBillingCommand => {
        const amountCents = parseCents(read(form, 'amount'), limit), method = read(form, 'method') as keyof typeof paymentLabels
        if (operation === 'payment') return { action: 'payment.record', data: { ...base, amountCents, method, confirmed: true, reference: read(form, 'reference'), sendReceiptDemo: !realApplication && choice === 'primary' } }
        return { action: 'refund.record', data: { ...base, amountCents, method, confirmed: true, reason: read(form, 'reason') as keyof typeof reasonLabels, note: read(form, 'note') } }
      }} execute={ui.run} disabled={ui.busy || invoice.sourceChanged} submitLabel={operation === 'payment' ? realApplication ? 'Enregistrer le paiement' : 'Enregistrer le paiement et envoyer le reçu' : 'Enregistrer le remboursement'} secondarySubmitLabel={operation === 'payment' && !realApplication ? 'Enregistrer sans envoyer le reçu' : undefined} confirmation={operation === 'payment' ? invoice.status === 'draft' ? 'Ce paiement fermera et numérotera cette facture. Les prochaines rencontres iront sur une nouvelle facture. Confirmer le paiement ?' : 'Confirmer ce paiement ?' : 'Confirmer ce remboursement ?'}>
        <Field label={'Montant — maximum ' + money(limit)}><input name="amount" className={inputClass} inputMode="decimal" required defaultValue={moneyInput(limit)} /></Field>
        <Field label="Mode"><select name="method" className={inputClass} defaultValue="transfer_demo">{Object.entries(paymentLabels).filter(([key]) => key !== 'card_demo').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        {operation === 'payment' ? <Field label="Référence facultative"><input name="reference" maxLength={120} autoComplete="off" className={inputClass} /></Field> : <><Field label="Motif"><select name="reason" className={inputClass}>{Object.entries(reasonLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="Justification"><textarea name="note" className={inputClass} required maxLength={1000} rows={2} /></Field></>}
      </BillingForm> : <p className="text-sm">{operation === 'payment' ? 'Cette facture ne présente aucun solde à payer.' : 'Aucun paiement à rembourser.'}</p>}
    </section>}
    {relatedDocuments.length > 0 && <details className={clinicalCard}><summary className="mb-3 cursor-pointer font-semibold">Reçus et remboursements</summary><BillingDocuments documents={relatedDocuments} context="administration" />
      {relatedDocuments.filter(document => document.kind === 'receipt').map(document => <div key={document.id} className="mt-3"><BillingForm build={() => ({ action: 'receipt.send_demo', data: { ...base, documentId: document.id, confirmed: true } }) as DurableBillingCommand} execute={ui.run} disabled={ui.busy} submitLabel="Envoyer ce reçu" confirmation="Confirmer l’envoi simulé de ce reçu ?"><p className="text-sm">Destinataire : {invoice.payerName}{invoice.payerEmail && ' · ' + invoice.payerEmail}</p></BillingForm></div>)}
    </details>}
  </div>
}

