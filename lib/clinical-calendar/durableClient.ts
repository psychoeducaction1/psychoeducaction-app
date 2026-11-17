import type { ClinicalAccessContext, ClinicalActorInput } from '@/lib/clinical-core/types'
import type { CalendarCommand, CalendarCommandAck, CalendarFinancialContext, DurableCalendarWorkspace } from '@/lib/clinical-calendar/durableTypes'
import { CALENDAR_UUID, isCalendarAck, isCalendarCommand, isCalendarFinancialContext, isCalendarPeriod, isDurableCalendarWorkspace } from '@/lib/clinical-calendar/durableTransport'
import { ClinicalApiError, clinicalContextFromPath, clinicalRequest } from '@/lib/clinical-workspace/api'

const actorId = (input: ClinicalActorInput) => typeof input === 'string' ? input : input.actorId
const contextOf = (input: ClinicalActorInput): ClinicalAccessContext => typeof input === 'string' ? clinicalContextFromPath(typeof window === 'undefined' ? '/clinique' : window.location.pathname) : input.context
export async function loadCalendar(from: string, to: string, context: ClinicalActorInput, signal?: AbortSignal): Promise<DurableCalendarWorkspace> {
  if (!isCalendarPeriod(from,to)) throw new ClinicalApiError('Choisissez une période valide de un à 93 jours.',400,'INVALID_RANGE')
  const payload = await clinicalRequest<{workspace:DurableCalendarWorkspace}>(context,'/calendar/'+from+'/'+to,undefined,'GET',signal,undefined,
    value=>Boolean(value && typeof value === 'object' && Object.keys(value).length === 1 && isDurableCalendarWorkspace((value as Record<string,unknown>).workspace,contextOf(context),actorId(context),{from,to})))
  return payload.workspace
}
/** Confirmation only: a later failed refresh must not reclassify this committed command. */
export async function runCalendarCommand(command: CalendarCommand, context: ClinicalActorInput): Promise<CalendarCommandAck> {
  if (!isCalendarCommand(command)) throw new ClinicalApiError('La commande du calendrier est invalide.',400,'INVALID_INPUT')
  return clinicalRequest<CalendarCommandAck>(context,'/calendar/commands',command as unknown as Record<string,unknown>,'POST',undefined,undefined,
    value=>isCalendarAck(value,contextOf(context),actorId(context)))
}
/** Only the authorized context is returned: clinical users never receive rates or payer identities. */
export async function loadCalendarFinancialContext(episodeId: string, professionalId: string, serviceDate: string, actor: ClinicalActorInput, signal?: AbortSignal): Promise<CalendarFinancialContext> {
  if (!CALENDAR_UUID.test(episodeId) || !CALENDAR_UUID.test(professionalId) || !isCalendarPeriod(serviceDate,serviceDate)) throw new ClinicalApiError('Choisissez un client, un professionnel et une date valides.',400,'INVALID_INPUT')
  const expected = {episodeId:episodeId.toLowerCase(),professionalId:professionalId.toLowerCase(),serviceDate}
  return clinicalRequest<CalendarFinancialContext>(actor,'/calendar/financial/'+expected.episodeId+'/'+expected.professionalId+'/'+serviceDate,undefined,'GET',signal,undefined,value=>isCalendarFinancialContext(value,contextOf(actor),expected))
}
