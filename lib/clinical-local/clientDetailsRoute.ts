import { validImportedIntake } from '../clinical-migration/intake.ts'
import {createHash} from 'node:crypto'
import {ClinicalError,isClinicalError} from '@/lib/clinical-core/validation'
import {JsonBodyError,readBoundedJsonObject} from '@/lib/boundedJsonBody'
import {contextOf,localIdentity,localJson,localRpc,localResponseHeaders} from '@/lib/clinical-local/http'
import {shape,object,uuid} from '@/lib/clinical-mandates/validation'
import type {ClientOverview} from '@/lib/clinical-workspace/clientDetails'
const invalid=():never=>{throw new ClinicalError(400,'INVALID_INPUT','Vérifiez les renseignements du dossier et le document choisi.')}
const text=(x:unknown,max:number,required=false)=>typeof x==='string'&&x.length<=max&&(!required||Boolean(x.trim()))
const version=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>0
const email=(x:unknown)=>text(x,254)&&(x===''||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x)))
export function isClientOverview(value:unknown,id:string,context?:'administration'|'clinical'):value is {overview:ClientOverview}{
 if(!object(value)||!shape(value,['overview'])||!object(value.overview))return false
 const o=value.overview
 if(!shape(o,['clientId','profile','canEditProfile','canAddPerson','contacts','lifecycle','documents','communications','canUploadAdministrative','uploadClinicalRecordIds'],['importedIntake'])||o.clientId!==id||!object(o.profile)||!shape(o.profile,['firstName','lastName','birthDate','sex','address','email','phone','consultationReason','requestedService','assignedAt','version']))return false
 if(Object.hasOwn(o,'importedIntake')&&!validImportedIntake(o.importedIntake))return false
 const p=o.profile
 const booleans=(x:Record<string,unknown>,keys:string[])=>keys.every(k=>typeof x[k]==='boolean')
 const rows=(x:unknown,max:number,check:(row:Record<string,unknown>)=>boolean)=>Array.isArray(x)&&x.length<=max&&x.every(row=>object(row)&&check(row))
 if(!text(p.firstName,100,true)||!text(p.lastName,100,true)||!(p.birthDate===null||typeof p.birthDate==='string')||!version(p.version)||!text(p.sex,80)||!text(p.address,500)||!text(p.email,254)||!text(p.phone,40)||!text(p.consultationReason,1000)||!text(p.requestedService,200)||!(p.assignedAt===null||text(p.assignedAt,50,true))||!booleans(o,['canEditProfile','canAddPerson','canUploadAdministrative']))return false
 if(context==='clinical'&&o.canUploadAdministrative)return false
 if(!rows(o.contacts,500,x=>shape(x,['id','fullName','relationship','email','phone','address','version','canEdit','communicationAllowed','consentAllowed','documentsAllowed','authorityVerified','source','payerResponsibility','payerShareBasisPoints','reminder48h','reminder2h','reminderFirstHours','reminderSecondHours'])&&uuid(x.id)&&text(x.fullName,200,true)&&text(x.relationship,150)&&text(x.email,254)&&text(x.phone,40)&&text(x.address,500)&&version(x.version)&&booleans(x,['canEdit','communicationAllowed','consentAllowed','documentsAllowed','authorityVerified','reminder48h','reminder2h'])&&['contact','representative','mandate','payer'].includes(String(x.source))&&(x.payerResponsibility===null||text(x.payerResponsibility,160))&&(x.payerShareBasisPoints===null||Number.isInteger(x.payerShareBasisPoints)&&Number(x.payerShareBasisPoints)>=0&&Number(x.payerShareBasisPoints)<=10000)&&Number.isInteger(x.reminderFirstHours)&&Number(x.reminderFirstHours)>=1&&Number(x.reminderFirstHours)<=720&&Number.isInteger(x.reminderSecondHours)&&Number(x.reminderSecondHours)>=1&&Number(x.reminderSecondHours)<=720&&(context!=='clinical'||x.source!=='mandate')))return false
 if(!rows(o.lifecycle,500,x=>shape(x,['recordId','episodeId','label','status','version','canClose','canRequestReopen','canReopen','reopenRequested'])&&uuid(x.recordId)&&uuid(x.episodeId)&&text(x.label,160)&&['open','closed'].includes(String(x.status))&&version(x.version)&&booleans(x,['canClose','canRequestReopen','canReopen','reopenRequested'])))return false
 if(!rows(o.documents,10000,x=>shape(x,['id','label','fileName','mediaType','bytes','createdAt','audience','downloadHref','recordId','kind'])&&uuid(x.id)&&text(x.label,300,true)&&text(x.fileName,180,true)&&['application/pdf','image/png','image/jpeg'].includes(String(x.mediaType))&&(x.bytes===null||Number.isSafeInteger(x.bytes)&&Number(x.bytes)>0)&&text(x.createdAt,50,true)&&['administration','clinical'].includes(String(x.audience))&&(context===undefined||x.audience===context)&&typeof x.downloadHref==='string'&&x.downloadHref.length<1000&&/^\/api\/clinical-workspace\/(?:clients|mandates|billing)\/[a-zA-Z0-9\/-]+$/.test(x.downloadHref)&&(x.recordId===null||uuid(x.recordId))&&['uploaded','mandate','invoice','receipt','consent'].includes(String(x.kind))))return false
 if(!rows(o.communications,10000,x=>shape(x,['id','kind','label','at','status','simulation'],['recipientLabel','expiresAt'])&&text(x.id,200,true)&&text(x.kind,80,true)&&text(x.label,300,true)&&text(x.at,50,true)&&['prepared','simulated','expired','revoked','sent','delivered','failed'].includes(String(x.status))&&typeof x.simulation==='boolean'&&(!x.simulation||!['sent','delivered'].includes(String(x.status)))&&(!Object.hasOwn(x,'recipientLabel')||text(x.recipientLabel,200))&&(!Object.hasOwn(x,'expiresAt')||text(x.expiresAt,50))))return false
 return Array.isArray(o.uploadClinicalRecordIds)&&o.uploadClinicalRecordIds.every(uuid)
}
export function validClientProfile(d:unknown):boolean{
 if(!object(d)||!shape(d,['expectedVersion','firstName','lastName','birthDate','sex','address','email','phone','consultationReason']))return false
 return version(d.expectedVersion)&&text(d.firstName,100,true)&&text(d.lastName,100,true)&&(d.birthDate===null||typeof d.birthDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.birthDate)&&!Number.isNaN(Date.parse(d.birthDate+'T12:00Z'))&&new Date(d.birthDate+'T12:00Z').toISOString().slice(0,10)===d.birthDate)&&['','Homme','Femme','Autre'].includes(String(d.sex))&&text(d.address,500)&&email(d.email)&&text(d.phone,40)&&text(d.consultationReason,1000)
}
export function validClientPerson(d:unknown,update:boolean):boolean{
 if(!object(d)||!shape(d,['source','fullName','relationship','email','phone','address','payerResponsible','payerShareBasisPoints','reminder48h','reminder2h','reminderFirstHours','reminderSecondHours','communicationAllowed','consentAllowed','documentsAllowed','authorityVerified',...(update?['expectedVersion']:[])],['allocations']))return false
 if(d.allocations!==undefined&&(!Array.isArray(d.allocations)||d.allocations.length>100||new Set(d.allocations.map((x:unknown)=>object(x)?x.personId:null)).size!==d.allocations.length||!d.allocations.every((x:unknown)=>object(x)&&shape(x,['personId','basisPoints'],['expectedVersion'])&&uuid(x.personId)&&Number.isSafeInteger(x.basisPoints)&&Number(x.basisPoints)>=0&&Number(x.basisPoints)<=10000&&(x.expectedVersion===undefined||version(x.expectedVersion)))))return false
 return (!update||version(d.expectedVersion))&&['contact','representative'].includes(String(d.source))&&text(d.fullName,200,true)&&text(d.relationship,100,d.source==='representative')&&email(d.email)&&text(d.phone,40)&&text(d.address,500)&&['payerResponsible','reminder48h','reminder2h','communicationAllowed','consentAllowed','documentsAllowed','authorityVerified'].every(k=>typeof d[k]==='boolean')&&Number.isInteger(d.payerShareBasisPoints)&&Number(d.payerShareBasisPoints)>=0&&Number(d.payerShareBasisPoints)<=10000&&(!d.payerResponsible?d.payerShareBasisPoints===0:Number(d.payerShareBasisPoints)>0)&&Number.isInteger(d.reminderFirstHours)&&Number(d.reminderFirstHours)>=1&&Number(d.reminderFirstHours)<=720&&Number.isInteger(d.reminderSecondHours)&&Number(d.reminderSecondHours)>=1&&Number(d.reminderSecondHours)<=720&&(!d.reminder48h&&!d.reminder2h||d.communicationAllowed===true)
}
export function clientDocumentBytes(d:unknown):Buffer{
 if(!object(d))return invalid()
 if(!object(d)||!shape(d,['label','fileName','mediaType','dataBase64','audience'],['recordId'])||!text(d.label,160,true)||!text(d.fileName,180,true)||/[\x00-\x1f\x7f\\/]/.test(String(d.fileName))||!['administration','clinical'].includes(String(d.audience))||!(d.recordId==null||uuid(d.recordId))||typeof d.dataBase64!=='string'||d.dataBase64.length>1398104)invalid()
 const bytes=Buffer.from(d.dataBase64 as string,'base64')
 if(!bytes.length||bytes.length>1048576||bytes.toString('base64')!==d.dataBase64)invalid()
 const mt=d.mediaType
 if(mt==='application/pdf'?bytes.subarray(0,5).toString('ascii')!=='%PDF-':mt==='image/png'?bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a':mt==='image/jpeg'?bytes.subarray(0,3).toString('hex')!=='ffd8ff':true)invalid()
 return bytes
}
export function clientDocumentResponse(value:unknown,id:string):Response{
 if(!object(value)||!shape(value,['id','fileName','mediaType','bytesBase64','byteLength','sha256'])||value.id!==id||!text(value.fileName,180,true)||typeof value.bytesBase64!=='string'||typeof value.sha256!=='string')throw new ClinicalError(502,'INVALID_RESPONSE','Le document n’a pas pu être vérifié.')
 const bytes=clientDocumentBytes({label:'Document',fileName:value.fileName,mediaType:value.mediaType,dataBase64:value.bytesBase64,audience:'administration'})
 if(bytes.length!==value.byteLength||createHash('sha256').update(bytes).digest('hex')!==value.sha256)throw new ClinicalError(503,'DOCUMENT_INTEGRITY_FAILED','L’empreinte du document ne correspond pas à son archive.')
 return new Response(Uint8Array.from(bytes),{headers:{...localResponseHeaders,'Content-Type':String(value.mediaType),'Content-Length':String(bytes.length),'Content-Disposition':`attachment; filename="document-${id}"; filename*=UTF-8''${encodeURIComponent(String(value.fileName)).replace(/'/g,'%27')}`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'X-Document-SHA256':value.sha256}})
}
export function isClientDetailsRoute(segments:string[]):boolean{
 return segments[0]==='clients'&&uuid(segments[1])&&['overview','profile','people','documents'].includes(segments[2])||segments[0]==='records'&&uuid(segments[1])&&['close','reopen-request','reopen'].includes(segments[2])
}
export async function handleClientDetails(request:Request,segments:string[]):Promise<Response>{
 try{
  const {runtime,token}=await localIdentity(request)
  const [area,id,action,target,nativeContext,download]=segments
  const nativeDocument=request.method==='GET'&&!new URL(request.url).search&&area==='clients'&&uuid(id)&&action==='documents'&&download==='download'&&uuid(target)&&['administration','clinical'].includes(nativeContext)&&segments.length===6
  const context=nativeDocument?nativeContext as 'administration'|'clinical':contextOf(request)
  if(nativeDocument){
   if(request.headers.has('X-Clinical-Context')&&request.headers.get('X-Clinical-Context')!==context)throw new ClinicalError(403,'FORBIDDEN','Ce document appartient à un autre espace.')
   const value=await localRpc(runtime,token,'lab_client_document',{p_context:context,p_patient_id:id,p_document_id:target});return clientDocumentResponse(value,target)
  }
  if(request.method==='GET'&&area==='clients'&&action==='overview'&&segments.length===3){const value=await localRpc(runtime,token,'lab_client_overview',{p_context:context,p_patient_id:id});if(!isClientOverview(value,id,context))throw new ClinicalError(502,'INVALID_RESPONSE','La fiche reçue ne correspond pas au dossier demandé.');return localJson(value)}
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))invalid()
  const d=await readBoundedJsonObject(request,action==='documents'?1450000:area==='records'&&action==='close'?98304:16384)
  const key=request.headers.get('Idempotency-Key');if(!uuid(key))invalid()
  let command:string;let patientId=id;let targetId:string|null=null
  if(area==='clients'&&action==='profile'&&request.method==='PATCH'&&segments.length===3){if(!validClientProfile(d))invalid();command='profile.update'}
  else if(area==='clients'&&action==='people'&&['POST','PATCH'].includes(request.method)&&segments.length===(request.method==='POST'?3:4)){if(!validClientPerson(d,request.method==='PATCH')||request.method==='PATCH'&&!uuid(target))invalid();command=request.method==='POST'?'person.create':'person.update';targetId=target??null}
  else if(area==='clients'&&action==='people'&&request.method==='DELETE'&&segments.length===4){if(!uuid(target)||!object(d)||!shape(d,['expectedVersion'])||!version(d.expectedVersion))invalid();command='person.remove';targetId=target}
  else if(area==='clients'&&action==='documents'&&request.method==='POST'&&segments.length===3){clientDocumentBytes(d);command='document.create'}
  else if(area==='records'&&['close','reopen-request','reopen'].includes(action)&&request.method==='POST'&&segments.length===3){
   const professionalClose=action==='close'&&context==='clinical'
   const validClosure=professionalClose&&object(d)&&version(d.expectedVersion)&&(
    d.closureMode==='no_encounter'&&shape(d,['expectedVersion','closureMode','reason'])&&text(d.reason,1000,true)||
    d.closureMode==='note'&&shape(d,['expectedVersion','closureMode','noteText','attested'])&&text(d.noteText,24000,true)&&d.attested===true)
   if(!validClosure&&(!object(d)||professionalClose||!shape(d,['expectedVersion','reason'])||!version(d.expectedVersion)||!text(d.reason,1000,true)))invalid()
   const w=await localRpc<{workspace:{records:{id:string;clientId:string}[];managedRecords:{id:string;clientId:string}[]}}>(runtime,token,'lab_query',{p_context:context,p_action:'workspace',p_id:null})
   const record=[...w.workspace.records,...w.workspace.managedRecords].find(x=>x.id===id);if(!record)throw new ClinicalError(403,'FORBIDDEN','Ce dossier n’est pas autorisé.')
   patientId=record.clientId;targetId=id;command='record.'+action
  }else return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
  const ack=await localRpc<unknown>(runtime,token,'lab_client_command',{p_context:context,p_action:command,p_patient_id:patientId,p_target_id:targetId,p_data:d,p_key:key})
  if(!object(ack)||!shape(ack,['ok','action','id','clientId','version'])||ack.ok!==true||ack.action!==command||ack.clientId!==patientId||!uuid(ack.id))throw new ClinicalError(502,'INVALID_RESPONSE','L’écriture n’a pas pu être confirmée. Conservez votre saisie et réessayez la même opération.')
  return localJson(ack,request.method==='POST'?201:200)
 }catch(cause){if(cause instanceof JsonBodyError)return localJson({error:'Le fichier ou le formulaire dépasse la taille permise.',code:'INVALID_BODY'},cause.status);if(isClinicalError(cause))return localJson({error:cause.message,code:cause.code},cause.status);return localJson({error:'Le dossier local est temporairement indisponible.',code:'LOCAL_UNAVAILABLE'},503)}
}
