import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { handleManualInvoiceDelivery } from '../lib/clinical-unification/manualInvoiceDelivery.ts'
import { renderInvoiceEmail, validInvoiceEmailTemplate } from '../lib/clinical-finance/invoiceEmailTemplate.ts'
const id='10000000-0000-4000-8000-000000000001',key='20000000-0000-4000-8000-000000000001',digest='a'.repeat(64),pdf=Buffer.from('%PDF-1.4 fictitious')
const invoice={id,version:1,number:null,clientName:'Client fictif',payerName:'Payeur fictif',recipient:'payer@example.invalid',totalCents:13500,serviceDates:['2026-11-19'],status:'unsent',blockedReason:null,digest}
const payload={invoiceId:id,expectedVersion:1,digest,key,confirmed:true}
const request=(body:unknown=payload)=>new Request('https://app.example.test/api/clinical-workspace/billing/delivery/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
function harness(options:{disabled?:boolean;canSend?:boolean;providerFailure?:string;finishFailure?:boolean;badHash?:boolean;status?:string}={}){
 const calls:{name:string;args:Record<string,unknown>}[]=[],sent:unknown[]=[]
 const deps={rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});if(name==='clinical_manual_invoice_preview')return{serviceDate:'2026-11-18',invoices:[invoice]};if(name==='clinical_manual_invoice_send_claim')return{canSend:options.canSend??true,status:options.status??'pending',id,number:123,recipient:invoice.recipient,base64:pdf.toString('base64'),sha256:options.badHash?'b'.repeat(64):createHash('sha256').update(pdf).digest('hex')};if(name==='clinical_billing_document')return{base64:pdf.toString('base64'),sha256:options.badHash?'b'.repeat(64):createHash('sha256').update(pdf).digest('hex')};if(name==='clinical_manual_invoice_send_finish'&&options.finishFailure)throw Error('DB_FINISH_UNAVAILABLE');return null},configured:()=>{if(options.disabled)throw Error('DISABLED')},send:async(input:unknown)=>{sent.push(input);if(options.providerFailure)throw Error(options.providerFailure);return{id:'provider-fixture'}}}
 return{calls,sent,deps}
}
test('aperçu seul : aucune fermeture, aucun fournisseur, aucune écriture',async()=>{const h=harness();const r=await handleManualInvoiceDelivery(new Request('https://app.example.test/preview?scope=yesterday'),['delivery','preview'],h.deps);assert.equal(r.status,200);assert.equal(h.calls.length,1);assert.equal(h.sent.length,0)})
test('confirmation explicite obligatoire avant toute RPC',async()=>{const h=harness();assert.equal((await handleManualInvoiceDelivery(request({...payload,confirmed:false}),['delivery','send'],h.deps)).status,400);assert.equal(h.calls.length,0)})
test('envois désactivés : aucun claim ni clôture de facture',async()=>{const h=harness({disabled:true});assert.equal((await handleManualInvoiceDelivery(request(),['delivery','send'],h.deps)).status,503);assert.equal(h.calls.length,1);assert.equal(h.sent.length,0)})
test('facture du jour : envoi manuel confirmé possible sans délai de lendemain',async()=>{const h=harness();const r=await handleManualInvoiceDelivery(request(),['delivery','send'],h.deps);assert.equal(r.status,200);assert.equal(h.sent.length,1);assert.equal(h.calls.at(-1)?.args.p_status,'sent')})
test('rejeu, pending et uncertain ne déclenchent jamais un second appel fournisseur',async()=>{for(const status of ['sent','pending','uncertain']){const h=harness({canSend:false,status});const r=await handleManualInvoiceDelivery(request(),['delivery','send'],h.deps);assert.equal(r.status,status==='sent'?200:409);assert.equal(h.sent.length,0)}})
test('refus certain distinct du délai réseau ambigu; pas de reprise automatique',async()=>{for(const [error,status] of [['REAL_INVOICE_PROVIDER_REJECTED','failed'],['TIMEOUT','uncertain']]){const h=harness({providerFailure:error});assert.equal((await handleManualInvoiceDelivery(request(),['delivery','send'],h.deps)).status,502);assert.equal(h.calls.at(-1)?.args.p_status,status);assert.equal(h.sent.length,1)}})
test('PDF altéré : aucun envoi; confirmation SQL perdue après fournisseur : aucun second envoi',async()=>{const invalid=harness({badHash:true});await handleManualInvoiceDelivery(request(),['delivery','send'],invalid.deps);assert.equal(invalid.sent.length,0);const lost=harness({finishFailure:true});assert.equal((await handleManualInvoiceDelivery(request(),['delivery','send'],lost.deps)).status,502);assert.equal(lost.sent.length,1)})

test('facture modifiee apres apercu : message precis et aucun fournisseur appele',async()=>{const h=harness();const rpc=h.deps.rpc;h.deps.rpc=async(name,args)=>{if(name==='clinical_manual_invoice_send_claim')throw Object.assign(new Error('private-details'),{code:'40001'});return rpc(name,args)};const r=await handleManualInvoiceDelivery(request(),['delivery','send'],h.deps);assert.equal(r.status,409);assert.match(await r.text(),/destinataire/);assert.equal(h.sent.length,0)})

test('le modèle enregistré arrive au même fournisseur que le PDF vérifié', async () => {
 const h = harness()
 const template = { subject: 'Facture {{numero_facture}}', text: 'Pièce jointe {{numero_facture}} pour {{nom_payeur}}' }
 const r = await handleManualInvoiceDelivery(request(), ['delivery','send'], { ...h.deps, template: async () => template })
 assert.equal(r.status, 200)
 assert.deepEqual(h.sent[0], { to: invoice.recipient, number: 123, pdfBase64: pdf.toString('base64'), invoiceId: id,
  renderedMessage: { subject: 'Facture 123', text: 'Pièce jointe 123 pour Payeur fictif' } })
 assert.deepEqual(renderInvoiceEmail(template, 123, { nom_payeur: 'Personne fictive' }), { subject: 'Facture 123', text: 'Pièce jointe 123 pour Personne fictive' })
 assert.equal(validInvoiceEmailTemplate({ ...template, text: 'Sans champ requis' }), false)
 assert.equal(validInvoiceEmailTemplate({ ...template, subject: template.subject + '\nAutre en-tête' }), false)
})
