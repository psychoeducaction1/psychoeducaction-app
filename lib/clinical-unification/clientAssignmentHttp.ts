import { JsonBodyError, readBoundedJsonObject } from '../boundedJsonBody.ts'
import type { UnifiedDomainHandler } from './http.ts'
import { unifiedJson } from './http.ts'

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const invalid = () => unifiedJson({ code: 'INVALID_INPUT', error: 'Vérifiez la demande et le professionnel sélectionnés.' }, 400)

export const handleUnifiedClientAssignment: UnifiedDomainHandler = async (request, path, identity) => {
  if (path[0] !== 'clients' || path[2] !== 'assign') return null
  if (identity.context !== 'administration') return unifiedJson({ code: 'FORBIDDEN', error: 'Une assignation exige les droits administratifs.' }, 403)
  if (path.length !== 3 || request.method !== 'POST' || !uuid(path[1]) || new URL(request.url).search
    || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return invalid()
  const key = request.headers.get('Idempotency-Key')
  if (!uuid(key)) return invalid()
  try {
    const data = await readBoundedJsonObject(request, 8192)
    if (Object.keys(data).length !== 3 || Object.keys(data).some(k => !['requestId', 'professionalId', 'label'].includes(k))
      || !uuid(data.requestId) || !uuid(data.professionalId) || typeof data.label !== 'string'
      || !data.label.trim() || data.label.trim().length > 160) return invalid()
    return unifiedJson(await identity.transport.rpc('clinical_unified_assign_client_request', {
      p_context: identity.context, p_patient_id: path[1], p_request_id: data.requestId,
      p_professional_id: data.professionalId, p_label: data.label.trim(), p_key: key,
    }, identity.token), 201)
  } catch (cause) {
    if (cause instanceof JsonBodyError) return unifiedJson({ code: 'INVALID_BODY', error: cause.message }, cause.status)
    const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : ''
    if (['NO_ASSIGNMENT_CAPACITY', 'ACTIVE_ASSIGNMENT_EXISTS', 'ACTIVE_ASSIGNMENT_PROCESS', 'WAITING_CLIENT_NOT_ASSIGNABLE'].some(code => message.includes(code))) {
      return unifiedJson({ code: 'ASSIGNMENT_CONFLICT', error: 'Cette demande est déjà attribuée, en cours, ou le professionnel n’a plus de place disponible.' }, 409)
    }
    throw cause
  }
}
