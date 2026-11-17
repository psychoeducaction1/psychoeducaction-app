import { readBoundedJsonObject, JsonBodyError } from '@/lib/boundedJsonBody'
import { canAdmin, canPractice, resolveActor } from '@/lib/clinical-core/capabilities'
import { ClinicalError, isClinicalError } from '@/lib/clinical-core/validation'
import { CALENDAR_UUID, isCalendarAck, isCalendarCommand, isCalendarFinancialContext, isCalendarPeriod, isDurableCalendarWorkspace } from '@/lib/clinical-calendar/durableTransport'
import { isCalendarJournal } from '@/lib/clinical-calendar/journal'
import { isLegacyWaitingDashboard } from '@/lib/clinical-admission/legacyDashboard'
import { isDurableClinicalRuntime } from '@/lib/clinical-local/runtime'
import { contextOf, localIdentity, localJson, localRpc } from '@/lib/clinical-local/http'
import { prepareElapsedBilling } from '@/lib/clinical-local/billingWorker'

export async function handleLocalCalendar(request: Request, segments: string[]): Promise<Response> {
  if (!isDurableClinicalRuntime()) return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
  try {
    const {runtime,token,actor}=await localIdentity(request), context=contextOf(request)
    let caller
    try {caller=resolveActor(actor,{actorId:actor.id,context})}
    catch {throw new ClinicalError(403,'FORBIDDEN','Cet espace n’est pas autorisé pour ce compte.')}
    if (!canAdmin(caller) && !canPractice(caller)) throw new ClinicalError(403,'FORBIDDEN','Cet espace n’est pas autorisé pour ce compte.')
    if (new URL(request.url).search) throw new ClinicalError(400,'INVALID_INPUT','Les paramètres du calendrier doivent être explicites.')
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'journal') {
      if (context !== 'administration' || !canAdmin(caller)) throw new ClinicalError(403,'FORBIDDEN','Le journal d’audit est réservé à la direction et à l’administration.')
      const payload = await localRpc<unknown>(runtime,token,'lab_calendar_journal',{p_context:context})
      if (!isCalendarJournal(payload)) throw new ClinicalError(502,'INVALID_RESPONSE','Le journal du calendrier n’a pas pu être confirmé.')
      return localJson(payload)
    }
    if (request.method === 'GET' && segments.length === 1 && segments[0] === 'waiting-snapshot') {
      if (context !== 'administration' || !canAdmin(caller)) throw new ClinicalError(403,'FORBIDDEN','La liste d’attente importée est réservée à la direction et à l’administration.')
      const payload = await localRpc<unknown>(runtime,token,'lab_legacy_waiting_dashboard',{p_context:context})
      if (!isLegacyWaitingDashboard(payload)) throw new ClinicalError(502,'INVALID_RESPONSE','La liste d’attente importée n’a pas pu être confirmée.')
      return localJson(payload)
    }
    if (request.method === 'GET' && segments.length === 4 && segments[0] === 'financial') {
      const [,episodeId,professionalId,serviceDate] = segments
      if (!CALENDAR_UUID.test(episodeId) || !CALENDAR_UUID.test(professionalId) || !isCalendarPeriod(serviceDate,serviceDate)) throw new ClinicalError(400,'INVALID_INPUT','Choisissez un client, un professionnel et une date valides.')
      if (!canAdmin(caller) && professionalId.toLowerCase() !== actor.id) throw new ClinicalError(403,'FORBIDDEN','Ce parcours est réservé à votre propre agenda.')
      const expected={episodeId:episodeId.toLowerCase(),professionalId:professionalId.toLowerCase(),serviceDate}
      const payload=await localRpc<unknown>(runtime,token,'lab_calendar_financial_query',{p_context:context,p_episode_id:expected.episodeId,p_professional_id:expected.professionalId,p_service_date:serviceDate})
      if (!isCalendarFinancialContext(payload,context,expected)) throw new ClinicalError(502,'INVALID_RESPONSE','Les conditions de cette activité n’ont pas pu être confirmées.')
      return localJson(payload)
    }
    if (request.method==='GET' && segments.length===2) {
      const [from,to]=segments
      if(!isCalendarPeriod(from,to)) throw new ClinicalError(400,'INVALID_RANGE','Choisissez une période valide de un à 93 jours.')
      await prepareElapsedBilling(runtime)
      const payload=await localRpc<unknown>(runtime,token,'lab_calendar_query',{p_context:context,p_from_date:from,p_to_date:to})
      if(!payload || typeof payload!=='object' || Array.isArray(payload) || Object.keys(payload).length!==1 || !isDurableCalendarWorkspace((payload as Record<string,unknown>).workspace,context,actor.id,{from,to})) throw new ClinicalError(502,'INVALID_RESPONSE','La projection du calendrier n’a pas pu être confirmée.')
      if(Buffer.byteLength(JSON.stringify(payload),'utf8')>4*1024*1024) throw new ClinicalError(503,'CALENDAR_VOLUME_EXCEEDED','Le volume du calendrier est trop important. Aucun résultat partiel n’est affiché.')
      return localJson(payload)
    }
    if(request.method!=='POST' || segments.length!==1 || segments[0]!=='commands') return localJson({error:'Ressource introuvable.',code:'NOT_FOUND'},404)
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??'')) throw new ClinicalError(400,'INVALID_INPUT','Un contenu JSON est requis.')
    const command=await readBoundedJsonObject(request,96*1024)
    if(!isCalendarCommand(command)) throw new ClinicalError(400,'INVALID_INPUT','La commande du calendrier est invalide.')
    if(!canAdmin(caller) && (command.action.startsWith('offices.') || command.action==='office-grants.set')) throw new ClinicalError(403,'FORBIDDEN','Cette action exige l’espace Administration.')
    if(!canAdmin(caller) && ((command.action==='appointments.create' && command.data.professionalId!==actor.id) || (command.action==='availability.set' && command.id!==actor.id))) throw new ClinicalError(403,'FORBIDDEN','Cette action est réservée à votre propre agenda.')
    if (!canAdmin(caller) && (Object.hasOwn(command.data,'financialOverride') || Object.hasOwn(command.data,'acceptedConditions'))) throw new ClinicalError(403,'FORBIDDEN','Les tarifs et la répartition relèvent de l’espace Administration.')
    if (!canAdmin(caller) && command.action === 'appointments.reschedule' && command.data.professionalId !== undefined && command.data.professionalId !== actor.id) throw new ClinicalError(403,'FORBIDDEN','Cette modification exige l’espace Administration.')
    const key=request.headers.get('Idempotency-Key')
    if(!key || !CALENDAR_UUID.test(key)) throw new ClinicalError(400,'IDEMPOTENCY_REQUIRED','Une clé de reprise est requise pour cette opération.')
    const payload=await localRpc<unknown>(runtime,token,'lab_calendar_command',{p_context:context,p_action:command.action,p_id:command.id,p_data:command.data,p_request_key:key})
    if(!isCalendarAck(payload,context,actor.id)) throw new ClinicalError(502,'INVALID_RESPONSE','La commande n’a pas pu être confirmée. Conservez votre saisie avant de réessayer.')
    if(Buffer.byteLength(JSON.stringify(payload),'utf8')>256*1024) throw new ClinicalError(503,'CALENDAR_VOLUME_EXCEEDED','Le résultat dépasse la taille permise. Conservez votre saisie.')
    return localJson(payload,command.action==='appointments.create' || command.action==='offices.create'?201:200)
  } catch(error) {
    if(error instanceof JsonBodyError) return localJson({error:'Le contenu JSON est invalide ou dépasse la taille permise.',code:'INVALID_BODY'},error.status)
    if(isClinicalError(error)) return localJson({error:error.message,code:error.code},error.status)
    return localJson({error:'Le calendrier local est indisponible. Aucun état mémoire de secours n’est utilisé.',code:'LOCAL_UNAVAILABLE'},503)
  }
}
