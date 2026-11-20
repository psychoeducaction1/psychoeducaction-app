import {handleClientDetails,isClientDetailsRoute} from '@/lib/clinical-local/clientDetailsRoute'
import { readBoundedJsonObject, JsonBodyError } from '@/lib/boundedJsonBody'
import { CLINICAL_NOTE_TEMPLATES } from '@/lib/clinicalNoteTemplates'
import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'
import { ClinicalError, isClinicalError } from '@/lib/clinical-core/validation'
import { contextOf, localIdentity, localJson, localRpc } from '@/lib/clinical-local/http'
import { handleLocalCalendar } from '@/lib/clinical-local/calendarRoute'
import { handleLocalAdmission } from '@/lib/clinical-local/admissionRoute'
import { handleLocalBilling } from '@/lib/clinical-local/billingRoute'
import { handleLocalMandates } from '@/lib/clinical-local/mandateRoute'
import { logDocumentResponseDiagnostic } from '@/lib/clinical-local/documentDiagnostics'
import { createHash } from 'node:crypto'

const queryAreas:Record<string,string>={clients:'clients',records:'record',notes:'note',audit:'audit',actors:'actors'}
export async function handleLocalWorkspace(request:Request,segments:string[]):Promise<Response> {
  if (segments[0] === 'note-templates') return (await import('./noteTemplateRoute')).handleNoteTemplates(request, segments)
  if (segments[0] === 'professionals') {
    const { handleLocalProfessionals } = await import('@/lib/clinical-local/professionalRoute')
    return handleLocalProfessionals(request,segments.slice(1))
  }
  if (isClientDetailsRoute(segments)) return handleClientDetails(request,segments)
  if (segments[0] === 'billing') return handleLocalBilling(request,segments.slice(1))
  if (segments[0] === 'mandates') {
    const response=await handleLocalMandates(request,segments.slice(1))
    logDocumentResponseDiagnostic(request.method,segments.slice(1),response)
    return response
  }
  if (segments[0] === 'calendar') return handleLocalCalendar(request, segments.slice(1))
  if (segments[0] === 'admission') return handleLocalAdmission(request, segments.slice(1))
  try {
    const {runtime,token}=await localIdentity(request)
    const [area,id,action]=segments
    // A browser PDF viewer cannot attach the clinical header. This one read-only
    // document URL accepts an explicit clinical context; the SQL grant still
    // checks the authenticated user's access to this exact note.
    const pdfView=request.method==='GET'&&area==='notes'&&action==='pdf'&&segments.length===3
    const context=pdfView&&new URL(request.url).searchParams.get('context')==='clinical'?'clinical':contextOf(request)
    if(id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw new ClinicalError(400,'INVALID_INPUT','Identifiant non valide.')
    if(request.method==='GET'&&area==='notes'&&id&&action==='pdf'&&segments.length===3){
      const value=await localRpc<{bytesBase64:string;byteLength:number;sha256:string}>(runtime,token,'lab_note_pdf',{p_context:context,p_note_id:id})
      if(typeof value.bytesBase64!=='string'||typeof value.sha256!=='string'||!Number.isSafeInteger(value.byteLength))throw new ClinicalError(503,'DOCUMENT_INTEGRITY_FAILED','Le PDF de la note est invalide.')
      const bytes=Buffer.from(value.bytesBase64,'base64')
      if(bytes.length!==value.byteLength||bytes.subarray(0,5).toString('ascii')!=='%PDF-'||createHash('sha256').update(bytes).digest('hex')!==value.sha256)throw new ClinicalError(503,'DOCUMENT_INTEGRITY_FAILED','Le PDF de la note est invalide.')
      return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="note-${id}.pdf"`,'Content-Length':String(bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Document-SHA256':value.sha256}})
    }
    if(request.method==='GET'&&area==='notes'&&id&&action==='signatures'&&segments.length===3){
      if(context!=='clinical') throw new ClinicalError(403,'FORBIDDEN','Accès clinique requis.')
      const value=await localRpc<Record<string,unknown>>(runtime,token,'lab_note_signature_query',{p_context:context,p_note_id:id})
      return localJson(value)
    }
    if(request.method==='GET') {
      const target=!segments.length?'workspace':area==='records'&&action==='appointments'&&segments.length===3?'appointments':segments.length===1&&['clients','audit','actors'].includes(area)?queryAreas[area]:segments.length===2&&['records','notes'].includes(area)?queryAreas[area]:undefined
      if(!target) return localJson({error:'Ressource introuvable.'},404)
      const payload=await localRpc<Record<string,unknown>>(runtime,token,'lab_query',{p_context:context,p_action:target,p_id:id??null})
      if(payload.workspace&&typeof payload.workspace==='object') Object.assign(payload.workspace,{noteTypes:CLINICAL_NOTE_TEMPLATES.map(type=>({id:type.id,label:type.label,sections:CLINICAL_NOTE_BLUEPRINTS[type.id].map(section=>({id:section.id,title:section.title}))}))})
      return localJson(payload)
    }
    if(request.method==='DELETE'&&area==='notes'&&segments.length===2){
      const data=await readBoundedJsonObject(request,1024)
      if(Object.keys(data).length!==1||!Number.isSafeInteger(data.expectedVersion)||Number(data.expectedVersion)<1)throw new ClinicalError(400,'INVALID_INPUT','Version de note invalide.')
      const result=await localRpc<{id:string;removed:boolean}>(runtime,token,'lab_note_delete',{p_context:context,p_note_id:id,p_expected_version:data.expectedVersion})
      return localJson({result})
    }
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))throw new ClinicalError(400,'INVALID_INPUT','Un contenu JSON est requis.')
    const data=await readBoundedJsonObject(request,96*1024)
    const post=request.method==='POST',patch=request.method==='PATCH'
    let target:string|undefined
    if(area==='clients')target=post&&segments.length===1?'clients.create':patch&&segments.length===2?'clients.update':post&&segments.length===3&&['contacts','representatives','payers','requests','episodes','assignment-links','assign'].includes(action)?`clients.${action}`:undefined
    if(area==='records')target=post&&segments.length===1?'records.create':patch&&segments.length===3&&action==='access'?'records.access':post&&segments.length===3&&action==='notes'?'records.notes':undefined
    if(area==='notes')target=patch&&segments.length===2?'notes.save':post&&segments.length===3&&['sign','cosign','amend'].includes(action)?`notes.${action}`:undefined
    if(!target)return localJson({error:'Ressource introuvable.'},404)
    const requestKey=request.headers.get('Idempotency-Key')
    if(!requestKey||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey))throw new ClinicalError(400,'IDEMPOTENCY_REQUIRED','Une clé de reprise est requise. Actualisez le formulaire sans perdre votre saisie.')
    const payload=target==='clients.create'
      ? await localRpc<Record<string,unknown>>(runtime,token,'lab_client_create',{p_context:context,p_data:data,p_request_key:requestKey})
      : await localRpc<Record<string,unknown>>(runtime,token,'lab_command',{p_context:context,p_action:target,p_id:id??null,p_data:data,p_request_key:requestKey})
    return localJson(payload,post&&!['sign','cosign'].includes(action)?201:200)
  }catch(error){
    if(error instanceof JsonBodyError)return localJson({error:'Le contenu JSON est invalide ou dépasse la taille permise.',code:'INVALID_BODY'},error.status)
    if(isClinicalError(error))return localJson({error:error.message,code:error.code},error.status)
    return localJson({error:'Le stockage local n’est pas disponible. Les données déjà confirmées ne sont pas remplacées par des données de démonstration.',code:'LOCAL_UNAVAILABLE'},503)
  }
}
