'use client'
import {useEffect,useRef,useState,type ReactNode} from 'react'
import {buttonClass} from '@/components/Ui'
import {useClinicalFormGuard,useClinicalNavigation} from '@/components/clinical-workspace/NavigationGuard'
import {clinicalSessionHeaders} from '@/lib/clinical-unification/authClient'
import {ClinicalApiError} from '@/lib/clinical-workspace/api'
import type {ProfessionalCapacityRequest} from '@/lib/clinical-admission/types'
import {assignmentRequestComment} from '@/lib/assignmentRequestComment'
import {ActionForm,panelClass,text,type AdmissionUi} from './shared'
type Summary={linkedClients:number;serviceTaken:number;serviceNotTaken:number;pending:number}
type Intent={key:string;version:number;summary:Summary}
const comment=(r:ProfessionalCapacityRequest)=>r.offerSlots.length?assignmentRequestComment(r.comment).notes.join('\n'):r.comment
async function json<T>(id:string,init?:RequestInit):Promise<T>{if(!/^[a-f0-9-]{36}$/i.test(id))throw new ClinicalApiError('Identifiant de demande invalide.',400);const headers=new Headers(init?.headers);for(const [key,value]of Object.entries(await clinicalSessionHeaders()))headers.set(key,value);const r=await fetch('/api/direction/assignment-requests/'+id,{...init,headers,credentials:'same-origin',cache:'no-store',redirect:'error'});const value=await r.json().catch(()=>null);if(!r.ok)throw new ClinicalApiError(value?.error??'La demande ne peut pas être vérifiée.',r.status);return value as T}
export function AdministrativeCapacityPanel({ui,professionalId,requests,renderSummary}:{ui:AdmissionUi;professionalId:string;requests:ProfessionalCapacityRequest[];renderSummary:(r:ProfessionalCapacityRequest)=>ReactNode}){
 const [canDelete,setCanDelete]=useState(false),[deleting,setDeleting]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[deleted,setDeleted]=useState<string[]>([])
 const intents=useRef(new Map<string,Intent>()),pending=useRef(false),navigation=useClinicalNavigation()
 useClinicalFormGuard(false,deleting)
 const first=requests[0]?.id
 useEffect(()=>{setCanDelete(false);if(!first)return;let current=true;void json<{canDelete:boolean}>(first).then(v=>{if(current)setCanDelete(v.canDelete===true)}).catch(cause=>{if(current&&(!(cause instanceof ClinicalApiError)||cause.status!==403))setError('La vérification du droit de suppression a échoué. Actualisez la fiche pour réessayer.')});return()=>{current=false}},[first,ui.data.actorId])
 const remove=async(r:ProfessionalCapacityRequest)=>{
  if(pending.current||ui.busy||!canDelete||!await navigation.canLeave())return
  pending.current=true;setDeleting(true);setError('');setNotice('')
  try{
   let intent=intents.current.get(r.id)
   if(!intent){const v=await json<{version:number;summary:Summary}>(r.id);if(!Number.isSafeInteger(v.version)||v.version<1||!v.summary)throw Error('Actualisez la demande avant de continuer.');intent={key:crypto.randomUUID(),version:v.version,summary:v.summary}}
   if(!window.confirm(`Supprimer cette demande ?\n\n${intent.summary.linkedClients} assignation(s) liée(s), dont ${intent.summary.serviceTaken} service(s) pris et ${intent.summary.pending} en attente.\nLes assignations et les dossiers seront conservés. Ils ne seront plus rattachés à cette demande.`))return
   intents.current.set(r.id,intent)
   const result=await json<{success:boolean;id:string}>(r.id,{method:'DELETE',headers:{'Idempotency-Key':intent.key,'If-Match':String(intent.version)}})
   if(result.success!==true||result.id!==r.id)throw Error('La suppression n’est pas confirmée. Réessayez la même opération.')
   intents.current.delete(r.id);setDeleted(ids=>[...ids,r.id]);setNotice('Demande supprimée. Les assignations et dossiers sont conservés.')
   try{await ui.refresh?.()}catch{setError('La demande est supprimée, mais la liste n’a pas pu être actualisée.')}
  }catch(cause){if(cause instanceof ClinicalApiError){if(cause.status===409)intents.current.delete(r.id);if(cause.status===401||cause.status===403)setCanDelete(false)}ui.invalidate(cause);setError(cause instanceof Error?cause.message:'Suppression indisponible.')}
  finally{pending.current=false;setDeleting(false)}
 }
 return <section className={panelClass}><h2 className="mb-3 text-xl font-semibold">Demandes professionnelles</h2>
 {error&&<p role="alert" className="mb-3 text-red-700">{error}</p>}{notice&&<p role="status" className="mb-3">{notice}</p>}
 <fieldset disabled={ui.busy||deleting} className="grid min-w-0 gap-4">
 {[...requests].filter(r=>!deleted.includes(r.id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=><article key={r.id+':'+r.version} className="rounded-xl border border-[#eadfd2] p-4">{renderSummary(r)}
 <details className="mt-3"><summary className="cursor-pointer font-medium">Modifier la demande</summary><div className="mt-3"><ActionForm fields={[{name:'requestedCount',label:'Nombre de nouveaux clients souhaités',type:'number',min:0,max:500,required:true,initial:String(r.requestedCount)},{name:'comment',label:'Commentaire',type:'textarea',maxLength:300,initial:comment(r)},{name:'enabled',label:'Demande ouverte',type:'checkbox',initial:r.enabled}]} submitLabel="Sauvegarder la demande" onSubmit={async values=>{await ui.run('capacities.update',r.id,{expectedVersion:r.version,requestedCount:Number(values.requestedCount),comment:text(values.comment),enabled:values.enabled===true})}}/></div></details>
 <div className="mt-3 flex flex-wrap gap-2">{r.enabled&&<button type="button" className={buttonClass('secondary')} onClick={async()=>{if(await navigation.canLeave()&&window.confirm('Clore cette demande ? Les assignations et leur historique restent conservés.'))try{await ui.run('capacities.update',r.id,{expectedVersion:r.version,requestedCount:r.requestedCount,comment:comment(r),enabled:false})}catch(cause){setError(cause instanceof Error?cause.message:'Clôture impossible.')}}}>Clore la demande</button>}
 {canDelete&&<button type="button" className={buttonClass('secondary')} onClick={()=>void remove(r)}>Supprimer la demande</button>}</div></article>)}
 {!requests.filter(r=>!deleted.includes(r.id)).length&&<p>Aucune demande professionnelle.</p>}
 <details><summary className="cursor-pointer font-medium">Nouvelle demande</summary><div className="mt-3"><ActionForm fields={[{name:'requestedCount',label:'Nombre de nouveaux clients souhaités',type:'number',min:0,max:500,required:true,initial:'1'},{name:'comment',label:'Commentaire',type:'textarea',maxLength:300}]} submitLabel="Créer la demande" onSubmit={async v=>{await ui.run('capacities.create',null,{professionalId,requestedCount:Number(v.requestedCount),comment:text(v.comment)})}}/></div></details>
 </fieldset></section>
}
