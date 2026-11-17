import { JsonBodyError, readBoundedJsonObject } from '../boundedJsonBody.ts'
import type { ClinicalAccessContext } from '../clinical-core/types.ts'
import { ADMISSION_UUID, isAdmissionCommand, isAdmissionResult, isAdmissionWorkspace } from '../clinical-admission/transport.ts'
import { getNonServiceReasonError } from '../../app/professionnel/shared.ts'
import { validateServiceAppointmentInput } from '../serviceAppointment.ts'
import type { UnifiedWorkspaceTransport } from './workspace.ts'

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const allowed = new Set(['capacities.create', 'capacities.update', 'preferences.update', 'assignments.result', 'assignments.return'])
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
const invalid = () => reply({ error: 'Vérifiez les renseignements de la demande ou de l’assignation.', code: 'INVALID_INPUT' }, 400)

/** Adapter only. Operational waiting lists/processes remain their existing routes. */
export async function handleUnifiedAdmissionRequest(request: Request, segments: string[], auth: { token: string; context: ClinicalAccessContext }, transport: UnifiedWorkspaceTransport): Promise<Response> {
  if (new URL(request.url).search) return invalid()
  try {
    if (request.method === 'GET' && segments.length === 0) {
      const workspace = await transport.rpc('clinical_unified_admission_query', { p_context: auth.context }, auth.token)
      if (!object(workspace) || typeof workspace.actorId !== 'string' || !ADMISSION_UUID.test(workspace.actorId)
        || !isAdmissionWorkspace(workspace, workspace.actorId, auth.context) || workspace.mode !== 'isolated_unified') throw new Error('UNIFIED_RESPONSE_INVALID')
      return reply({ workspace })
    }
    if (request.method !== 'POST' || segments.length !== 1 || segments[0] !== 'commands') return reply({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return invalid()
    const key = request.headers.get('Idempotency-Key')
    if (!key || !ADMISSION_UUID.test(key)) return invalid()
    const command = await readBoundedJsonObject(request, 16384)
    if (!isAdmissionCommand(command) || !allowed.has(command.action)) return invalid()
    const { data, action } = command
    if (action !== 'capacities.create' && (!Number.isSafeInteger(data.expectedVersion) || Number(data.expectedVersion) < 1)) return invalid()
    if (action.startsWith('capacities.')) {
      if (!Number.isSafeInteger(data.requestedCount) || Number(data.requestedCount) < 0 || Number(data.requestedCount) > 500
        || typeof data.comment !== 'string' || data.comment.length > 300
        || action === 'capacities.update' && typeof data.enabled !== 'boolean'
        || action === 'capacities.create' && (typeof data.professionalId !== 'string' || !ADMISSION_UUID.test(data.professionalId))) return invalid()
    }
    if (action === 'assignments.return' && (auth.context !== 'administration' || typeof data.reason !== 'string' || !data.reason.trim() || data.reason.length > 1000)) return invalid()
    if (action === 'assignments.result') {
      if (!['not_contacted', 'pending', 'taken', 'not_taken'].includes(String(data.outcome))) return invalid()
      if (data.outcome === 'not_taken' && (typeof data.reason !== 'string' || data.reason.length > 1000 || getNonServiceReasonError(data.reason))) return invalid()
      if (['appointmentDate', 'appointmentTime', 'appointmentModality', 'appointmentStartsAt'].some(field => Object.hasOwn(data, field))) {
        try { validateServiceAppointmentInput({ date: String(data.appointmentDate ?? ''), time: String(data.appointmentTime ?? ''), modality: String(data.appointmentModality ?? '') }) }
        catch { return invalid() }
        if (typeof data.appointmentStartsAt !== 'string' || !Number.isFinite(Date.parse(data.appointmentStartsAt))) return invalid()
      }
    }
    const result = await transport.rpc('clinical_unified_admission_command', {
      p_context: auth.context, p_action: action, p_id: command.id, p_data: data, p_key: key,
    }, auth.token)
    if (!object(result) || !object(result.workspace) || typeof result.workspace.actorId !== 'string'
      || !isAdmissionResult(result, result.workspace.actorId, auth.context) || result.workspace.mode !== 'isolated_unified') throw new Error('UNIFIED_RESPONSE_INVALID')
    return reply(result, 201)
  } catch (cause) {
    if (cause instanceof JsonBodyError) return reply({ error: cause.message, code: 'INVALID_BODY' }, cause.status)
    throw cause
  }
}
