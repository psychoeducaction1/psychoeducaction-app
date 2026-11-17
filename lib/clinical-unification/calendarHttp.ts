import type { ClinicalAccessContext } from '../clinical-core/types.ts'
import { JsonBodyError, readBoundedJsonObject } from '../boundedJsonBody.ts'
import { CALENDAR_UUID, isCalendarAck, isCalendarCommand, isCalendarFinancialContext, isCalendarPeriod, isDurableCalendarWorkspace } from '../clinical-calendar/durableTransport.ts'
import type { UnifiedWorkspaceTransport } from './workspace.ts'

type Auth = { token: string; context: ClinicalAccessContext }
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const reply = (v: unknown, status = 200) => Response.json(v, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
const invalid = () => reply({ error: 'Vérifiez les renseignements du calendrier.', code: 'INVALID_INPUT' }, 400)
const badProjection = (): never => { throw Object.assign(new Error('UNIFIED_RESPONSE_INVALID'), { code: 'UNIFIED_RESPONSE_INVALID' }) }

/** Authenticated by the common façade first. The actor is always derived by SQL from auth.uid(). */
export async function handleUnifiedCalendarRequest(request: Request, segments: string[], auth: Auth,
  transport: UnifiedWorkspaceTransport): Promise<Response> {
  try {
    if (new URL(request.url).search) return invalid()
    if (request.method === 'GET' && segments.length === 2 && segments[0] === 'removal-preview') {
      if (!CALENDAR_UUID.test(segments[1])) return invalid()
      return reply(await transport.rpc('clinical_unified_encounter_removal_preview', { p_context: auth.context, p_appointment_id: segments[1] }, auth.token))
    }
    if (request.method === 'GET' && segments.length === 2) {
      if (!isCalendarPeriod(segments[0], segments[1])) return invalid()
      const value = await transport.rpc('clinical_unified_calendar_query_870', {
        p_context: auth.context, p_from_date: segments[0], p_to_date: segments[1],
      }, auth.token)
      if (!object(value) || Object.keys(value).length !== 1 || !isDurableCalendarWorkspace(value.workspace, auth.context, undefined,
        { from: segments[0], to: segments[1] }) || value.workspace.mode !== 'isolated_unified') badProjection()
      return reply(value)
    }
    if (request.method === 'GET' && segments.length === 4 && segments[0] === 'financial') {
      const [, episodeId, professionalId, serviceDate] = segments
      if (!CALENDAR_UUID.test(episodeId) || !CALENDAR_UUID.test(professionalId) || !isCalendarPeriod(serviceDate, serviceDate)) return invalid()
      const value = await transport.rpc('clinical_unified_calendar_financial_context', {
        p_context: auth.context, p_episode_id: episodeId, p_professional_id: professionalId, p_service_date: serviceDate,
      }, auth.token)
      if (!isCalendarFinancialContext(value, auth.context, { episodeId, professionalId, serviceDate })) badProjection()
      return reply(value)
    }
    if (request.method === 'POST' && segments.length === 1 && segments[0] === 'commands') {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return invalid()
      const key = request.headers.get('Idempotency-Key')
      if (!key || !CALENDAR_UUID.test(key)) return invalid()
      const command = await readBoundedJsonObject(request, 32768)
      if (!isCalendarCommand(command)) return invalid()
      const value = await transport.rpc('clinical_unified_calendar_command', {
        p_context: auth.context, p_action: command.action, p_id: command.id, p_data: command.data, p_request_key: key,
      }, auth.token)
      if (!isCalendarAck(value, auth.context) || value.mode !== 'isolated_unified') badProjection()
      return reply(value, 201)
    }
    return reply({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
  } catch (cause) {
    if (cause instanceof JsonBodyError) return reply({ error: cause.message, code: 'INVALID_BODY' }, cause.status)
    throw cause
  }
}
