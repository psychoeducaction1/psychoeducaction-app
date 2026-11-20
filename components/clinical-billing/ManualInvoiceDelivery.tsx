'use client'
import { useRef, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import { clinicalSessionFetch } from '@/lib/clinical-unification/authClient'
import type { InvoiceDeliveryList, InvoiceDeliveryPreview } from '@/lib/clinical-finance/manualDelivery'
import { money } from './model'

export function ManualInvoiceDelivery({ invoiceId, disabled, onSent }: { invoiceId?: string; disabled?: boolean; onSent: () => Promise<void> }) {
 const [preview,setPreview]=useState<InvoiceDeliveryList|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<string[]>([]),[results,setResults]=useState<Record<string,string>>({})
 const keys=useRef(new Map<string,string>())
 const operation=useRef(false)
 const load=async()=>{
  if(busy)return
  setBusy(true);setError('');setResults({})
  try{
   const query=invoiceId?'invoiceId='+encodeURIComponent(invoiceId):'scope=yesterday'
   const response=await clinicalSessionFetch('/api/clinical-workspace/billing/delivery/preview?'+query,{headers:{'X-Clinical-Context':'administration'}})
   if(!response.ok)throw Error('Impossible de charger les factures à vérifier.')
   const value=await response.json() as InvoiceDeliveryList
   setPreview(value);setSelected(value.invoices.filter(i=>!i.blockedReason).map(i=>i.id));keys.current.clear()
  }catch(cause){setError(cause instanceof Error?cause.message:'Aperçu indisponible.')}finally{setBusy(false)}
 }
 const send=async()=>{
  if(operation.current||busy||!preview?.enabled)return
  const invoices=preview.invoices.filter(i=>selected.includes(i.id)&&!i.blockedReason&&!results[i.id])
  if(!invoices.length)return
  operation.current=true;setBusy(true);setError('')
  try{
   for(const invoice of invoices){
    let key=keys.current.get(invoice.id);if(!key){key=crypto.randomUUID();keys.current.set(invoice.id,key)}
    let label=''
    try{
     const response=await clinicalSessionFetch('/api/clinical-workspace/billing/delivery/send',{method:'POST',headers:{'Content-Type':'application/json','X-Clinical-Context':'administration'},body:JSON.stringify({invoiceId:invoice.id,expectedVersion:invoice.version,digest:invoice.digest,key,confirmed:true})})
     const value=await response.json() as {sent?:boolean;error?:string}
     label=response.ok&&value.sent?'Envoyée':value.error||'Envoi à vérifier. Ne renvoyez pas la facture.'
    }catch{label='Résultat à vérifier. Ne renvoyez pas la facture.'}
    setResults(current=>({...current,[invoice.id]:label}))
    if(label!=='Envoyée'){setError('Le lot est arrêté. Vérifiez la facture signalée avant de continuer.');break}
   }
   await onSent()
  }finally{operation.current=false;setBusy(false)}
 }
 const ready=preview?.invoices.filter(i=>selected.includes(i.id)&&!i.blockedReason&&!results[i.id])??[]
 const row=(invoice:InvoiceDeliveryPreview)=><label key={invoice.id} className="flex items-start gap-3 rounded-xl border border-[#eadfd2] p-3"><input type="checkbox" checked={selected.includes(invoice.id)} disabled={busy||!!invoice.blockedReason||!!results[invoice.id]} onChange={e=>setSelected(current=>e.target.checked?[...current,invoice.id]:current.filter(id=>id!==invoice.id))}/><span><strong>{invoice.clientName} — {money(invoice.totalCents)}</strong><span className="block">{invoice.payerName} · {invoice.recipient||'Courriel manquant'}</span><span className="block text-sm">Rencontres : {invoice.serviceDates.join(', ')}</span>{invoice.serviceDates.length>1&&<span className="block text-sm">Cette facture regroupe plusieurs journées ; le montant complet sera envoyé.</span>}{invoice.blockedReason&&<span className="block text-sm text-amber-800">{invoice.blockedReason}</span>}{results[invoice.id]&&<span role="status" className="block text-sm">{results[invoice.id]}</span>}</span></label>
 return <div className="space-y-3">
  <button type="button" className={buttonClass('primary')} disabled={busy||disabled} onClick={()=>void load()}>{busy?'Traitement…':invoiceId?'Envoyer la facture':'Envoyer les factures de la veille'}</button>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {preview&&<section aria-label="Vérifier les factures avant envoi" className="space-y-3 rounded-xl border border-[#eadfd2] p-4"><h4 className="font-semibold">Vérifier avant l’envoi</h4><p className="text-sm">Vérifiez les destinataires, les rencontres et le montant complet. Seules les factures cochées seront envoyées par courriel. Aucun paiement ne sera prélevé.</p>{!preview.enabled&&<p role="status" className="text-sm text-amber-800">Les envois de factures ne sont pas encore activés. Vous pouvez consulter cet aperçu sans envoyer de courriel.</p>}{preview.invoices.length?preview.invoices.map(row):<p>Aucune facture à envoyer.</p>}
  <button type="button" className={buttonClass('primary')} disabled={busy||!!error||!preview.enabled||!ready.length} onClick={()=>void send()}>Confirmer l’envoi de {ready.length} facture{ready.length>1?'s':''}</button>
  <button type="button" className={buttonClass('secondary')} disabled={busy} onClick={()=>setPreview(null)}>Fermer</button></section>}
 </div>
}
