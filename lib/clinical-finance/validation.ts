import type {DurableBillingCommand,DurableBillingFilter} from './durableTypes'
// Reuse the bounded scalar/strict-object validators already used by mandates.
import {shape,object,uuid,int,date,text,one} from '@/lib/clinical-mandates/validation'
export const BILLING_ACTIONS=['batch.prepare','opening.confirm','draft.refresh','invoice.issue','invoice.send_demo','receipt.send_demo','payment.record','payment.remove','payment.restore','invoice.void','credit.record','refund.record'] as const
export const BILLING_METHODS=['card_demo','cash_demo','transfer_demo','deposit_demo'] as const
export const BILLING_STATUSES=['all','draft','issued','unpaid','partial','paid','voided'] as const
export function isDurableBillingCommand(value:unknown):value is DurableBillingCommand{
 if(!shape(value,['action','data'])||!object(value)||!one(value.action,BILLING_ACTIONS)||!object(value.data))return false
 const d=value.data,version=()=>uuid(d.invoiceId)&&int(d.expectedVersion,1)
 switch(value.action){
 case 'batch.prepare':return shape(d,['throughDate'])&&date(d.throughDate)
 case 'opening.confirm':return shape(d,['appointmentId','expectedAppointmentVersion','confirmed'])&&uuid(d.appointmentId)&&int(d.expectedAppointmentVersion,1)&&d.confirmed===true
 case 'draft.refresh':return shape(d,['sourceId','expectedVersion'])&&uuid(d.sourceId)&&int(d.expectedVersion,1)
 case 'invoice.issue':case 'invoice.send_demo':return shape(d,['invoiceId','expectedVersion','confirmed'])&&version()&&d.confirmed===true
 case 'receipt.send_demo':return shape(d,['invoiceId','documentId','expectedVersion','confirmed'])&&version()&&uuid(d.invoiceId)&&uuid(d.documentId)&&d.confirmed===true
 case 'invoice.void':return shape(d,['invoiceId','expectedVersion','confirmed','reason'])&&version()&&d.confirmed===true&&text(d.reason,500)&&Boolean(d.reason.trim())
 case 'payment.remove':case 'payment.restore':return shape(d,['invoiceId','expectedVersion','paymentId','confirmed','reason'])&&version()&&uuid(d.paymentId)&&d.confirmed===true&&text(d.reason,500)&&Boolean(d.reason.trim())
 case 'payment.record':return (shape(d,['invoiceId','expectedVersion','amountCents','method','confirmed','reference'])||shape(d,['invoiceId','expectedVersion','amountCents','method','confirmed','reference','sendReceiptDemo']))&&version()&&int(d.amountCents,1,100000000)&&one(d.method,BILLING_METHODS)&&d.confirmed===true&&text(d.reference,160)&&(d.sendReceiptDemo===undefined||typeof d.sendReceiptDemo==='boolean')
 case 'credit.record':return shape(d,['invoiceId','expectedVersion','amountCents','reason','note'])&&version()&&int(d.amountCents,1,100000000)&&one(d.reason,['billing_correction','service_adjustment'])&&text(d.note,1000)&&Boolean(d.note.trim())
 case 'refund.record':return shape(d,['invoiceId','expectedVersion','amountCents','method','confirmed','reason','note'])&&version()&&int(d.amountCents,1,100000000)&&one(d.method,BILLING_METHODS)&&d.confirmed===true&&one(d.reason,['billing_correction','service_adjustment'])&&text(d.note,1000)&&Boolean(d.note.trim())
 default:return false
 }
}
export function isDurableBillingFilter(v:unknown):v is DurableBillingFilter{return shape(v,['search','status','page','pageSize','clientId','activityId','professional','clientName','invoiceNumber','clientNumber','dateFrom','dateTo','recurring'])&&object(v)&&text(v.search,120)&&one(v.status,BILLING_STATUSES)&&int(v.page,1,100000)&&[10,25,50].includes(Number(v.pageSize))&&(v.clientId===null||uuid(v.clientId))&&(v.activityId===null||uuid(v.activityId))&&text(v.professional,120)&&text(v.clientName,120)&&text(v.invoiceNumber,80)&&text(v.clientNumber,20)&&one(v.recurring,['all','yes','no'])&&[v.dateFrom,v.dateTo].every(value=>value===null||date(value))&&(v.dateFrom===null||v.dateTo===null||String(v.dateFrom)<=String(v.dateTo))}
