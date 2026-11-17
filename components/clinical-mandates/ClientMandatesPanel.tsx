'use client'
import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {useSearchParams} from 'next/navigation'
import {buttonClass} from '@/components/Ui'
import {useClinicalNavigation,useClinicalFormGuard} from '@/components/clinical-workspace/NavigationGuard'
import type {WorkspaceView} from '@/lib/clinical-core/types'
import type {ClientOverview} from '@/lib/clinical-workspace/clientDetails'
import type {WorkspaceSection} from '@/lib/clinical-workspace/navigation'
import type {MandateCommand,MandateWorkspace} from '@/lib/clinical-mandates/types'
import {authenticatedDownloadUrl,loadClientMandate,loadMandates,runMandateCommand} from '@/lib/clinical-mandates/client'
import {clinicalRequest,isClinicalAccessDenied} from '@/lib/clinical-workspace/api'
import {isImportedServices,type ImportedServices} from '@/lib/clinical-mandates/importService'
import {ImportedServiceEditor} from './ImportedServiceEditor'
import {isUnifiedClinicalClient} from '@/lib/clinical-unification/authClient'
import {MandateDetail} from './MandateDetail'
import {useConsentDelivery} from './ConsentDeliveryPanel'
import {MandateEditor} from './MandateEditor'
import {Field,inputClass,type MandateUi} from './primitives'
import {timeLabel} from './model'

export type ClientMandatesPanelProps={workspace:WorkspaceView;clientId:string;requesterFile?:ClientOverview;mode?:'consent'|'documents'|'communications';onNavigate:(section:WorkspaceSection,query?:Record<string,string|null>)=>Promise<void>;onUpdated:()=>Promise<void>;onEditRequesters?:()=>void;onEditProfile?:()=>void}
export function ClientMandatesPanel({workspace,clientId,requesterFile,mode='consent',onNavigate,onUpdated,onEditRequesters,onEditProfile}:ClientMandatesPanelProps){
 const params=useSearchParams()
 const actor=useMemo(()=>({actorId:workspace.actor.id,context:workspace.context}),[workspace.actor.id,workspace.context])
 const [loadedData,setData]=useState<MandateWorkspace|null>(null),[selection,setSelection]=useState(params.get('mandate')??''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[stale,setStale]=useState(false)
 const [creating,setCreating]=useState(false)
 const [pendingImports,setPendingImports]=useState<ImportedServices|null>(null)
 const data=loadedData?.actor.id===workspace.actor.id&&loadedData.context===workspace.context&&loadedData.clients.every(c=>c.id===clientId)&&loadedData.mandates.every(m=>m.clientId===clientId)?loadedData:null
 const sequence=useRef(0),writing=useRef(false),navigation=useClinicalNavigation(),guard=useClinicalFormGuard(false,busy)
 const delivery=useConsentDelivery(workspace,clientId)
 const load=useCallback(async(signal?:AbortSignal)=>{const request=++sequence.current
  try{
   const pending=isUnifiedClinicalClient()?await clinicalRequest<ImportedServices>(actor,`/clients/${clientId}/import-service`,undefined,'GET',signal,undefined,value=>isImportedServices(value,clientId)):{clientId,cases:[]}
   if(signal?.aborted||request!==sequence.current)return false
   setPendingImports(pending)
   if(pending.cases.length){setData(null);setStale(false);setError('');return true}
   const list=await loadMandates(actor,{clientId},signal);const chosen=list.mandates.find(m=>m.id===selection)??list.mandates.at(-1)
   const next=chosen?await loadClientMandate(actor,clientId,chosen.id,signal):list
   if(signal?.aborted||request!==sequence.current)return false
   setData(next);setStale(false);setError('');return true
  }catch(cause){if(!signal?.aborted&&request===sequence.current){setData(null);setPendingImports(null);setStale(true);setError(cause instanceof Error?cause.message:'Le mandat n’est pas disponible.');if(isClinicalAccessDenied(cause))void onUpdated()}return false}
 },[actor,clientId,selection,onUpdated])
 useEffect(()=>{setData(null);setPendingImports(null);if(mode!=='consent'||!workspace.durable)return;const controller=new AbortController();void load(controller.signal);return()=>controller.abort()},[load,mode,workspace.durable])
 const command=async(input:MandateCommand)=>{
  if(writing.current||stale)throw new Error('Actualisez la fiche avant de continuer.')
  writing.current=true;guard.markPending();setBusy(true)
  try{const ack=await runMandateCommand(actor,input);await Promise.all([load(),delivery.load()]);return ack}
  finally{writing.current=false;guard.markSettled();setBusy(false)}
 }
 const select=async(patch:Record<string,string|null>)=>{if(patch.mandate){setSelection(patch.mandate);return}await onNavigate('clients',{client:clientId,...patch})}
 const ui:MandateUi|null=data?{data,busy:busy||stale,command,select,invalidate:cause=>{if(isClinicalAccessDenied(cause)){setData(null);void onUpdated()}}}:null
 if(!workspace.durable)return <p className="text-sm">Les consentements nécessitent le laboratoire persistant.</p>
 if(mode==='communications')return <div className="grid gap-3"><p className="text-xs text-[#8a6f5d]">Historique des consentements associés à cette identité. Les préparations ci-dessous n’ont pas été envoyées.</p>{delivery.error&&<p role="alert" className="text-sm text-red-800">{delivery.error}</p>}{delivery.data?.communications.map(c=><article key={c.id} className="rounded-xl border border-[#eadfd2] p-3 text-sm"><p className="font-semibold">{c.label}</p><p className="mt-1">{c.recipientLabel} · {timeLabel(c.at)}</p><p className="mt-1 text-xs">{c.status==='expired'?'Invitation expirée':c.status==='revoked'?'Invitation révoquée':'Préparation simulée — aucun envoi'}</p></article>)}{delivery.data&&!delivery.data.communications.length&&<p className="text-sm">Aucune communication de consentement enregistrée.</p>}</div>
 if(mode==='documents')return <div className="grid gap-3">{delivery.error&&<p role="alert" className="text-sm text-red-800">{delivery.error}</p>}{delivery.data?.documents.map(d=><article key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eadfd2] p-3 text-sm"><div><p className="font-semibold">{d.serviceLabel} · version {d.revisionNumber}</p><p className="mt-1 text-xs">{d.kind==='proof'?'Preuve de signature':'Convention'} · {d.audience==='clinical'?'Consentement clinique':'Document administratif'}</p></div><a className={buttonClass('secondary')} href={authenticatedDownloadUrl(d.id,workspace.context)} target="_blank" rel="noopener noreferrer">Télécharger le PDF</a></article>)}{delivery.data&&!delivery.data.documents.length&&<p className="text-sm">Aucun document de consentement accessible.</p>}</div>
 return <div className="grid min-w-0 gap-4">{error&&<p role="alert" className="text-sm text-red-800">{error}<button className={buttonClass('ghost')} onClick={()=>void load()}>Réessayer</button></p>}
 {pendingImports?.clientId===clientId&&pendingImports.cases.map(item=><ImportedServiceEditor key={item.caseId+':'+item.version} item={item} clientId={clientId} actor={actor} onSaved={async()=>{await load();await onUpdated()}} onEditProfile={onEditProfile} onEditRequesters={onEditRequesters} onDenied={()=>{setPendingImports(null);setData(null);void onUpdated()}}/>)}
 {data&&data.mandates.length>1&&<Field label="Service et convention"><select className={inputClass} value={data.selected?.mandate.id??''} disabled={busy} onChange={e=>{const id=e.target.value;void navigation.canLeave().then(yes=>{if(yes)setSelection(id)})}}>{data.mandates.map((m,index)=><option key={m.id} value={m.id}>Mandat {index+1} · {m.serviceLabel}</option>)}</select></Field>}
 {workspace.context==='administration'&&data&&<button type="button" className={buttonClass('secondary')+' justify-self-start'} disabled={busy} onClick={()=>setCreating(true)}>Ajouter un mandat</button>}
 {creating&&data&&<div className="rounded-xl border border-[#eadfd2] bg-[#fffaf3] p-4"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">Nouveau mandat pour ce client</h3><button type="button" className={buttonClass('ghost')} onClick={()=>void navigation.canLeave().then(ok=>{if(ok)setCreating(false)})}>Fermer</button></div><MandateEditor key={'new:'+clientId} ui={ui!} coreClients={workspace.clients} requesterFile={requesterFile} clientId={clientId} episodeId={data.episodes.find(e=>e.clientId===clientId&&e.status==='open')?.id} embedded onSaved={()=>setCreating(false)}/></div>}
 {data?.selected?<MandateDetail key={data.selected.mandate.id} ui={ui!} coreClients={workspace.clients} requesterFile={requesterFile} onEditRequesters={onEditRequesters} delivery={delivery} compact/>:data?<p className="text-sm">Aucun mandat établi pour ce client.</p>:!error&&!pendingImports?.cases.length&&<p className="text-sm">Chargement du mandat…</p>}
 </div>
}
