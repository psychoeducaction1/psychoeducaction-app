import { createHash } from 'node:crypto'
import { JsonBodyError, readBoundedJsonObject } from '../boundedJsonBody.ts'
import { ClinicalError, isClinicalError, object, uuid, version, text, date, noteType, content } from '../clinical-core/validation.ts'
import { clientDocumentBytes, isClientOverview, validClientPerson, validClientProfile } from '../clinical-local/clientDetailsRoute.ts'
import { createUnifiedWorkspaceReader } from './workspace.ts'
import type { UnifiedHttpContext } from './http.ts'
import { unifiedPriorNote } from './priorNote.ts'
import { isImportedServices } from '../clinical-mandates/importService.ts'

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Cookie, X-Clinical-Context' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
const invalid = (): never => { throw new ClinicalError(400, 'INVALID_INPUT', 'Vérifiez les renseignements saisis.') }
const failure = (): never => { throw new ClinicalError(502, 'INVALID_RESPONSE', 'La réponse du dossier n’a pas pu être vérifiée.') }
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Original laboratory download contract; verifies every archived byte before serving it. */
export function unifiedDocumentResponse(value: unknown, id: string, note = false): Response {
  if (!plain(value) || typeof value.bytesBase64 !== 'string' || value.bytesBase64.length > 28_000_000
    || typeof value.sha256 !== 'string' || !Number.isSafeInteger(value.byteLength)
    || (!note && (value.id !== id || typeof value.fileName !== 'string' || !value.fileName.trim() || value.fileName.length > 180
      || /[\x00-\x1f\x7f\\/]/.test(value.fileName)))) return failure()
  const bytes = Buffer.from(value.bytesBase64, 'base64')
  const media = note ? 'application/pdf' : value.mediaType
  if (!bytes.length || bytes.length !== value.byteLength || bytes.toString('base64') !== value.bytesBase64
    || createHash('sha256').update(bytes).digest('hex') !== value.sha256
    || (media === 'application/pdf' ? bytes.subarray(0, 5).toString('ascii') !== '%PDF-'
      : media === 'image/png' ? bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        : media === 'image/jpeg' ? bytes.subarray(0, 3).toString('hex') !== 'ffd8ff' : true)) return failure()
  const fileName = note ? `note-${id}.pdf` : value.fileName as string
  return new Response(Uint8Array.from(bytes), { headers: { ...headers, 'Content-Type': String(media),
    'Content-Length': String(bytes.length), 'Content-Disposition': `${note ? 'inline' : 'attachment'}; filename="document-${id}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/'/g, '%27')}`,
    'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Document-SHA256': value.sha256 } })
}

/** All calls keep the caller's verified JWT. SQL resolves patient/case access;
 * neither route parameters nor UI role labels confer a right. */
export async function handleUnifiedClients(request: Request, segments: string[], identity: UnifiedHttpContext): Promise<Response | null> {
  const [area, id, action, target, nativeContext, download] = segments
  if (!['clients', 'records', 'notes', 'note-templates'].includes(area ?? '')) return null
  const { token, context, transport } = identity
  const reader = createUnifiedWorkspaceReader(transport)
  const rpc = (name: string, args: Record<string, unknown>) => transport.rpc(name, args, token)
  try {
    if (area === 'records' && action === 'appointments' && nativeContext === 'transcript' && segments.length === 5) {
      if (context !== 'clinical') throw new ClinicalError(403, 'FORBIDDEN', 'Accès clinique requis.')
      if (new URL(request.url).search) invalid()
      uuid(id); uuid(target)
      const args = { p_context: context, p_case_id: id, p_appointment_id: target }
      if (request.method === 'GET') return json(await rpc('clinical_unified_encounter_transcript', { ...args, p_action: 'read' }))
      if (request.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) invalid()
      const data = await readBoundedJsonObject(request, 1_100_000)
      object(data, ['expectedVersion','text','reviewed'])
      if (Object.keys(data).length !== 3 || !Number.isSafeInteger(data.expectedVersion) || Number(data.expectedVersion)<0 || typeof data.text!=='string' || !data.text.trim() || data.text.length>250000 || typeof data.reviewed!=='boolean') invalid()
      return json(await rpc('clinical_unified_encounter_transcript', { ...args, p_action: 'save', p_data: data, p_key: uuid(request.headers.get('Idempotency-Key')) }))
    }
    if (area === 'note-templates') {
      if (context !== 'clinical') throw new ClinicalError(403, 'FORBIDDEN', 'Ces gabarits sont réservés à votre espace clinique.')
      if (segments.length !== 1 || new URL(request.url).search) invalid()
      if (request.method === 'GET') return json(await rpc('clinical_unified_note_template_query', { p_context: context }))
      if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405)
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) invalid()
      const data = await readBoundedJsonObject(request, 98_304)
      object(data, ['id', 'expectedVersion', 'title', 'noteType', 'document', 'archived'])
      if (Object.keys(data).length !== 6 || !Number.isSafeInteger(data.expectedVersion)
        || Number(data.expectedVersion) < (data.id === null ? 0 : 1) || typeof data.archived !== 'boolean') invalid()
      if (data.id !== null) uuid(data.id)
      text(data.title, 120); noteType(data.noteType); text(data.document, 24000)
      const templateKey = uuid(request.headers.get('Idempotency-Key'))
      return json(await rpc('clinical_unified_note_template_command', { p_context: context, p_data: data, p_key: templateKey }), 201)
    }
    if (id) uuid(id)
    if (area === 'clients' && action === 'import-service' && segments.length === 3) {
      if (new URL(request.url).search) invalid()
      if (request.method === 'GET') {
        const result = await rpc('clinical_unified_import_services', { p_context: context, p_patient_id: id })
        if (!isImportedServices(result, id)) return failure()
        return json(result)
      }
      if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405)
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) invalid()
      const data = await readBoundedJsonObject(request, 4096)
      object(data, ['caseId', 'revisionId', 'expectedVersion', 'serviceId', 'serviceDate'])
      if (Object.keys(data).length !== 5) invalid()
      uuid(data.caseId); uuid(data.revisionId); uuid(data.serviceId); version(data.expectedVersion); date(data.serviceDate)
      const result = await rpc('clinical_unified_complete_import_service', { p_context: context, p_patient_id: id,
        p_data: data, p_key: uuid(request.headers.get('Idempotency-Key')) })
      if (!plain(result) || result.clientId !== id || result.caseId !== data.caseId || result.revisionId !== data.revisionId
          || typeof result.mandateId !== 'string' || !/^[0-9a-f-]{36}$/i.test(result.mandateId)
          || !Number.isSafeInteger(result.version) || Number(result.version) <= Number(data.expectedVersion)
          || typeof result.ready !== 'boolean' || ![null, 'identity', 'payer'].includes(result.prerequisite as string | null)
          || result.ready !== (result.prerequisite === null)) return failure()
      return json(result)
    }
    const administrativeAction = area === 'clients' && request.method === 'POST' && segments.length === 1 ? 'clients.create'
      : area === 'clients' && request.method === 'PATCH' && segments.length === 2 ? 'clients.update'
        : area === 'clients' && request.method === 'POST' && segments.length === 3 && ['contacts', 'representatives', 'payers', 'requests', 'episodes'].includes(action) ? `clients.${action}`
          : area === 'clients' && request.method === 'PATCH' && segments.length === 4 && action === 'payers' ? 'clients.payers.update'
            : area === 'records' && request.method === 'POST' && segments.length === 1 ? 'records.create' : null
    if (administrativeAction) {
      if (context !== 'administration') throw new ClinicalError(403, 'FORBIDDEN', 'La gestion administrative exige le contexte administratif.')
      if (new URL(request.url).search || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) invalid()
      const data = await readBoundedJsonObject(request, 32_768)
      if (administrativeAction === 'clients.payers.update') {
        if (Object.hasOwn(data, 'id')) invalid()
        data.id = uuid(target)
        version(data.expectedVersion)
      }
      const key = uuid(request.headers.get('Idempotency-Key'))
      const patientId = administrativeAction === 'records.create' ? uuid(data.clientId) : id ?? null
      return json(await rpc('clinical_unified_admin_command', { p_context: context, p_action: administrativeAction, p_patient_id: patientId, p_data: data, p_key: key }), request.method === 'POST' ? 201 : 200)
    }
    if (area === 'records' && action === 'access' && segments.length === 3 && request.method === 'PATCH') {
      if (context !== 'administration') throw new ClinicalError(403, 'FORBIDDEN', 'La gestion des accès exige le contexte administratif.')
      if (new URL(request.url).search || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) invalid()
      const data = await readBoundedJsonObject(request, 16_384)
      object(data, ['expectedRevision', 'members']); version(data.expectedRevision)
      if (!Array.isArray(data.members) || data.members.length > 20) invalid()
      const seen = new Set<string>()
      for (const member of data.members as unknown[]) {
        const grant = object(member, ['actorId', 'canRead', 'canWrite', 'canCosign', 'requiresCosignature', 'supervisorId'])
        const actor = uuid(grant.actorId)
        if (seen.has(actor) || ['canRead', 'canWrite', 'canCosign', 'requiresCosignature'].some(field => typeof grant[field] !== 'boolean')) invalid()
        seen.add(actor)
        if (grant.supervisorId !== null) uuid(grant.supervisorId)
      }
      const key = uuid(request.headers.get('Idempotency-Key'))
      return json(await rpc('clinical_unified_replace_access', { p_context: context, p_case_id: id, p_data: data, p_key: key }))
    }
    if (request.method === 'GET') {
      if (area === 'records' && action === 'prior-note' && segments.length === 4) {
        if (context !== 'clinical') throw new ClinicalError(403, 'FORBIDDEN', 'Accès clinique requis.')
        uuid(target)
        if (new URL(request.url).search) invalid()
        return json(await unifiedPriorNote(transport, token, id, target))
      }
      if (area === 'clients' && action === 'overview' && segments.length === 3) {
        const result = { overview: await reader.clientOverview(token, context, id) }
        if (!isClientOverview(result, id, context)) return failure()
        return json(result)
      }
      if (area === 'clients' && action === 'documents' && segments.length === 6 && download === 'download') {
        if (nativeContext !== context || new URL(request.url).search) throw new ClinicalError(403, 'FORBIDDEN', 'Accès à ce document refusé.')
        uuid(target)
        return unifiedDocumentResponse(await rpc('clinical_unified_client_document', { p_patient_id: id, p_context: context, p_document_id: target }), target)
      }
      if (area === 'records' && segments.length === 2) return json({ record: await rpc('clinical_unified_record', { p_case_id: id, p_context: context }) })
      if ((area === 'notes' || area === 'records' && action === 'appointments') && context !== 'clinical') throw new ClinicalError(403, 'FORBIDDEN', 'Accès clinique requis.')
      if (area === 'records' && action === 'appointments' && segments.length === 3) return json({ appointments: await rpc('clinical_list_note_appointments', { p_case_id: id }) })
      if (area === 'notes' && segments.length === 2) return json({ note: await rpc('clinical_read_note', { p_note_id: id }) })
      if (area === 'notes' && action === 'pdf' && segments.length === 3) return unifiedDocumentResponse(await rpc('clinical_unified_note_pdf', { p_note_id: id, p_context: context }), id, true)
      if (area === 'notes' && action === 'signatures' && segments.length === 3) return json(await rpc('clinical_unified_note_signatures', { p_note_id: id, p_context: context }))
      return null
    }
    let command: string | null = null
    let targetId: string | null = null
    const post = request.method === 'POST', patch = request.method === 'PATCH', remove = request.method === 'DELETE'
    if (area === 'clients' && action === 'profile' && patch && segments.length === 3) command = 'profile.update'
    if (area === 'clients' && action === 'people') {
      if (post && segments.length === 3) command = 'person.create'
      if ((patch || remove) && segments.length === 4) { targetId = uuid(target); command = remove ? 'person.remove' : 'person.update' }
    }
    if (area === 'clients' && action === 'documents' && post && segments.length === 3) command = 'document.create'
    if (area === 'records' && post && segments.length === 3 && ['close', 'reopen-request', 'reopen'].includes(action)) command = `record.${action}`
    if (area === 'records' && post && segments.length === 3 && action === 'notes') command = 'notes.create'
    if (area === 'notes' && segments.length === 2 && (patch || remove)) command = remove ? 'notes.remove' : 'notes.save'
    if (area === 'notes' && post && segments.length === 3 && ['sign', 'cosign', 'amend'].includes(action)) command = `notes.${action}`
    if (!command) return null
    if (command.startsWith('notes.') && context !== 'clinical') throw new ClinicalError(403, 'FORBIDDEN', 'Accès clinique requis.')
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) invalid()
    const key = uuid(request.headers.get('Idempotency-Key'))
    const data = await readBoundedJsonObject(request, command === 'document.create' ? 1_450_000 : 98_304)
    if (command === 'profile.update' && !validClientProfile(data)) invalid()
    if (command.startsWith('person.') && command !== 'person.remove' && !validClientPerson(data, patch)) invalid()
    if (command === 'person.remove' || command === 'notes.remove') { object(data, ['expectedVersion']); version(data.expectedVersion) }
    if (command === 'document.create') clientDocumentBytes(data)
    if (command.startsWith('record.')) {
      version(data.expectedVersion)
      if (command === 'record.close' && context === 'clinical') {
        if (data.closureMode === 'note') {
          object(data, ['expectedVersion', 'closureMode', 'noteText', 'attested']); text(data.noteText, 24000)
          if (data.attested !== true) invalid()
        } else if (data.closureMode === 'no_encounter') { object(data, ['expectedVersion', 'closureMode', 'reason']); text(data.reason, 1000) }
        else invalid()
      } else { object(data, ['expectedVersion', 'reason']); text(data.reason, 1000) }
    }
    if (command === 'notes.create') {
      object(data, ['noteType', 'title', 'encounterDate', 'content', 'appointmentId'])
      content(data.content, noteType(data.noteType)); text(data.title, 200); date(data.encounterDate)
      if (data.appointmentId != null) uuid(data.appointmentId)
    }
    if (command === 'notes.save') {
      object(data, ['expectedVersion', 'title', 'encounterDate', 'content']); version(data.expectedVersion)
      if (data.title !== undefined) text(data.title, 200)
      if (data.encounterDate !== undefined) date(data.encounterDate)
      // The real note type is checked in SQL against stored note_templates.
      if (!plain(data.content) || Object.values(data.content).some(value => typeof value !== 'string')) invalid()
    }
    if (command === 'notes.sign' || command === 'notes.cosign') {
      object(data, ['expectedVersion', 'attested']); version(data.expectedVersion); if (data.attested !== true) invalid()
    }
    if (command === 'notes.amend') {
      object(data, ['expectedVersion', 'reason']); version(data.expectedVersion)
      if (!['correction', 'clarification', 'supplement'].includes(String(data.reason))) invalid()
    }
    const result = await rpc('clinical_unified_command', { p_context: context, p_action: command, p_id: id, p_target: targetId, p_data: data, p_key: key })
    if (!plain(result)) failure()
    return json(result, post && !['notes.sign', 'notes.cosign'].includes(command) ? 201 : 200)
  } catch (error) {
    const transcriptMessages: Record<string,string> = { TRANSCRIPT_VERSION_CONFLICT: 'La transcription a été modifiée ailleurs. Rouvrez la note avant de poursuivre pour éviter d’écraser cette modification.', TRANSCRIPT_SIGNED_NOTE_LOCKED: 'La note est déjà signée. Sa transcription enregistrée est conservée et ne peut plus être modifiée.', TRANSCRIPT_OPERATION_CONFLICT: 'Cette opération de transcription ne correspond plus au texte affiché. Rouvrez la note.', TRANSCRIPT_INVALID: 'La transcription est vide ou dépasse la taille permise.' }
    const transcriptCode = plain(error) && typeof error.code==='string' ? error.code : ''
    if (Object.hasOwn(transcriptMessages,transcriptCode)) return json({error:transcriptMessages[transcriptCode],code:transcriptCode},409)
    if (error instanceof JsonBodyError) return json({ error: 'Le contenu est invalide ou dépasse la taille permise.', code: 'INVALID_BODY' }, error.status)
    if (isClinicalError(error)) return json({ error: error.message, code: error.code }, error.status)
    throw error
  }
}
