import { isDurableClinicalRuntime } from '@/lib/clinical-local/runtime'
import { contextOf, localIdentity, localJson, localRpc } from '@/lib/clinical-local/http'
import { ClinicalError, isClinicalError } from '@/lib/clinical-core/validation'
import { ClinicalNotesAiError, readClinicalNotesBody } from '@/lib/clinicalNotesAiServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function identity(request: Request) {
  if (!isDurableClinicalRuntime()) throw new ClinicalError(404, 'NOT_FOUND', 'Ressource introuvable.')
  const { runtime: local, token, actor } = await localIdentity(request)
  if (contextOf(request) !== 'clinical' || !actor.capabilities.includes('practice')) {
    throw new ClinicalError(403, 'FORBIDDEN', 'Cette rencontre clinique n’est pas autorisée pour ce compte.')
  }
  const appointmentId = new URL(request.url).searchParams.get('appointmentId') ?? ''
  if (!uuid.test(appointmentId)) throw new ClinicalError(400, 'INVALID_INPUT', 'Rencontre invalide.')
  return { local, token, appointmentId }
}

function failure(error: unknown) {
  if (isClinicalError(error)) return localJson({ error: error.message, code: error.code }, error.status)
  if (error instanceof ClinicalNotesAiError) return localJson({ error: error.message }, error.status)
  return localJson({ error: 'Le registre des accords est indisponible. Aucun contenu clinique n’a été traité.' }, 503)
}

export async function GET(request: Request) {
  if (process.env.PEA_CLINICAL_RUNTIME === 'real-db') {
    const { handleUnifiedNoteAssistance } = await import('@/lib/clinical-unification/noteAssistanceHttp')
    return handleUnifiedNoteAssistance(request, true)
  }
  try {
    const { local, token, appointmentId } = await identity(request)
    return localJson(await localRpc(local, token, 'lab_ai_encounter_consent',
      { p_context: 'clinical', p_action: 'read', p_appointment_id: appointmentId }))
  } catch (error) { return failure(error) }
}

export async function POST(request: Request) {
  if (process.env.PEA_CLINICAL_RUNTIME === 'real-db') {
    const { handleUnifiedNoteAssistance } = await import('@/lib/clinical-unification/noteAssistanceHttp')
    return handleUnifiedNoteAssistance(request, true)
  }
  try {
    const { local, token, appointmentId } = await identity(request)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
      throw new ClinicalError(415, 'INVALID_INPUT', 'Un contenu JSON est requis.')
    }
    const raw = await readClinicalNotesBody(request, 5000)
    let input: unknown
    try { input = JSON.parse(raw.toString('utf8')) } catch { throw new ClinicalError(400, 'INVALID_INPUT', 'Attestation invalide.') }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ClinicalError(400, 'INVALID_INPUT', 'Attestation invalide.')
    const { action, ...data } = input as Record<string, unknown>
    if (action !== 'attest' && action !== 'withdraw') throw new ClinicalError(400, 'INVALID_INPUT', 'Action invalide.')
    return localJson(await localRpc(local, token, 'lab_ai_encounter_consent',
      { p_context: 'clinical', p_action: action, p_appointment_id: appointmentId, p_data: data }))
  } catch (error) { return failure(error) }
}
