import { readBoundedJsonObject, JsonBodyError } from '@/lib/boundedJsonBody'
import { ClinicalError, isClinicalError } from '@/lib/clinical-core/validation'
import { canAdmin, canPractice, resolveActor } from '@/lib/clinical-core/capabilities'
import { ADMISSION_CREATING_ACTIONS, ADMISSION_UUID, isAdmissionCommand, isAdmissionResult, isAdmissionWorkspace } from '@/lib/clinical-admission/transport'
import { isDurableClinicalRuntime } from '@/lib/clinical-local/runtime'
import { contextOf, localIdentity, localJson, localRpc } from '@/lib/clinical-local/http'

const ownClinicalActions = new Set(['capacities.create','capacities.update','preferences.update','assignments.result'])
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
export async function handleLocalAdmission(request: Request, segments: string[]): Promise<Response> {
  if (!isDurableClinicalRuntime()) return localJson({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
  try {
    const { runtime, token, actor } = await localIdentity(request)
    const context = contextOf(request)
    let caller
    try { caller = resolveActor(actor, { actorId: actor.id, context }) }
    catch { throw new ClinicalError(403, 'FORBIDDEN', 'Cet espace n’est pas autorisé pour ce compte.') }
    if (!canAdmin(caller) && !canPractice(caller)) throw new ClinicalError(403, 'FORBIDDEN', 'Cet espace n’est pas autorisé pour ce compte.')
    if (request.method === 'GET' && segments.length === 0) {
      const payload = await localRpc<unknown>(runtime, token, 'lab_admission_query', { p_context: context, p_action: 'workspace', p_id: null })
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'workspace')
        || !isAdmissionWorkspace((payload as Record<string, unknown>).workspace, actor.id, context)) throw new ClinicalError(502, 'INVALID_RESPONSE', 'La projection d’admission n’a pas pu être confirmée.')
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_RESPONSE_BYTES) throw new ClinicalError(503, 'ADMISSION_VOLUME_EXCEEDED', 'Le volume des admissions dépasse la projection autorisée. Aucun résultat partiel n’est affiché.')
      return localJson(payload)
    }
    if (request.method !== 'POST' || segments.length !== 1 || segments[0] !== 'commands') return localJson({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new ClinicalError(400, 'INVALID_INPUT', 'Un contenu JSON est requis.')
    const command = await readBoundedJsonObject(request, 96 * 1024)
    if (!isAdmissionCommand(command)) throw new ClinicalError(400, 'INVALID_INPUT', 'La commande d’admission est invalide.')
    if (!canAdmin(caller) && !ownClinicalActions.has(command.action)) throw new ClinicalError(403, 'FORBIDDEN', 'Cette action exige l’espace Administration.')
    if (!canAdmin(caller) && ((command.action === 'capacities.create' && command.data.professionalId != null && command.data.professionalId !== actor.id)
      || (command.action === 'preferences.update' && command.id !== actor.id))) throw new ClinicalError(403, 'FORBIDDEN', 'Cette action est réservée à votre propre profil.')
    const key = request.headers.get('Idempotency-Key')
    if (!key || !ADMISSION_UUID.test(key)) throw new ClinicalError(400, 'IDEMPOTENCY_REQUIRED', 'Une clé de reprise est requise pour cette opération.')
    const payload = await localRpc<unknown>(runtime, token, 'lab_admission_command', { p_context: context, p_action: command.action, p_id: command.id, p_data: command.data, p_request_key: key })
    if (!isAdmissionResult(payload, actor.id, context)) throw new ClinicalError(502, 'INVALID_RESPONSE', 'Le résultat d’admission n’a pas pu être confirmé. Conservez votre saisie avant de réessayer.')
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_RESPONSE_BYTES) throw new ClinicalError(503, 'ADMISSION_VOLUME_EXCEEDED', 'Le résultat dépasse la projection autorisée. Conservez votre saisie ; aucun résultat partiel n’est affiché.')
    return localJson(payload, ADMISSION_CREATING_ACTIONS.has(command.action) ? 201 : 200)
  } catch (error) {
    if (error instanceof JsonBodyError) return localJson({ error: 'Le contenu JSON est invalide ou dépasse la taille permise.', code: 'INVALID_BODY' }, error.status)
    if (isClinicalError(error)) return localJson({ error: error.message, code: error.code }, error.status)
    if (request.method === 'POST' && error instanceof Error && error.name === 'TimeoutError') return localJson({ error: 'La réponse a dépassé le délai. Le résultat de cette opération reste à vérifier avant de la reprendre.', code: 'RESULT_UNCONFIRMED' }, 504)
    return localJson({ error: 'Le stockage d’admission local est indisponible. Aucun état mémoire de secours n’est utilisé.', code: 'LOCAL_UNAVAILABLE' }, 503)
  }
}
