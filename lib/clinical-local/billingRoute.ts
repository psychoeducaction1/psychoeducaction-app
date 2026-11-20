import {createHash} from 'node:crypto'
import {readBoundedJsonObject,JsonBodyError} from '@/lib/boundedJsonBody'
import {hasCapability} from '@/lib/clinical-core/capabilities'
import {ClinicalError,isClinicalError} from '@/lib/clinical-core/validation'
import type {ClinicalAccessContext} from '@/lib/clinical-core/types'
import type {DurableBillingFilter,DurableBillingWorkspace} from '@/lib/clinical-finance/durableTypes'
import {isDurableClinicalRuntime} from '@/lib/clinical-local/runtime'
import {contextOf,localIdentity,localJson,localRpc,localResponseHeaders} from '@/lib/clinical-local/http'
import {prepareElapsedBilling,runLocalBillingPreparation} from '@/lib/clinical-local/billingWorker'
import {shape,object,uuid,date} from '@/lib/clinical-mandates/validation'
import {isDurableBillingCommand,isDurableBillingFilter} from '@/lib/clinical-finance/validation'
import {isDurableBillingWorkspace,isDurableBillingAck,isBillingDocumentPayload} from '@/lib/clinical-finance/transport'
import {isFeeCommand} from '@/lib/clinical-finance/feeValidation'
import {isFeeWorkspace,isFeeAck,isFeePdf} from '@/lib/clinical-finance/feeTransport'
import {prepareFeeCommand} from '@/lib/clinical-finance/durableFees'
const invalid=():never=>{throw new ClinicalError(400,'INVALID_INPUT','La demande financière est invalide.')}
const unexpected=():never=>{throw new ClinicalError(502,'INVALID_RESPONSE','La réponse financière n’a pas pu être confirmée. Conservez votre saisie.')}
function pdf(value:unknown,id:string,fees:boolean,inline=false):Response{
 if(!(fees?isFeePdf(value):isBillingDocumentPayload(value)))unexpected()
 const d=value as {id:string;sha256:string;byteLength:number;bytesBase64:string}
 if(d.id!==id||d.byteLength>4*1024*1024)unexpected()
 const bytes=Buffer.from(d.bytesBase64,'base64')
 if(bytes.length!==d.byteLength||bytes.toString('base64')!==d.bytesBase64||bytes.subarray(0,8).toString('ascii')!=='%PDF-1.4'||createHash('sha256').update(bytes).digest('hex')!==d.sha256)throw new ClinicalError(503,'DOCUMENT_INTEGRITY_FAILED','Le PDF financier n’a pas pu être vérifié.')
 return new Response(Uint8Array.from(bytes),{headers:{...localResponseHeaders,'Content-Type':'application/pdf','Content-Length':String(bytes.length),'Content-Disposition':(inline?'inline':'attachment')+'; filename="'+(fees?'honoraires-':'facturation-')+id+'.pdf"','X-Document-SHA256':d.sha256}})
}
function params(request:Request,allowed:string[]):URLSearchParams{
 const q=new URL(request.url).searchParams
 if([...q.keys()].some(k=>!allowed.includes(k)||q.getAll(k).length!==1))invalid()
 return q
}
function filters(request:Request):{filters:DurableBillingFilter;invoiceId:string|null}{
 const q=params(request,['search','status','page','pageSize','invoiceId','clientId','activityId','professional','clientName','invoiceNumber','clientNumber','dateFrom','dateTo','recurring'])
 const value={search:q.get('search')??'',status:q.get('status')??'all',page:q.has('page')?Number(q.get('page')):1,pageSize:q.has('pageSize')?Number(q.get('pageSize')):10,clientId:q.get('clientId')?.toLowerCase()??null,activityId:q.get('activityId')?.toLowerCase()??null,professional:q.get('professional')??'',clientName:q.get('clientName')??'',invoiceNumber:q.get('invoiceNumber')??'',clientNumber:q.get('clientNumber')??'',dateFrom:q.get('dateFrom'),dateTo:q.get('dateTo'),recurring:q.get('recurring')??'all'}
 if(!isDurableBillingFilter(value))return invalid()
 if(q.has('invoiceId')&&!uuid(q.get('invoiceId')))return invalid()
 return {filters:value,invoiceId:q.get('invoiceId')}
}
function feeFilters(request:Request){
 const q=params(request,['professionalId','from','to','statementId'])
 for(const key of ['professionalId','statementId'])if(q.has(key)&&!uuid(q.get(key)))invalid()
 for(const key of ['from','to'])if(q.has(key)&&!date(q.get(key)))invalid()
 if(q.has('from')!==q.has('to')||q.has('from')&&q.get('from')!>q.get('to')!)invalid()
 return {p_professional_id:q.get('professionalId'),p_from:q.get('from'),p_to:q.get('to'),p_statement_id:q.get('statementId')}
}
export async function handleLocalBilling(request:Request,segments:string[]):Promise<Response>{
 if(!isDurableClinicalRuntime())return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
 const feeDocument=segments.length===5&&segments[0]==='fees'&&segments[1]==='documents'&&uuid(segments[2])&&['administration','clinical'].includes(segments[3])&&segments[4]==='download'
 const invoiceDocument=segments.length===4&&segments[0]==='documents'&&uuid(segments[1])&&segments[2]==='administration'&&segments[3]==='download'
 const documentRequest=Boolean(feeDocument||invoiceDocument),documentId=feeDocument?segments[2]:segments[1]
 const nativeContext=feeDocument?segments[3]:'administration'
 try{
  const {runtime,token,actor}=await localIdentity(request)
  const context=documentRequest?nativeContext as ClinicalAccessContext:contextOf(request)
  if(documentRequest&&request.headers.has('X-Clinical-Context')&&request.headers.get('X-Clinical-Context')!==context)throw new ClinicalError(403,'FORBIDDEN','Ce document n’est pas autorisé dans cet espace.')
  if(context==='administration'?!hasCapability(actor,'administration'):!hasCapability(actor,'practice')&&!hasCapability(actor,'supervision'))throw new ClinicalError(403,'FORBIDDEN','Cet espace n’est pas autorisé pour ce compte.')
  if(segments.length===1&&segments[0]==='opening-policy'){
   if(context!=='administration')throw new ClinicalError(403,'FORBIDDEN','Les frais d’ouverture sont administratifs.')
   params(request,request.method==='GET'?['patientId']:[])
   let patientId:string|null=null,charge:boolean|null=null,reason='',expectedVersion:number|null=null
   if(request.method==='GET')patientId=new URL(request.url).searchParams.get('patientId')
   else if(request.method==='POST'){
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))invalid()
    const input=await readBoundedJsonObject(request,2048)
    if(!shape(input,['patientId','charge','reason','expectedVersion'])||!object(input)||typeof input.charge!=='boolean'||typeof input.reason!=='string'||(input.expectedVersion!==null&&!Number.isInteger(input.expectedVersion)))invalid()
    patientId=String(input.patientId);charge=input.charge as boolean;reason=input.reason as string;expectedVersion=input.expectedVersion as number|null
    if(reason.length>500||(!charge&&!reason.trim())||(expectedVersion!==null&&expectedVersion<0))invalid()
   }else return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
   if(!uuid(patientId))invalid()
   const value=await localRpc<unknown>(runtime,token,'lab_billing_opening_policy',{p_patient_id:patientId,p_charge:charge,p_reason:reason,p_expected_version:expectedVersion})
   if(!object(value)||!shape(value,['patientId','charge','reason','version','prepared'])||value.patientId!==patientId||typeof value.charge!=='boolean'||typeof value.reason!=='string'||!Number.isInteger(value.version)||typeof value.prepared!=='boolean')unexpected()
   return localJson(value)
  }
  if(segments.length===2&&segments[0]==='settings'&&segments[1]==='reminders'){
   if(context!=='administration')throw new ClinicalError(403,'FORBIDDEN','Les paramètres de facturation sont administratifs.')
   params(request,[])
   let first:number|null=null,second:number|null=null,version:number|null=null
   if(request.method==='POST'){
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))invalid()
    const input=await readBoundedJsonObject(request,1024)
    if(!shape(input,['firstDays','secondDays','expectedVersion'])||!object(input))invalid()
    if(typeof input.firstDays!=='number'||typeof input.secondDays!=='number'||typeof input.expectedVersion!=='number')invalid()
    first=input.firstDays as number;second=input.secondDays as number;version=input.expectedVersion as number
    if(!Number.isInteger(first)||first<1||first>90||!Number.isInteger(second)||second<1||second>90||first>=second||!Number.isInteger(version)||version<1)invalid()
   }else if(request.method!=='GET')return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
   const value=await localRpc<unknown>(runtime,token,'lab_billing_reminder_policy',{p_context:context,p_first_days:first,p_second_days:second,p_expected_version:version})
   if(!object(value)||!shape(value,['firstDays','secondDays','version'])||!Number.isInteger(value.firstDays)||!Number.isInteger(value.secondDays)||!Number.isInteger(value.version)||Number(value.firstDays)<1||Number(value.secondDays)>90||Number(value.firstDays)>=Number(value.secondDays)||Number(value.version)<1)unexpected()
   return localJson(value)
  }
  if(request.method==='GET'){
   if(documentRequest){const documentParams=params(request,['view']);if(documentParams.has('view')&&documentParams.get('view')!=='inline')invalid();const value=feeDocument?await localRpc<unknown>(runtime,token,'lab_fee_query',{p_context:context,p_professional_id:null,p_from:null,p_to:null,p_statement_id:null,p_document_id:documentId}):await localRpc<unknown>(runtime,token,'lab_billing_query',{p_context:context,p_invoice_id:null,p_document_id:documentId,p_filters:{}});return pdf(value,documentId,Boolean(feeDocument),documentParams.get('view')==='inline')}
   if(segments.length===1&&segments[0]==='fees'){
    const value=await localRpc<unknown>(runtime,token,'lab_fee_query',{p_context:context,...feeFilters(request),p_document_id:null})
    if(!isFeeWorkspace(value,context,actor.id))unexpected();return localJson(value)
   }
   if(segments.length===0){
    if(context!=='administration')throw new ClinicalError(403,'FORBIDDEN','Les factures clients sont réservées à l’espace administratif.')
    const input=filters(request)
    await prepareElapsedBilling(runtime)
    let value=await localRpc<unknown>(runtime,token,'lab_billing_query',{p_context:context,p_invoice_id:input.invoiceId,p_document_id:null,p_filters:input.filters})
    if(!isDurableBillingWorkspace(value,context,actor.id,input.filters))unexpected()
    if((value as DurableBillingWorkspace).eligibleActivities.some(activity=>!activity.prepared&&!activity.blockedReason)){
     await runLocalBillingPreparation(runtime)
     value=await localRpc<unknown>(runtime,token,'lab_billing_query',{p_context:context,p_invoice_id:input.invoiceId,p_document_id:null,p_filters:input.filters})
     if(!isDurableBillingWorkspace(value,context,actor.id,input.filters))unexpected()
    }
    return localJson(value)
   }
   return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
  }
  if(request.method!=='POST'||segments.length!==1||segments[0]!=='commands')return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
  params(request,[])
  if(context!=='administration')throw new ClinicalError(403,'FORBIDDEN','Les commandes financières sont administratives.')
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))invalid()
  const body=await readBoundedJsonObject(request,32*1024)
  if(!shape(body,['key','action','data'])||!object(body)||!uuid(body.key))invalid()
  const command={action:body.action,data:body.data}
  if(isFeeCommand(command)){
   const value=await prepareFeeCommand(runtime,token,actor,command,String(body.key))
   if(!isFeeAck(value,command.action))unexpected();return localJson(value)
  }
  if(!isDurableBillingCommand(command))return invalid()
  if(command.action==='receipt.send_demo'){
   const value=await localRpc<unknown>(runtime,token,'lab_billing_receipt_send_demo',{
    p_context:context,p_invoice_id:command.data.invoiceId,p_document_id:command.data.documentId,
    p_expected_version:command.data.expectedVersion,p_confirmed:command.data.confirmed,p_key:body.key,
   })
   if(!isDurableBillingAck(value,command.action))unexpected();return localJson(value)
  }
  const value=await localRpc<unknown>(runtime,token,'lab_billing_command',{p_context:context,p_action:command.action,p_data:command.data,p_key:body.key})
  if(!isDurableBillingAck(value,command.action))unexpected();return localJson(value)
 }catch(error){
  if(error instanceof JsonBodyError)return localJson({error:'Le contenu JSON est invalide ou trop volumineux.',code:'INVALID_BODY'},error.status)
  if(isClinicalError(error)){
   if(error.status===401&&documentRequest&&!request.headers.has('Authorization')&&request.headers.get('Sec-Fetch-Mode')==='navigate'&&request.headers.get('Accept')?.split(',').some(part=>{const [type,...options]=part.trim().toLowerCase().split(';');return type.trim()==='text/html'&&!options.some(option=>/^q\s*=\s*0(?:\.0*)?$/.test(option.trim()))}))return new Response(null,{status:303,headers:{...localResponseHeaders,Location:'/connexion?raison=session-expiree&retour='+encodeURIComponent(nativeContext==='clinical'?'/clinique/facturation':'/administration/facturation')}})
   return localJson({error:error.message,code:error.code},error.status)
  }
  return localJson({error:'Le stockage financier local est indisponible. Aucun repli en mémoire ni transaction réelle.',code:'LOCAL_FINANCE_UNAVAILABLE'},503)
 }
}
