import { BROWSER_TRANSCRIPTION_ASSETS } from '../clinical-workspace/browserAssets.ts'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { authenticateUnifiedRequest, UnifiedAuthenticationError } from './auth.ts'
import { unifiedListenerRequest, unifiedHttpFailure, unifiedJson } from './http.ts'
import type { UnifiedHttpContext } from './http.ts'
import { realClinicalTransport } from '../clinical-real/transport.ts'
import { ClinicalError, isClinicalError, uuid } from '../clinical-core/validation.ts'
import { readBoundedJsonObject } from '../boundedJsonBody.ts'
import { ClinicalNotesAiError, isClinicalNotesAiEnabled, requestClinicalStructured } from '../clinicalNotesAiServer.ts'
import { preparedBrowserAssistanceInput } from '../clinical-workspace/noteAssistance.ts'
import { prepareTranscriptForDraft } from '../clinical-workspace/transcriptQuality.ts'
import { contextualClinicalIdentifiers, deidentifyClinicalSources, knownClinicalIdentifiers } from '../clinical-workspace/deidentify.ts'
import type { KnownClinicalPerson } from '../clinical-workspace/deidentify.ts'
import { generateClinicalEngine } from '../clinicalNoteEngineServer.ts'
import { ClinicalFidelityError } from '../clinicalNoteValidationServer.ts'
import { clinicalTemplateFocus, isNoteTemplateList } from '../clinical-workspace/noteTemplates.ts'
import { clinicalNoteDisciplineFromTitle } from '../clinicalNoteDiscipline.ts'
import { LOCAL_WHISPER_MAX_BYTES } from '../clinical-local/whisperPilot.ts'
import type { ClinicalSources } from '../clinicalNoteEngine.ts'
import { unifiedPriorNote } from './priorNote.ts'

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function invalid(): never { throw new ClinicalError(400, 'INVALID_INPUT', 'Rencontre ou texte invalide.') }
type Engine = typeof generateClinicalEngine
type Options = { engine?: Engine; draftingEnabled?: boolean; browserAvailable?: boolean }

/** Same original UI contract and engine. Dependency injection is for offline tests only. */
export async function unifiedNoteAssistance(request: Request, identity: UnifiedHttpContext, consentOnly = false, options: Options = {}) {
  let sanitizedSources: ClinicalSources | undefined
  try {
    if (identity.context !== 'clinical') throw new UnifiedAuthenticationError(403, 'FORBIDDEN')
    const { token, transport } = identity
    const rpc = (name: string, args: Record<string, unknown>) => transport.rpc(name, args, token)
    const url = new URL(request.url), appointmentId = uuid(url.searchParams.get('appointmentId'))
    if (consentOnly) {
      if (request.method === 'GET') return unifiedJson(await rpc('clinical_unified_ai_consent', {
        p_context: 'clinical', p_action: 'read', p_appointment_id: appointmentId,
      }))
      if (request.method !== 'POST' || !request.headers.get('Content-Type')?.startsWith('application/json')) invalid()
      // Authorization precedes parsing of participant names.
      await rpc('clinical_unified_ai_consent', { p_context: 'clinical', p_action: 'read', p_appointment_id: appointmentId })
      const { action, ...data } = await readBoundedJsonObject(request, 5000)
      if (action !== 'attest' && action !== 'withdraw') invalid()
      return unifiedJson(await rpc('clinical_unified_ai_consent', {
        p_context: 'clinical', p_action: action, p_appointment_id: appointmentId, p_data: data,
      }))
    }
    const recordId = uuid(url.searchParams.get('recordId'))
    const context = await rpc('clinical_unified_ai_context', { p_appointment_id: appointmentId })
    if (!object(context) || context.caseId !== recordId || context.appointmentId !== appointmentId
      || typeof context.clientName !== 'string' || !Array.isArray(context.representatives) || !Array.isArray(context.participants)) {
      throw new UnifiedAuthenticationError(403, 'ENCOUNTER_MISMATCH')
    }
    let existingType: string | null = null
    const noteId = url.searchParams.get('noteId')
    if (noteId) {
      const result = await rpc('clinical_read_note', { p_note_id: uuid(noteId) })
      const note = object(result) && object(result.note) ? result.note : null
      if (!note || note.recordId !== recordId || note.appointmentId !== appointmentId
        || note.authorId !== context.professionalId || note.status !== 'draft') throw new UnifiedAuthenticationError(403, 'NOTE_FORBIDDEN')
      existingType = String(note.noteType)
    }
    const draftingEnabled = options.draftingEnabled ?? (process.env.PEA_REAL_AI_SERVER_ENABLED === 'true' && isClinicalNotesAiEnabled())
    const browser = options.browserAvailable ?? (process.env.NEXT_PUBLIC_PEA_BROWSER_TRANSCRIPTION_READY === 'true'
      || BROWSER_TRANSCRIPTION_ASSETS.every(file => existsSync(join(process.cwd(), 'public/clinical-model', file))))
    if (request.method === 'GET') return unifiedJson({ enabled: browser || draftingEnabled, draftingEnabled,
      transcriptionEngine: browser ? 'browser' : 'unavailable', languageEngineReady: false,
      maxAudioBytes: browser ? LOCAL_WHISPER_MAX_BYTES : 0 })
    if (request.method !== 'POST' || !request.headers.get('Content-Type')?.startsWith('application/json')) invalid()
    if (context.ready !== true) throw new ClinicalError(409, 'ENCOUNTER_CONSENT_REQUIRED', 'Accord requis pour cette rencontre.')
    const input = preparedBrowserAssistanceInput(await readBoundedJsonObject(request, 1_500_000))
    if (!input) invalid()
    if (existingType && existingType !== input.noteType) throw new ClinicalError(409, 'NOTE_TYPE_CHANGED', 'Le type de la note a changé.')
    const quality = prepareTranscriptForDraft(input.sources.transcript)
    if (!quality.text) throw new ClinicalError(422, 'TRANSCRIPT_UNRELIABLE', 'La transcription ne contient aucun passage exploitable.')
    const people = [...context.representatives, ...context.participants].filter((person): person is KnownClinicalPerson =>
      object(person) && typeof person.name === 'string' && typeof person.role === 'string')
    const known = knownClinicalIdentifiers(context.clientName, people)
    if (!known) invalid()
    const history = (await unifiedPriorNote(transport, token, recordId, appointmentId)).text
    const initial = deidentifyClinicalSources({ ...input.sources, transcript: quality.text, history }, known)
    const candidates = contextualClinicalIdentifiers(initial.sources)
    if (!candidates) invalid()
    const sanitized = deidentifyClinicalSources(initial.sources, candidates)
    const remaining = contextualClinicalIdentifiers(sanitized.sources)
    if (sanitized.residualDirectIdentifiers || !sanitized.sources.transcript.trim() || !remaining || remaining.length
      || deidentifyClinicalSources(sanitized.sources, known).replacementCount) {
      throw new ClinicalError(400, 'IDENTIFIER_REMAINS', 'Le texte préparé contient encore un identifiant.')
    }
    sanitizedSources = sanitized.sources
    let focus: string[] = []
    if (input.templateId?.startsWith('personal:')) {
      const id = uuid(input.templateId.slice(9))
      const templates = await rpc('clinical_unified_note_template_query', { p_context: 'clinical' })
      if (!isNoteTemplateList(templates)) throw new ClinicalError(503, 'TEMPLATE_UNAVAILABLE', 'Les gabarits sont indisponibles.')
      const chosen = templates.templates.find(item => item.id === id && !item.archived && item.noteType === input.noteType)
      if (!chosen) throw new ClinicalError(409, 'TEMPLATE_CHANGED', 'Le gabarit choisi a changé.')
      focus = clinicalTemplateFocus(input.noteType, chosen.document)
    } else if (input.templateId && input.templateId !== input.noteType) invalid()
    const profile = await rpc('clinical_unified_professional_query', { p_context: 'clinical', p_professional_id: context.professionalId })
    const professional = object(profile) && object(profile.professional) ? profile.professional : null
    if (!professional || professional.id !== context.professionalId) throw new UnifiedAuthenticationError(403, 'PROFESSIONAL_FORBIDDEN')
    if (!draftingEnabled) return unifiedJson({ code: 'AI_DISABLED', error: 'La rédaction externe est désactivée sur cette copie isolée.' }, 503)
    const result = await (options.engine ?? generateClinicalEngine)(sanitized.sources, input.noteType, request.signal,
      'real-private', requestClinicalStructured, clinicalNoteDisciplineFromTitle(typeof professional.title === 'string' ? professional.title : null), focus)
    return unifiedJson({ result, sources: sanitized.sources })
  } catch (error) {
    if (error instanceof ClinicalFidelityError) return unifiedJson({ error: error.message, result: error.candidate,
      sources: sanitizedSources, alerts: error.alerts, requiresCorrection: true }, error.status)
    if (isClinicalError(error)) return unifiedJson({ error: error.message, code: error.code }, error.status)
    if (error instanceof ClinicalNotesAiError) return unifiedJson({ error: error.message }, error.status)
    return unifiedHttpFailure(error)
  }
}

export async function handleUnifiedNoteAssistance(request: Request, consentOnly = false) {
  try {
    request = unifiedListenerRequest(request)
    const transport = realClinicalTransport()
    const identity = await authenticateUnifiedRequest(request, transport)
    return unifiedNoteAssistance(request, { ...identity, transport }, consentOnly)
  } catch (error) { return unifiedHttpFailure(error) }
}
