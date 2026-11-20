import type { ClinicalActorInput } from '@/lib/clinical-core/types'
import { clinicalRequest, ClinicalApiError } from '@/lib/clinical-workspace/api'
import type { AdmissionAction, AdmissionCommandResult, AdmissionWorkspace } from './types'
import { isAdmissionCommand, isAdmissionResult, isAdmissionWorkspace } from '@/lib/clinical-admission/transport'

const identity = (actor: ClinicalActorInput) => typeof actor === 'string' ? actor : actor.actorId
const context = (actor: ClinicalActorInput) => typeof actor === 'string' ? undefined : actor.context
export async function fetchAdmission(actor: ClinicalActorInput, signal?: AbortSignal): Promise<AdmissionWorkspace> {
  const payload = await clinicalRequest<{ workspace: AdmissionWorkspace }>(actor, '/admission', undefined, 'GET', signal, undefined,
    value => Boolean(value && typeof value === 'object' && Object.keys(value).length === 1 && Object.hasOwn(value, 'workspace') && isAdmissionWorkspace((value as Record<string, unknown>).workspace, identity(actor), context(actor))))
  return payload.workspace
}
export async function commandAdmission(actor: ClinicalActorInput, action: AdmissionAction, id: string | null, data: Record<string, unknown>): Promise<AdmissionCommandResult> {
  const command = { action, id, data }
  if (!isAdmissionCommand(command)) throw new ClinicalApiError('La commande d’admission est invalide.', 400, 'INVALID_INPUT')
  return clinicalRequest<AdmissionCommandResult>(actor, '/admission/commands', command, 'POST', undefined, undefined,
    value => isAdmissionResult(value, identity(actor), context(actor)))
}
