import { isDurableClinicalRuntime, isLocalClinicalRuntime, isStagingClinicalRuntime, readOpenAiPilotConfig } from '@/lib/clinical-local/runtime'
import { contextOf, localIdentity, localJson, localResponseHeaders, localRpc } from '@/lib/clinical-local/http'
import { ClinicalError, isClinicalError } from '@/lib/clinical-core/validation'
import type { ClinicalAppointmentSnapshot, ClinicalNoteView, ClinicalRecordView } from '@/lib/clinical-core/types'
import { CLINICAL_TRANSCRIPT_MAX_CHARS, detectClinicalAudio } from '@/lib/clinicalNotesAi'
import { ClinicalNotesAiError, isClinicalNotesAiEnabled, readClinicalNotesBody } from '@/lib/clinicalNotesAiServer'
import { generateClinicalEngine } from '@/lib/clinicalNoteEngineServer'
import { ClinicalFidelityError } from '@/lib/clinicalNoteValidationServer'
import { LOCAL_WHISPER_MAX_BYTES, localWhisperPilot, transcribeLocalWhisper } from '@/lib/clinical-local/whisperPilot'
import { confirmedClinicalAssistanceInput, preparedBrowserAssistanceInput } from '@/lib/clinical-workspace/noteAssistance'
import { contextualClinicalIdentifiers, deidentifyClinicalSources, dossierClinicalPeople, knownClinicalIdentifiers } from '@/lib/clinical-workspace/deidentify'
import type { KnownClinicalPerson } from '@/lib/clinical-workspace/deidentify'
import { clinicalTemplateFocus, isNoteTemplateList } from '@/lib/clinical-workspace/noteTemplates'
import { LOCAL_NOTE_TRANSCRIPT_MAX_CHARS } from '@/lib/clinical-workspace/transcriptReview'
import { prepareTranscriptForDraft } from '@/lib/clinical-workspace/transcriptQuality'
import { analyzeLocalLanguage, localLanguageEngineConfig, uncoveredLocalCandidates } from '@/lib/clinical-local/languageEngine'
import { clinicalNoteDisciplineFromTitle } from '@/lib/clinicalNoteDiscipline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Bound the fictional hosted drafting request as well as the local laboratory route.
export const maxDuration = 300
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function authorize(request: Request) {
  if (!isDurableClinicalRuntime()) throw new ClinicalError(404, 'NOT_FOUND', 'Ressource introuvable.')
  const { runtime: local, token, actor } = await localIdentity(request)
  if (contextOf(request) !== 'clinical' || !actor.capabilities.includes('practice')) throw new ClinicalError(403, 'FORBIDDEN', 'La rédaction clinique n’est pas autorisée pour ce compte.')
  const url = new URL(request.url)
  const recordId = url.searchParams.get('recordId') ?? ''
  const noteId = url.searchParams.get('noteId') ?? ''
  const appointmentId = url.searchParams.get('appointmentId') ?? ''
  if (!uuid.test(recordId) || !uuid.test(appointmentId) || (noteId && !uuid.test(noteId))) throw new ClinicalError(400, 'INVALID_INPUT', 'Dossier, rencontre ou note invalide.')
  const { record } = await localRpc<{ record: ClinicalRecordView }>(local, token, 'lab_query', { p_context: 'clinical', p_action: 'record', p_id: recordId })
  if (record?.record.id !== recordId || record.record.status !== 'open' || !record.record.members.some(member => member.actorId === actor.id && member.canWrite)) throw new ClinicalError(403, 'FORBIDDEN', 'Ce dossier n’est pas modifiable par ce professionnel.')
  const namedFictional = /ficti(?:f|ve)|fiction/i.test(record.client.firstName + ' ' + record.client.lastName)
  // The hosted database is itself fictional-only, even when a test client has an ordinary pseudonym.
  if (!isStagingClinicalRuntime() && !namedFictional) {
    throw new ClinicalError(403, 'FORBIDDEN', 'L’aide IA est réservée aux dossiers clients fictifs du laboratoire.')
  }
  if (isClinicalNotesAiEnabled()) {
    const pilot = isLocalClinicalRuntime() ? readOpenAiPilotConfig() : { allowAllFictionalRecords: true, allowedRecordIds: [] as string[] }
    const fictionalName = `${record.client.firstName} ${record.client.lastName}`
    if (!pilot || (!isStagingClinicalRuntime() && !/ficti(?:f|ve)|fiction/i.test(fictionalName))
      || !(pilot.allowAllFictionalRecords || pilot.allowedRecordIds.includes(recordId))) {
      throw new ClinicalError(403, 'FORBIDDEN', 'L’aide IA est réservée aux dossiers clients identifiés comme fictifs dans le laboratoire.')
    }
  }
  const { appointments } = await localRpc<{ appointments: ClinicalAppointmentSnapshot[] }>(local, token, 'lab_query',
    { p_context: 'clinical', p_action: 'appointments', p_id: recordId })
  const appointment = appointments?.find(item => item.id === appointmentId && item.recordId === recordId
    && item.clientId === record.client.id && item.professionalId === actor.id
    && (item.status === 'planned' || item.status === 'completed'))
  if (!appointment) throw new ClinicalError(403, 'FORBIDDEN', 'Cette rencontre ne relève pas du dossier et du professionnel autorisés.')
  const consent = await localRpc<{ ready: boolean; recordingReady: boolean; appointmentId: string; recordId: string; participants?: KnownClinicalPerson[] }>(local, token,
    'lab_ai_encounter_consent', { p_context: 'clinical', p_action: 'read', p_appointment_id: appointmentId })
  if (consent?.recordingReady !== true || consent.appointmentId !== appointmentId || consent.recordId !== recordId) {
    throw new ClinicalError(409, 'ENCOUNTER_CONSENT_REQUIRED', 'L’accord pour l’enregistrement et la transcription doit être attesté avant de traiter cette rencontre.')
  }
  let existingType: ClinicalNoteView['note']['noteType'] | null = null
  if (noteId) {
    const { note } = await localRpc<{ note: ClinicalNoteView }>(local, token, 'lab_query', { p_context: 'clinical', p_action: 'note', p_id: noteId })
    if (note?.note.recordId !== recordId || note.note.appointmentId !== appointmentId || note.note.authorId !== actor.id || note.note.status !== 'draft') throw new ClinicalError(403, 'FORBIDDEN', 'Cette note n’est pas un brouillon de cette rencontre modifiable par ce professionnel.')
    existingType = note.note.noteType
  }
  const knownNames = knownClinicalIdentifiers(`${record.client.firstName} ${record.client.lastName}`,
    [...dossierClinicalPeople(record.client), ...(Array.isArray(consent.participants) ? consent.participants : [])])
  if (!knownNames) throw new ClinicalError(400, 'INVALID_INPUT', 'Les personnes de cette rencontre ne peuvent pas être vérifiées.')
  return { existingType, draftingReady: consent.ready === true, knownNames, local, token, actorId: actor.id }
}

function failure(error: unknown) {
  if (isClinicalError(error)) return localJson({ error: error.message, code: error.code }, error.status)
  if (error instanceof ClinicalFidelityError) return localJson({ error: error.message, alerts: error.alerts,
    result: error.candidate, requiresCorrection: true }, error.status)
  if (error instanceof ClinicalNotesAiError) return localJson({ error: error.message }, error.status)
  return localJson({ error: 'L’aide à la rédaction est indisponible. Votre note n’a pas été modifiée.' }, 503)
}

function streamedLocalWork(requestSignal: AbortSignal, work: (signal: AbortSignal) => Promise<unknown>) {
  const encoder = new TextEncoder()
  const cancellation = new AbortController()
  const signal = AbortSignal.any([requestSignal, cancellation.signal])
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(' ')) } catch { clearInterval(heartbeat) } }, 15_000)
      void work(signal).then(
        result => controller.enqueue(encoder.encode(JSON.stringify(result))),
        error => {
          const response = failure(error)
          return response.json().then(body => controller.enqueue(encoder.encode(JSON.stringify(body))))
        },
      ).catch(() => { /* Une connexion interrompue n'expose ni audio ni transcription. */ })
        .finally(() => { clearInterval(heartbeat); try { controller.close() } catch { /* Déjà annulé. */ } })
    },
    cancel() { cancellation.abort() },
  })
  return new Response(stream, { headers: { ...localResponseHeaders, 'Content-Type': 'application/json; charset=utf-8' } })
}

export async function GET(request: Request) {
  if (process.env.PEA_CLINICAL_RUNTIME === 'real-db') {
    const { handleUnifiedNoteAssistance } = await import('@/lib/clinical-unification/noteAssistanceHttp')
    return handleUnifiedNoteAssistance(request)
  }
  try { await authorize(request); const local = Boolean(localWhisperPilot()); const draftingEnabled = isClinicalNotesAiEnabled()
    const browser = (isStagingClinicalRuntime() || isLocalClinicalRuntime()) && !local
    return localJson({ enabled: local || browser || draftingEnabled, draftingEnabled, languageEngineReady: Boolean(localLanguageEngineConfig()),
      transcriptionEngine: local ? 'local' : browser ? 'browser' : 'unavailable', maxAudioBytes: local || browser ? LOCAL_WHISPER_MAX_BYTES : 0 }) }
  catch (error) { return failure(error) }
}

export async function POST(request: Request) {
  if (process.env.PEA_CLINICAL_RUNTIME === 'real-db') {
    const { handleUnifiedNoteAssistance } = await import('@/lib/clinical-unification/noteAssistanceHttp')
    return handleUnifiedNoteAssistance(request)
  }
  try {
    const { existingType, draftingReady, knownNames, local, token, actorId } = await authorize(request)
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.startsWith('multipart/form-data;')) {
      const local = Boolean(localWhisperPilot())
      if (!local) throw new ClinicalNotesAiError('La transcription contrôlée est indisponible. Aucun audio n’a été envoyé au fournisseur externe.', 503)
      const bytes = await readClinicalNotesBody(request, LOCAL_WHISPER_MAX_BYTES + 65_536)
      const form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData()
      if (form.get('fictional') !== 'true') throw new ClinicalError(400, 'FICTIONAL_REQUIRED', 'Confirmez que cet extrait est entièrement fictif.')
      const file = form.get('audio')
      if (!(file instanceof File)) throw new ClinicalError(400, 'INVALID_INPUT', 'Fichier audio manquant.')
      if (!file.size || file.size > LOCAL_WHISPER_MAX_BYTES) throw new ClinicalNotesAiError('Choisissez un audio fictif de moins de 160 Mo.', 413)
      if (!detectClinicalAudio(new Uint8Array(await file.slice(0, 32).arrayBuffer()))) {
        throw new ClinicalNotesAiError('Format non reconnu. Utilisez WAV, MP3, M4A ou WebM.', 400)
      }
      return streamedLocalWork(request.signal, signal => transcribeLocalWhisper(file, signal))
    }
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new ClinicalError(415, 'INVALID_INPUT', 'Un contenu JSON est requis.')
    // The browser sends the prepared text; the server sanitizes its own copy before the external call.
    const raw = await readClinicalNotesBody(request, 1_500_000)
    let input: unknown
    try { input = JSON.parse(raw.toString('utf8')) } catch { throw new ClinicalError(400, 'INVALID_INPUT', 'Le texte fourni est invalide.') }
    if (input && typeof input === 'object' && !Array.isArray(input) && (input as Record<string, unknown>).action === 'generate-browser') {
      if (!isStagingClinicalRuntime() && !isLocalClinicalRuntime()) throw new ClinicalError(403, 'FORBIDDEN', 'Ce parcours est réservé aux laboratoires fictifs.')
      if (!isClinicalNotesAiEnabled()) throw new ClinicalNotesAiError('La rédaction externe n’est pas activée.', 503)
      if (!draftingReady) throw new ClinicalError(409, 'SIGNED_AI_CONSENT_REQUIRED', 'La convention signée comprenant l’aide IA est nécessaire avant l’envoi au rédacteur externe.')
      const prepared = preparedBrowserAssistanceInput(input)
      if (!prepared) throw new ClinicalError(400, 'INVALID_INPUT', 'Le texte préparé est invalide ou contient un identifiant direct.')
      const quality = prepareTranscriptForDraft(prepared.sources.transcript)
      if (!quality.text) throw new ClinicalError(422, 'TRANSCRIPT_UNRELIABLE', 'La transcription ne contient aucun passage exploitable après détection des répétitions. Corrigez-la avant la rédaction.')
      // The browser filter can miss a name. Apply the same local rules again on the server,
      // and send only this sanitized copy to the external drafter.
      const withoutKnownNames = deidentifyClinicalSources({ ...prepared.sources, transcript: quality.text }, knownNames)
      const possibleNames = contextualClinicalIdentifiers(withoutKnownNames.sources)
      if (!possibleNames) throw new ClinicalError(400, 'IDENTIFIER_REMAINS', 'Trop de noms possibles pour préparer le texte. Aucun envoi au rédacteur n’a eu lieu.')
      const sanitized = deidentifyClinicalSources(withoutKnownNames.sources, possibleNames)
      const remainingNames = contextualClinicalIdentifiers(sanitized.sources)
      if (sanitized.residualDirectIdentifiers || !sanitized.sources.transcript.trim() || !remainingNames || remainingNames.length
        || deidentifyClinicalSources(sanitized.sources, knownNames).replacementCount) {
        throw new ClinicalError(400, 'IDENTIFIER_REMAINS', 'Un identifiant demeure dans le texte préparé. Aucun envoi au rédacteur n’a eu lieu.')
      }
      if (existingType && prepared.noteType !== existingType) throw new ClinicalError(409, 'NOTE_TYPE_CHANGED', 'Le type de la note a changé.')
      let templateFocus: string[] = []
      if (prepared.templateId) {
        if (prepared.templateId.startsWith('personal:')) {
          const templateId = prepared.templateId.slice('personal:'.length)
          if (!uuid.test(templateId)) throw new ClinicalError(400, 'INVALID_INPUT', 'Gabarit invalide.')
          const list = await localRpc<unknown>(local, token, 'lab_note_template_query', { p_context: 'clinical' })
          if (!isNoteTemplateList(list)) throw new ClinicalError(503, 'TEMPLATE_UNAVAILABLE', 'Les gabarits ne sont pas accessibles.')
          const chosen = list.templates.find(item => item.id === templateId && !item.archived && item.noteType === prepared.noteType)
          if (!chosen) throw new ClinicalError(409, 'TEMPLATE_CHANGED', 'Le gabarit choisi n’est plus disponible pour cette note.')
          templateFocus = clinicalTemplateFocus(prepared.noteType, chosen.document)
        } else if (prepared.templateId !== prepared.noteType) {
          throw new ClinicalError(409, 'TEMPLATE_CHANGED', 'Le gabarit choisi ne correspond pas au type de la note.')
        }
      }
      const { professional } = await localRpc<{ professional: { id: string; title: string | null } | null }>(local, token,
        'lab_professional_query', { p_context: 'clinical', p_professional_id: actorId })
      if (professional?.id !== actorId) throw new ClinicalError(403, 'FORBIDDEN', 'La fiche du professionnel n’est pas accessible.')
      const discipline = clinicalNoteDisciplineFromTitle(professional.title)
      return streamedLocalWork(request.signal, async signal => ({ result: await generateClinicalEngine(sanitized.sources, prepared.noteType, signal, 'fictional', undefined, discipline, templateFocus) }))
    }
    if (input && typeof input === 'object' && !Array.isArray(input) && (input as Record<string, unknown>).action === 'suggest-identifiers') {
      const body = input as Record<string, unknown>
      if (body.fictional !== true || typeof body.transcript !== 'string' || !body.transcript.trim()
        || body.transcript.length > LOCAL_NOTE_TRANSCRIPT_MAX_CHARS || typeof body.history !== 'string'
        || body.history.length > 8_000 || typeof body.metadata !== 'string' || body.metadata.length > 2_000) {
        throw new ClinicalError(400, 'INVALID_INPUT', 'Les sources fictives à examiner sont invalides.')
      }
      if (!localLanguageEngineConfig()) throw new ClinicalError(503, 'LOCAL_LANGUAGE_UNAVAILABLE', 'Le moteur linguistique local est indisponible.')
      return localJson({ candidates: await analyzeLocalLanguage({ transcript: body.transcript, history: body.history, metadata: body.metadata }, request.signal) })
    }
    if (isStagingClinicalRuntime()) throw new ClinicalError(410, 'LEGACY_NOTE_ASSISTANCE_DISABLED', 'Utilisez la transcription et la préparation dans le navigateur.')
    if (!isClinicalNotesAiEnabled()) throw new ClinicalNotesAiError('La rédaction externe n’est pas activée dans ce laboratoire.', 503)
    if (!draftingReady) throw new ClinicalError(409, 'SIGNED_AI_CONSENT_REQUIRED', 'La convention signée comprenant l’aide IA est nécessaire avant l’envoi au rédacteur externe.')
    const confirmed = confirmedClinicalAssistanceInput(input, localWhisperPilot() || isStagingClinicalRuntime() ? LOCAL_NOTE_TRANSCRIPT_MAX_CHARS : undefined)
    if (!confirmed) throw new ClinicalError(400, 'INVALID_INPUT', 'Vérifiez la transcription et les sources du même dossier fictif.')
    if (existingType && confirmed.noteType !== existingType) throw new ClinicalError(409, 'NOTE_TYPE_CHANGED', 'Le type de la note a changé. Actualisez-la avant de poursuivre.')
    if (localLanguageEngineConfig()) {
      const body = input as Record<string, unknown>
      const candidates = await analyzeLocalLanguage({ transcript: body.transcript as string, history: body.history as string,
        metadata: body.metadata as string }, request.signal)
      const uncovered = uncoveredLocalCandidates(confirmed.sources, candidates, body.retainedLocalEntityTerms ?? [])
      if (!uncovered) throw new ClinicalError(400, 'INVALID_INPUT', 'Les décisions sur les entités locales sont invalides.')
      if (uncovered.length) throw new ClinicalError(409, 'LOCAL_ENTITIES_UNREVIEWED', 'Des entités détectées localement restent à traiter avant l’envoi externe.')
    }
    const { professional } = await localRpc<{ professional: { id: string; title: string | null } | null }>(local, token,
      'lab_professional_query', { p_context: 'clinical', p_professional_id: actorId })
    if (professional?.id !== actorId) throw new ClinicalError(403, 'FORBIDDEN', 'La fiche du professionnel n’est pas accessible.')
    const discipline = clinicalNoteDisciplineFromTitle(professional.title)
    if (confirmed.sources.transcript.length > CLINICAL_TRANSCRIPT_MAX_CHARS) {
      return streamedLocalWork(request.signal, async signal => ({ result: await generateClinicalEngine(confirmed.sources, confirmed.noteType, signal, 'fictional', undefined, discipline) }))
    }
    return localJson({ result: await generateClinicalEngine(confirmed.sources, confirmed.noteType, request.signal, 'fictional', undefined, discipline) })
  } catch (error) { return failure(error) }
}

