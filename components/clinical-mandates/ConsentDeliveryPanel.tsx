'use client'
import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {buttonClass} from '@/components/Ui'
import {useClinicalFormGuard} from '@/components/clinical-workspace/NavigationGuard'
import type {WorkspaceView} from '@/lib/clinical-core/types'
import type {WorkspaceSection} from '@/lib/clinical-workspace/navigation'
import type {ConsentDeliveryCommand,ConsentDeliveryTarget,ConsentDeliveryWorkspace} from '@/lib/clinical-mandates/deliveryTypes'
import {loadConsentDelivery,runConsentDeliveryCommand,runMandateCommand} from '@/lib/clinical-mandates/client'
import {createLocalInvitationIntent,type LocalInvitationIntent} from '@/lib/clinical-mandates/localInvitation'
import {ClinicalApiError} from '@/lib/clinical-workspace/api'
import {Field,inputClass,MandateForm,read} from './primitives'
import {timeLabel} from './model'

export function useConsentDelivery(workspace:WorkspaceView,clientId?:string,enabled=true){
 const actor=useMemo(()=>({actorId:workspace.actor.id,context:workspace.context}),[workspace.actor.id,workspace.context])
 const [data,setData]=useState<ConsentDeliveryWorkspace|null>(null),[loadedScope,setLoadedScope]=useState(''),[busy,setBusy]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const scope=actor.actorId+':'+actor.context+':'+(clientId??'')+':'+(workspace.actor.capabilities??[]).join(',')
 const sequence=useRef(0),writing=useRef(false),guard=useClinicalFormGuard(false,busy)
 const load=useCallback(async(signal?:AbortSignal)=>{const seq=++sequence.current
  try{const next=await loadConsentDelivery(actor,clientId,signal);if(signal?.aborted||sequence.current!==seq)return false;setData(next);setLoadedScope(scope);setStale(false);setError('');return true}
  catch(cause){if(!signal?.aborted&&sequence.current===seq){setData(null);setStale(true);setError(cause instanceof Error?cause.message:'Consentements indisponibles.')}return false}
 },[actor,clientId,scope])
 useEffect(()=>{setData(null);setMessage('');if(!workspace.durable||!enabled)return;const controller=new AbortController();void load(controller.signal);return()=>controller.abort()},[load,workspace.durable,enabled])
 const command=async(input:ConsentDeliveryCommand|LocalInvitationIntent['command'])=>{
  if(writing.current||stale)throw new Error('Actualisez les consentements avant de continuer.')
  if(input.action==='invitation.create'&&(data?.mode!=='isolated_unified'||window.location.origin!=='http://127.0.0.1:3110'))throw new Error('Cette invitation est réservée au pilote local.')
  writing.current=true;guard.markPending();setBusy(true);setMessage('');setError('')
  try{const ack=await(input.action==='invitation.create'?runMandateCommand(actor,input):runConsentDeliveryCommand(actor,input));const refreshed=await load();setMessage(refreshed?'Préparation confirmée — aucun courriel envoyé.':'Préparation confirmée. Actualisez avant une autre action.');return ack}
  catch(cause){setError(cause instanceof Error?cause.message:'Préparation non confirmée.');throw cause}
  finally{writing.current=false;guard.markSettled();setBusy(false)}
 }
 return {data:loadedScope===scope?data:null,busy:busy||stale,error,message,load,command}
}
type DeliveryUi=ReturnType<typeof useConsentDelivery>
function TargetActions({target,ui,email}:{target:ConsentDeliveryTarget;ui:DeliveryUi;email?:string}){
 const intent=useRef<LocalInvitationIntent|null>(null),[localLink,setLocalLink]=useState<{href:string;invitationId:string}|null>(null),[uncertain,setUncertain]=useState(false),[linkError,setLinkError]=useState('')
 const base={mandateId:target.mandateId,revisionId:target.revisionId,expectedVersion:target.expectedVersion}
 const available=target.invitationId&&!target.revokedAt&&!target.consumedAt
 const execute=(command:ConsentDeliveryCommand)=>{void ui.command(command).catch(()=>{})}
 const prepare=async()=>{
  if(ui.data?.mode!=='isolated_unified'){
   execute(available?{action:'invitation.renew_demo',data:{...base,invitationId:target.invitationId!,expiresInSeconds:ui.data!.preferences.expiresInSeconds}}:{action:'invitation.prepare_demo',data:{...base,signerId:target.signerId,expiresInSeconds:ui.data!.preferences.expiresInSeconds}})
   return
  }
  setLinkError('')
  try{
   if(!intent.current)intent.current=createLocalInvitationIntent(target,ui.data.preferences.expiresInSeconds,window.location.origin)
   const current=intent.current
   setUncertain(true)
   const ack=await ui.command(current.command)
   setLocalLink({href:current.href,invitationId:ack.id});intent.current=null;setUncertain(false)
  }catch(cause){
   if(cause instanceof ClinicalApiError&&cause.status>=400&&cause.status<500&&![408,429].includes(cause.status)){intent.current=null;setUncertain(false)}
   setLinkError(cause instanceof Error?cause.message:'Le lien n’a pas pu être préparé.')
  }
 }
 return <article className="rounded-xl border border-[#eadfd2] p-3"><p className="text-sm font-semibold">{target.signerName}</p>{email && <p className="mt-1 text-xs">Courriel : {email}</p>}<p className="mt-1 text-xs text-[#8a6f5d]">{target.audience==='clinical'?'Consentement clinique':'Convention administrative'} · {target.expired?'Invitation expirée':available?'Disponible jusqu’au '+timeLabel(target.expiresAt!):'Invitation à préparer'}</p><div className="mt-3 flex flex-wrap gap-2">
  <button type="button" className={buttonClass('secondary')} disabled={ui.busy} onClick={()=>void prepare()}>{uncertain?'Reprendre la même invitation':available?'Renouveler l’invitation':'Envoyer la signature à distance'} · simulation</button>
  {available&&<button type="button" className={buttonClass('ghost')} disabled={ui.busy} onClick={()=>{if(window.confirm('Révoquer cette invitation simulée ?'))execute({action:'invitation.revoke_demo',data:{...base,invitationId:target.invitationId!}})}}>Révoquer</button>}
 </div>{linkError&&<p role="alert" className="mt-2 text-sm text-red-800">{linkError}</p>}{uncertain&&<p className="mt-2 text-xs">La reprise conserve la même invitation pour éviter un doublon.</p>}{localLink&&available&&target.invitationId===localLink.invitationId&&<div className="mt-3 grid justify-items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3"><a className={buttonClass('secondary')} href={localLink.href} target="_blank" rel="noopener noreferrer">Ouvrir le portail de signature</a><p className="text-xs">Lien local temporaire pour cet essai. Aucun courriel envoyé. Il disparaît en fermant cette fenêtre; une nouvelle invitation remplace le lien précédent.</p></div>}</article>
}
export function ConsentDeliveryPanel({ui,revisionId,recipientEmails}:{ui:DeliveryUi;revisionId?:string;recipientEmails?:Record<string,string>}){
 if(!ui.data)return ui.error?<p role="alert" className="text-sm text-red-800">{ui.error}<button className={buttonClass('ghost')} onClick={()=>void ui.load()}>Réessayer</button></p>:<p className="text-sm">Chargement des invitations…</p>
 return <div className="grid gap-3"><p className="text-xs text-[#8a6f5d]">Simulation locale : aucun courriel envoyé.</p>
 {ui.error&&<p role="alert" className="text-sm text-red-800">{ui.error}</p>}{ui.message&&<p role="status" className="text-sm text-green-800">{ui.message}</p>}
 {ui.data.targets.filter(target=>!revisionId||target.revisionId===revisionId).length?ui.data.targets.filter(target=>!revisionId||target.revisionId===revisionId).map(t=><TargetActions key={t.revisionId+':'+t.signerId} target={t} ui={ui} email={recipientEmails?.[t.signerId]}/>):<p className="text-sm">Aucune invitation en attente pour ce mandat.</p>}
 <section className="rounded-xl border border-[#eadfd2] p-3"><h4 className="mb-2 font-semibold">Délai de signature à distance</h4><MandateForm key={ui.data.preferences.version} disabled={ui.busy} submitLabel="Enregistrer le délai" onSave={async form=>{await ui.command({action:'invitation.settings',data:{expectedVersion:ui.data!.preferences.version,expiresInSeconds:Number(read(form,'days'))*86400}})}}><Field label="Expiration en jours"><input className={inputClass} name="days" type="number" min="1" max="30" step="1" required defaultValue={Math.max(1,Math.round(ui.data.preferences.expiresInSeconds/86400))}/></Field><p className="text-xs">Ce délai s’applique aux prochaines invitations. Les invitations existantes gardent leur expiration.</p></MandateForm></section></div>
}
export function ConsentReminders({workspace,onNavigate}:{workspace:WorkspaceView;onNavigate:(section:WorkspaceSection,query?:Record<string,string|null>)=>Promise<void>}){
 const ui=useConsentDelivery(workspace,undefined,workspace.context==='clinical')
 if(!workspace.durable||workspace.context!=='clinical')return null
 if(ui.error)return <aside className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">Les rappels de consentement n’ont pas pu être vérifiés.<button className={buttonClass('ghost')} onClick={()=>void ui.load()}>Réessayer</button></aside>
 if(!ui.data?.reminders.length)return null
 return <aside className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold">Consentements à relancer · {ui.data.reminders.length}</h2><p className="text-sm">Ces invitations ont expiré sans signature. Renouvelez-les depuis la fiche du client.</p>{ui.data.reminders.map(t=><div key={t.revisionId+':'+t.signerId} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{t.clientName} · {t.serviceLabel} · {t.signerName}</span><button type="button" className={buttonClass('secondary')} onClick={()=>void onNavigate('clients',{client:t.clientId})}>Ouvrir la fiche</button></div>)}</aside>
}
