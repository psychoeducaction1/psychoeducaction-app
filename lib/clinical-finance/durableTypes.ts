import type {ClinicalAccessContext,FixtureActor} from '../clinical-core/types'
export type BillingPaymentMethod='card_demo'|'cash_demo'|'transfer_demo'|'deposit_demo'
export type DurableBillingFilter={search:string;status:'all'|'draft'|'issued'|'unpaid'|'partial'|'paid';page:number;pageSize:10|25|50;clientId:string|null;activityId:string|null;professional:string;clientName:string;invoiceNumber:string;clientNumber:string;dateFrom:string|null;dateTo:string|null;recurring:'all'|'yes'|'no'}
export type BillingPdfDocument={id:string;kind:'invoice'|'receipt'|'credit'|'refund';sha256:string;byteLength:number;createdAt:string}
export type DurableInvoiceLine={id:string;kind:'clinical'|'report'|'travel'|'opening'|'cancellation';description:string;quantity:string;unit:'minute'|'km'|'service';unitAmountCents:number;amountCents:number}
export type DurableBillingLedger={id:string;invoiceId:string;kind:'payment'|'credit'|'refund';amountCents:number;method:BillingPaymentMethod|null;reason:string;reference:string;at:string;actorId:string;document:BillingPdfDocument|null}
export type DurableInvoice={id:string;sourceId:string;sourceVersion:number;sourceChanged:boolean;sourceKind:'activity'|'opening'|'cancellation';activityId:string|null;activityIds?:string[];appointmentId:string;clientId:string;clientName:string;professionalId:string;professionalName:string;mandateId:string;mandateRevisionId:string;payerId:string;payerName:string;payerEmail:string;serviceDate:string;currency:'CAD';status:'draft'|'issued';paymentStatus:'unpaid'|'partial'|'paid';number:string|null;version:number;totalCents:number;paidCents:number;creditedCents:number;refundedCents:number;dueCents:number;refundableCents:number;lastPaymentAt:string|null;lastPaymentCents:number;createdAt:string;issuedAt:string|null;sentDemoAt:string|null;lines:DurableInvoiceLine[];documents:BillingPdfDocument[]}
export type BillingEligibleActivity={id:string;appointmentId:string;episodeId:string;clientId:string;clientName:string;professionalId:string;professionalName:string;serviceDate:string;actualMinutes:number;travelKilometers:string;readyDate:string;prepared:boolean;blockedReason:string|null}
export type BillingOpeningCandidate={appointmentId:string;appointmentVersion:number;clientId:string;clientName:string;episodeId:string;startAt:string;professionalName:string;confirmed:boolean;sourceId:string|null}
export type BillingHistory={id:string;action:string;invoiceId:string|null;sourceId:string|null;actorId:string|null;source:'authenticated'|'worker';at:string}
export type DurableBillingWorkspace=({mode:'isolated_local';fictional:true}|{mode:'isolated_unified';fictional:false})&{context:ClinicalAccessContext;actor:FixtureActor;kind:'administrative';canCreditRefund:boolean;currentDate:string;taxWarning:string;allocationRule:string;automaticPreparation:{mode:'local_worker'|'user_action'|'on_load'|'scheduled';lastRunAt:string|null;preparedCount:number};filters:DurableBillingFilter;invoices:DurableInvoice[];total:number;summary:{totalCents:number;paidCents:number;dueCents:number};selected:{invoice:DurableInvoice;ledger:DurableBillingLedger[];history:BillingHistory[]}|null;eligibleActivities:BillingEligibleActivity[];openingCandidates:BillingOpeningCandidate[]}
export type BillingDocumentPayload={id:string;sha256:string;byteLength:number;bytesBase64:string}
export type DurableBillingAck={ok:true;action:string;id:string;version:number;affectedInvoiceIds:string[];replayed?:boolean}
export type DurableBillingCommand=
 |{action:'batch.prepare';data:{throughDate:string}}
 |{action:'opening.confirm';data:{appointmentId:string;expectedAppointmentVersion:number;confirmed:true}}
 |{action:'draft.refresh';data:{sourceId:string;expectedVersion:number}}
 |{action:'invoice.issue';data:{invoiceId:string;expectedVersion:number;confirmed:true}}
 |{action:'invoice.send_demo';data:{invoiceId:string;expectedVersion:number;confirmed:true}}
 |{action:'receipt.send_demo';data:{invoiceId:string;documentId:string;expectedVersion:number;confirmed:true}}
 |{action:'payment.record';data:{invoiceId:string;expectedVersion:number;amountCents:number;method:BillingPaymentMethod;confirmed:true;reference:string;sendReceiptDemo?:boolean}}
 |{action:'credit.record';data:{invoiceId:string;expectedVersion:number;amountCents:number;reason:'billing_correction'|'service_adjustment';note:string}}
 |{action:'refund.record';data:{invoiceId:string;expectedVersion:number;amountCents:number;method:BillingPaymentMethod;confirmed:true;reason:'billing_correction'|'service_adjustment';note:string}}
