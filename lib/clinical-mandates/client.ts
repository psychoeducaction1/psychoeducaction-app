import type { ClinicalActorInput,ClinicalAccessContext } from '../clinical-core/types'
import type { MandateCommand,MandateAck,MandateWorkspace,MandatePortalView,SignatureEvidence } from './types'
import { ClinicalApiError,clinicalRequest,clinicalContextFromPath } from '@/lib/clinical-workspace/api'
import { isMandateCommand,isInvitationToken,isSignatureEvidence,uuid,hash } from '@/lib/clinical-mandates/validation'
import { isMandateAck,isMandateWorkspace,isMandatePortalView } from '@/lib/clinical-mandates/transport'
import {isConsentDeliveryWorkspace,isConsentDeliveryCommand} from '@/lib/clinical-mandates/deliveryTransport'
import type {ConsentDeliveryWorkspace,ConsentDeliveryCommand} from './deliveryTypes'
const contextOf=(actor:ClinicalActorInput):ClinicalAccessContext=>typeof actor==='string'?clinicalContextFromPath(typeof window==='undefined'?'/clinique':window.location.pathname):actor.context
const actorId=(actor:ClinicalActorInput)=>typeof actor==='string'?actor:actor.actorId
const invalid=()=>new ClinicalApiError('La demande de mandat est invalide.',400,'INVALID_INPUT')
export async function loadMandates(actor:ClinicalActorInput,filters:{clientId?:string;mandateId?:string}={},signal?:AbortSignal):Promise<MandateWorkspace>{
 if(Object.keys(filters).some(k=>!['clientId','mandateId'].includes(k))||filters.clientId&&filters.mandateId||Object.values(filters).some(v=>!uuid(v)))throw invalid()
 const path='/mandates'+(filters.mandateId?'/'+filters.mandateId:filters.clientId?'/client/'+filters.clientId:'')
 return clinicalRequest<MandateWorkspace>(actor,path,undefined,'GET',signal,undefined,value=>isMandateWorkspace(value,contextOf(actor),actorId(actor)))
}
export async function loadClientMandate(actor:ClinicalActorInput,clientId:string,mandateId:string,signal?:AbortSignal):Promise<MandateWorkspace>{
 if(!uuid(clientId)||!uuid(mandateId))throw invalid()
 return clinicalRequest<MandateWorkspace>(actor,'/mandates/client/'+clientId+'/'+mandateId,undefined,'GET',signal,undefined,value=>isMandateWorkspace(value,contextOf(actor),actorId(actor))&&value.selected?.mandate.clientId===clientId&&value.selected.mandate.id===mandateId&&value.mandates.every(m=>m.clientId===clientId))
}
export async function runMandateCommand(actor:ClinicalActorInput,command:MandateCommand):Promise<MandateAck>{
 if(!isMandateCommand(command))throw invalid()
 return clinicalRequest<MandateAck>(actor,'/mandates/commands',command as unknown as Record<string,unknown>,'POST',undefined,undefined,value=>isMandateAck(value,command.action))
}
export async function loadConsentDelivery(actor:ClinicalActorInput,clientId?:string,signal?:AbortSignal):Promise<ConsentDeliveryWorkspace>{
 if(clientId!==undefined&&!uuid(clientId))throw invalid()
 return clinicalRequest<ConsentDeliveryWorkspace>(actor,'/mandates/delivery'+(clientId?'/client/'+clientId:''),undefined,'GET',signal,undefined,value=>isConsentDeliveryWorkspace(value,contextOf(actor),actorId(actor),clientId))
}
export async function runConsentDeliveryCommand(actor:ClinicalActorInput,command:ConsentDeliveryCommand):Promise<MandateAck>{
 if(!isConsentDeliveryCommand(command))throw invalid()
 return clinicalRequest<MandateAck>(actor,'/mandates/delivery/commands',command as unknown as Record<string,unknown>,'POST',undefined,undefined,value=>isMandateAck(value,command.action))
}
export function authenticatedDocumentUrl(documentId:string,context:ClinicalAccessContext):string {
 if(!uuid(documentId)||!['administration','clinical'].includes(context))throw invalid()
 return '/api/clinical-workspace/mandates/documents/'+documentId+'/'+context
}
export function mandatePreviewUrl(revisionId:string,context:ClinicalAccessContext):string {
 if(!uuid(revisionId)||!['administration','clinical'].includes(context))throw invalid()
 return '/api/clinical-workspace/mandates/preview/'+revisionId+'/'+context
}
export const portalDownloadAction='/api/clinical-workspace/mandates/portal/download'
export function authenticatedDownloadUrl(documentId:string,context:ClinicalAccessContext):string {return authenticatedDocumentUrl(documentId,context)+'/download'}
export function generateInvitationToken():string {const bytes=globalThis.crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
const pending=new Map<string,string>()
async function publicRequest(token:string,action:'view'|'pdf'|'sign',data?:Record<string,unknown>):Promise<Response>{
 if(!isInvitationToken(token))throw invalid()
 const response=await fetch('/api/clinical-workspace/mandates/portal',{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token,...(data?{data}:{})})})
 if(!response.ok){const payload=await response.json().catch(()=>null);throw new ClinicalApiError(payload?.error??'Cette invitation n’est pas disponible.',response.status,payload?.code)}
 return response
}
export async function portalLoad(token:string):Promise<MandatePortalView>{const value:unknown=await(await publicRequest(token,'view')).json();if(!isMandatePortalView(value))throw new ClinicalApiError('Réponse inattendue.',502,'INVALID_RESPONSE');return value}
export async function portalPdf(token:string):Promise<Blob>{const response=await publicRequest(token,'pdf');if(response.headers.get('Content-Type')!=='application/pdf')throw new ClinicalApiError('Document inattendu.',502,'INVALID_RESPONSE');const bytes=await response.arrayBuffer(),expected=response.headers.get('X-Document-SHA256');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(!hash(expected)||digest!==expected)throw new ClinicalApiError('Document non vérifié.',502,'DOCUMENT_INTEGRITY_FAILED');return new Blob([bytes],{type:'application/pdf'})}
export async function portalSign(token:string,data:{documentId:string;documentHash:string;evidence:SignatureEvidence},requestKey?:string):Promise<MandateAck>{
 if(!isInvitationToken(token)||!uuid(data.documentId)||!hash(data.documentHash)||!isSignatureEvidence(data.evidence)||requestKey!==undefined&&!uuid(requestKey))throw invalid()
 const intentHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([token,data])))),b=>b.toString(16).padStart(2,'0')).join('')
 if(!pending.has(intentHash)&&pending.size>=100)throw new ClinicalApiError('Trop d’opérations en attente. Conservez votre saisie.',503,'PENDING_LIMIT')
 const key=requestKey??pending.get(intentHash)??crypto.randomUUID();pending.set(intentHash,key)
 const value:unknown=await(await publicRequest(token,'sign',{...data,key})).json()
 if(!isMandateAck(value,'portal.sign'))throw new ClinicalApiError('La signature n’a pas pu être confirmée.',502,'INVALID_RESPONSE')
 pending.delete(intentHash);return value
}
