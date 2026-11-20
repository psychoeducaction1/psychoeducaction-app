'use client'
import {useState} from 'react'
import {useClinicalNavigation} from '@/components/clinical-workspace/NavigationGuard'
import {buttonClass} from '@/components/Ui'
import type {DurableBillingCommand} from '@/lib/clinical-finance/durableTypes'
import type {BillingUi} from './InvoiceDetail'
import {BillingForm,Field,clinicalCard,inputClass,read} from './primitives'
import {money,moneyInput,parseCents,paymentLabels,reasonLabels} from './model'
import {SavedCardChargePanel,useSavedPayerCard} from './SavedCardChargePanel'

export function InvoicePayment({ui}:{ui:BillingUi}){
 const navigation=useClinicalNavigation()
 const invoice=ui.data.selected!.invoice
 const [operation,setOperation]=useState<'payment'|'refund'>('payment'),[chosenMethod,setChosenMethod]=useState<string|null>(null),[amount,setAmount]=useState(moneyInput(invoice.dueCents))
 const {card,error:cardError}=useSavedPayerCard(invoice.clientId,invoice.payerId)
 const method=operation==='payment'&&card?.hasCard?(chosenMethod??'saved_card'):chosenMethod&&chosenMethod!=='saved_card'?chosenMethod:'transfer_demo'
 const realApplication=process.env.NEXT_PUBLIC_PEA_CONTROLLED_MERGE==='true'
 const base={invoiceId:invoice.id,expectedVersion:invoice.version}
 const refundable=invoice.refundableCents>0?invoice.refundableCents:Math.max(0,Math.min(invoice.paidCents-invoice.refundedCents,invoice.totalCents-invoice.creditedCents))
 const limit=operation==='payment'?invoice.dueCents:refundable
 return (
    <section id="invoice-action-payment" className={clinicalCard}><div className="mb-3 flex flex-wrap gap-2"><button className={buttonClass(operation === 'payment' ? 'primary' : 'secondary')} onClick={() => void navigation.canLeave().then(allowed=>{if(allowed){setOperation('payment');setChosenMethod(null);setAmount(moneyInput(invoice.dueCents))}})}>Paiement et reçu</button>{ui.data.canCreditRefund && invoice.paidCents > invoice.refundedCents && <button className={buttonClass(operation === 'refund' ? 'primary' : 'secondary')} onClick={() => void navigation.canLeave().then(allowed=>{if(allowed){setOperation('refund');setChosenMethod(null);setAmount(moneyInput(refundable))}})}>Remboursement</button>}</div>
      {cardError && <p role="status" className="mb-3 text-sm text-[#8a6f5d]">La disponibilité de la carte n’a pas pu être vérifiée. Les autres modes restent disponibles.</p>}
      {!card&&!cardError&&operation==='payment'&&limit>0&&<p role="status" className="mb-3 text-sm">Vérification des modes de paiement…</p>}
      {limit > 0 && <Field label="Mode"><select name="payment-method" className={inputClass} value={method} disabled={ui.busy} onChange={event=>{const value=event.target.value;void navigation.canLeave().then(allowed=>{if(allowed)setChosenMethod(value)})}}>{operation==='payment'&&card?.hasCard&&<option value="saved_card">Carte de crédit · {card.brand} •••• {card.last4}</option>}{Object.entries(paymentLabels).filter(([key])=>key!=='card_demo').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>}
      {operation==='payment'&&method==='saved_card'&&card?.hasCard ? <SavedCardChargePanel invoiceId={invoice.id} payerName={invoice.payerName} expectedVersion={invoice.version} dueCents={invoice.dueCents} disabled={ui.busy||invoice.sourceChanged} refresh={ui.refresh} card={card} amount={amount} setAmount={setAmount}/> : limit > 0 ? <BillingForm key={invoice.id + ':' + operation+':'+method} build={(form, choice): DurableBillingCommand => {
        setChosenMethod(method)
        const amountCents = parseCents(read(form, 'amount'), limit), paymentMethod = method as keyof typeof paymentLabels
        if (operation === 'payment') return { action: 'payment.record', data: { ...base, amountCents, method: paymentMethod, confirmed: true, reference: read(form, 'reference'), sendReceiptDemo: !realApplication && choice === 'primary' } }
        return { action: 'refund.record', data: { ...base, amountCents, method: paymentMethod, confirmed: true, reason: read(form, 'reason') as keyof typeof reasonLabels, note: read(form, 'note') } }
      }} execute={ui.run} disabled={ui.busy || invoice.sourceChanged || (!card&&!cardError&&chosenMethod===null)} submitLabel={operation === 'payment' ? realApplication ? 'Enregistrer le paiement' : 'Enregistrer le paiement et envoyer le reçu' : 'Enregistrer le remboursement'} secondarySubmitLabel={operation === 'payment' && !realApplication ? 'Enregistrer sans envoyer le reçu' : undefined} confirmation={operation === 'payment' ? invoice.status === 'draft' ? 'Ce paiement fermera et numérotera cette facture. Les prochaines rencontres iront sur une nouvelle facture. Confirmer le paiement ?' : 'Confirmer ce paiement ?' : 'Confirmer ce remboursement ?'}>
        <Field label={'Montant — maximum ' + money(limit)}><input name="amount" className={inputClass} inputMode="decimal" required value={amount} onChange={event=>{setChosenMethod(method);setAmount(event.target.value)}} /></Field>

        {operation === 'payment' ? <Field label="Référence facultative"><input name="reference" maxLength={120} autoComplete="off" className={inputClass} /></Field> : <><Field label="Motif"><select name="reason" className={inputClass}>{Object.entries(reasonLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="Justification"><textarea name="note" className={inputClass} required maxLength={1000} rows={2} /></Field></>}
      </BillingForm> : <p className="text-sm">{operation === 'payment' ? 'Cette facture ne présente aucun solde à payer.' : 'Aucun paiement à rembourser.'}</p>}
    </section>
 )
}
