import { createHash } from 'node:crypto'
import { readBoundedJsonObject,JsonBodyError } from '@/lib/boundedJsonBody'
import { canAdmin,canPractice,canSupervise,resolveActor } from '@/lib/clinical-core/capabilities'
import { ClinicalError,isClinicalError } from '@/lib/clinical-core/validation'
import { isDurableClinicalRuntime,readDurableClinicalRuntime,isStagingClinicalRuntime } from '@/lib/clinical-local/runtime'
import { checkLocalOrigin,contextOf,localIdentity,localJson,localResponseHeaders,localRpc } from '@/lib/clinical-local/http'
import { isInvitationToken,isMandateCommand,isSignatureEvidence,object,shape,uuid,hash } from '@/lib/clinical-mandates/validation'
import { isMandateAck,isMandatePdf,isMandatePortalView,isMandateWorkspace } from '@/lib/clinical-mandates/transport'
import type { ClinicalAccessContext } from '@/lib/clinical-core/types'
import {isConsentDeliveryCommand,isConsentDeliveryWorkspace} from '@/lib/clinical-mandates/deliveryTransport'
function invalid():never {throw new ClinicalError(400,'INVALID_INPUT','La demande de mandat est invalide.')}
function badResponse():never {throw new ClinicalError(502,'INVALID_RESPONSE','La réponse du mandat n’a pas pu être confirmée. Conservez votre saisie.')}
async function json(request:Request) {
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))invalid()
 return readBoundedJsonObject(request,256*1024)
}
function pdfResponse(value:unknown,expectedId?:string,attachment=false):Response {
 if(!isMandatePdf(value)||expectedId&&value.id!==expectedId)badResponse()
 const bytes=Buffer.from(value.bytesBase64,'base64')
 if(bytes.length!==value.byteLength||bytes.toString('base64')!==value.bytesBase64||bytes.subarray(0,8).toString('ascii')!=='%PDF-1.4'||createHash('sha256').update(bytes).digest('hex')!==value.sha256)throw new ClinicalError(503,'DOCUMENT_INTEGRITY_FAILED','Le document archivé n’a pas pu être vérifié.')
 return new Response(Uint8Array.from(bytes),{headers:{...localResponseHeaders,'Content-Type':'application/pdf','Content-Length':String(bytes.length),'Content-Disposition':(attachment?'attachment':'inline')+'; filename="mandat-'+value.id+'.pdf"','X-Document-SHA256':value.sha256}})
}
async function portal(request:Request):Promise<Response> {
 checkLocalOrigin(request)
 if(request.method!=='POST')return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
 const body=await json(request)
 if(!shape(body,['action','token'],['data'])||!['view','pdf','sign'].includes(String(body.action))||!isInvitationToken(body.token))invalid()
 const data=body.data??{}
 if(!object(data))invalid()
 if(body.action==='sign'){
  if(!shape(data,['key','documentId','documentHash','evidence'])||!uuid(data.key)||!uuid(data.documentId)||!hash(data.documentHash)||!isSignatureEvidence(data.evidence))invalid()
 } else if(Object.keys(data).length)invalid()
 const runtime=readDurableClinicalRuntime()
 const payload=await localRpc<unknown>(runtime,'','lab_consent_portal',{p_action:body.action,p_token_hash:createHash('sha256').update(Buffer.from(body.token,'base64url')).digest('hex'),p_data:data})
 if(shape(payload,['ok','code'])&&object(payload)&&payload.ok===false&&payload.code==='INVITATION_UNAVAILABLE')return localJson({error:'Cette invitation n’est pas disponible.',code:'INVITATION_UNAVAILABLE'},404)
 if(body.action==='pdf')return pdfResponse(payload)
 if(body.action==='view'){if(!isMandatePortalView(payload))badResponse();return localJson(payload)}
 if(!isMandateAck(payload,'portal.sign'))badResponse()
 return localJson(payload)
}
async function portalDownload(request:Request):Promise<Response> {
 if(request.headers.get('Origin')!==(isStagingClinicalRuntime()?process.env.NEXT_PUBLIC_APP_URL:`http://127.0.0.1:${process.env.PEA_LAB_PORT === '3101' ? '3101' : '3100'}`))throw new ClinicalError(403,'ORIGIN_REFUSED','Cette origine n’est pas autorisée dans le laboratoire.')
 if(request.method!=='POST')return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
 if(!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=(?:"utf-8"|utf-8))?\s*$/i.test(request.headers.get('Content-Type')??''))invalid()
 if(Number(request.headers.get('Content-Length'))>200)throw new JsonBodyError('Formulaire trop volumineux.',413)
 const reader=request.body?.getReader()
 if(!reader)invalid()
 const chunks:Uint8Array[]=[];let size=0
 try{
  for(;;){const result=await reader.read();if(result.done)break;size+=result.value.byteLength;if(size>200){await reader.cancel();throw new JsonBodyError('Formulaire trop volumineux.',413)}chunks.push(result.value)}
 }finally{reader.releaseLock()}
 let encoded:string
 try{encoded=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))}catch{invalid()}
 if(encoded.length>200||/%(?![0-9a-f]{2})/i.test(encoded))invalid()
 const fields=[...new URLSearchParams(encoded).entries()]
 if(fields.length!==1||fields[0][0]!=='token'||!isInvitationToken(fields[0][1]))invalid()
 const runtime=readDurableClinicalRuntime()
 const payload=await localRpc<unknown>(runtime,'','lab_consent_portal',{p_action:'pdf',p_token_hash:createHash('sha256').update(Buffer.from(fields[0][1],'base64url')).digest('hex'),p_data:{}})
 if(shape(payload,['ok','code'])&&object(payload)&&payload.ok===false&&payload.code==='INVITATION_UNAVAILABLE')return localJson({error:'Cette invitation n’est pas disponible.',code:'INVITATION_UNAVAILABLE'},404)
 return pdfResponse(payload,undefined,true)
}
function nativeDownloadLoginLocation(request:Request,segments:readonly string[]):string|null {
 if(request.method!=='GET'||segments.length!==4||segments[0]!=='documents'||segments[3]!=='download'
  ||!uuid(segments[1])||!['administration','clinical'].includes(segments[2])||request.headers.has('Authorization')
  ||request.headers.get('Sec-Fetch-Mode')!=='navigate')return null
 const acceptsHtml=request.headers.get('Accept')?.split(',').some(value=>{
  const [type,...parameters]=value.trim().toLowerCase().split(';')
  return type.trim()==='text/html'&&!parameters.some(parameter=>/^q\s*=\s*0(?:\.0*)?$/.test(parameter.trim()))
 })
 if(!acceptsHtml)return null
 const returnModulePath=segments[2]==='administration'?'/administration/mandats':'/clinique/mandats'
 return '/connexion?raison=session-expiree&retour='+encodeURIComponent(returnModulePath)
}

export async function handleLocalMandates(request:Request,segments:string[]):Promise<Response> {
 if(!isDurableClinicalRuntime())return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
 try {
  if(new URL(request.url).search)invalid()
  if(segments.length===2&&segments[0]==='portal'&&segments[1]==='download')return await portalDownload(request)
  if(segments.length===1&&segments[0]==='portal')return await portal(request)
  const {runtime,token,actor}=await localIdentity(request)
  const documentRequest=request.method==='GET'&&segments[0]==='documents'&&(segments.length===3||segments.length===4&&segments[3]==='download')
  const previewRequest=request.method==='GET'&&segments.length===3&&segments[0]==='preview'&&uuid(segments[1])&&['administration','clinical'].includes(segments[2])
  let context:ClinicalAccessContext
  if(documentRequest||previewRequest){
   if(!uuid(segments[1])||!['administration','clinical'].includes(segments[2]))invalid()
   context=segments[2] as ClinicalAccessContext
   const header=request.headers.get('X-Clinical-Context')
   if(header&&header!==context)throw new ClinicalError(403,'CONTEXT_MISMATCH','L’espace demandé ne correspond pas au document.')
  }else context=contextOf(request)
  let caller
  try{caller=resolveActor(actor,{actorId:actor.id,context})}catch{throw new ClinicalError(403,'FORBIDDEN','Cet espace n’est pas autorisé.')}
  if(!canAdmin(caller)&&!canPractice(caller)&&!canSupervise(caller))throw new ClinicalError(403,'FORBIDDEN','Cet espace n’est pas autorisé.')
  if(segments[0]==='delivery'){
   if(request.method==='GET'){
    const clientId=segments.length===3&&segments[1]==='client'&&uuid(segments[2])?segments[2]:null
    if(segments.length!==1&&!clientId)invalid()
    const payload=await localRpc<unknown>(runtime,token,'lab_mandate_delivery_query',{p_context:context,p_client_id:clientId})
    if(!isConsentDeliveryWorkspace(payload,context,actor.id,clientId??undefined))badResponse()
    return localJson(payload)
   }
   if(request.method!=='POST'||segments.length!==2||segments[1]!=='commands')return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
   const command=await json(request)
   if(!isConsentDeliveryCommand(command))invalid()
   const key=request.headers.get('Idempotency-Key');if(!uuid(key))throw new ClinicalError(400,'IDEMPOTENCY_REQUIRED','Une clé de reprise est requise.')
   const payload=await localRpc<unknown>(runtime,token,'lab_mandate_delivery_command',{p_context:context,p_action:command.action,p_data:command.data,p_key:key})
   if(!isMandateAck(payload,command.action))badResponse()
   return localJson(payload)
  }
  if(request.method==='GET'){
   if(previewRequest){const payload=await localRpc<unknown>(runtime,token,'lab_mandate_preview_pdf',{p_context:context,p_revision_id:segments[1]});return pdfResponse(payload,segments[1])}
   let mandateId:string|null=null,clientId:string|null=null,documentId:string|null=null
   if(documentRequest)documentId=segments[1]
   else if(segments.length===1&&uuid(segments[0]))mandateId=segments[0]
   else if(segments.length===2&&segments[0]==='client'&&uuid(segments[1]))clientId=segments[1]
   else if(segments.length===3&&segments[0]==='client'&&uuid(segments[1])&&uuid(segments[2])){clientId=segments[1];mandateId=segments[2]}
   else if(segments.length) return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
   const payload=await localRpc<unknown>(runtime,token,'lab_mandate_query',{p_context:context,p_mandate_id:mandateId,p_client_id:clientId,p_document_id:documentId})
   if(documentId)return pdfResponse(payload,documentId,segments.length===4)
   if(!isMandateWorkspace(payload,context,actor.id))badResponse()
   if(Buffer.byteLength(JSON.stringify(payload),'utf8')>4*1024*1024)throw new ClinicalError(503,'MANDATE_VOLUME_EXCEEDED','Le volume des mandats dépasse la projection autorisée.')
   return localJson(payload)
  }
  if(request.method!=='POST'||segments.length!==1||segments[0]!=='commands')return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
  const command=await json(request)
  if(!isMandateCommand(command))invalid()
  if(!canAdmin(caller)&&!['signature.local','mandate.update','mandate.prepare','mandate.amend'].includes(command.action))throw new ClinicalError(403,'FORBIDDEN','Cette action exige l’espace Administration.')
  const key=request.headers.get('Idempotency-Key')
  if(!uuid(key))throw new ClinicalError(400,'IDEMPOTENCY_REQUIRED','Une clé de reprise est requise.')
  const data={...command.data} as Record<string,unknown>
  if(command.action==='invitation.create'){data.tokenHash=createHash('sha256').update(Buffer.from(String(data.token),'base64url')).digest('hex');delete data.token}
  const payload=await localRpc<unknown>(runtime,token,'lab_mandate_command',{p_context:context,p_action:command.action,p_data:data,p_key:key})
  if(!isMandateAck(payload,command.action))badResponse()
  return localJson(payload,command.action==='mandate.create'?201:200)
 } catch(error) {
  if(error instanceof JsonBodyError)return localJson({error:'Le contenu est invalide ou dépasse la taille permise.',code:'INVALID_BODY'},error.status)
  if(isClinicalError(error)){
   const location=error.status===401?nativeDownloadLoginLocation(request,segments):null
   if(location)return new Response(null,{status:303,headers:{...localResponseHeaders,Location:location}})
   return localJson({error:error.message,code:error.code},error.status)
  }
  return localJson({error:'Les mandats locaux sont indisponibles.',code:'LOCAL_UNAVAILABLE'},503)
 }
}
