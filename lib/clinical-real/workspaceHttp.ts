import { realClinicalTransport } from './transport.ts'
import { isClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import { JsonBodyError, readBoundedJsonObject } from '@/lib/boundedJsonBody'

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const dayPattern = /^\d{4}-\d{2}-\d{2}$/
const localPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers })
const validId = (value: string | undefined): value is string => !!value && idPattern.test(value)
const validDay = (value: unknown): value is string => typeof value === 'string' && dayPattern.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))

async function input(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Error('INVALID_INPUT')
  const size = request.headers.get('content-length')
  if (size && (!/^\d+$/.test(size) || Number(size) > 32_768)) throw new Error('INVALID_INPUT')
  const raw = await request.text()
  if (raw.length > 32_768) throw new Error('INVALID_INPUT')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_INPUT')
  return value as Record<string, unknown>
}

/** All reads and writes use the caller's validated JWT; SQL rechecks case rights. */
export async function handleRealWorkspaceHttp(request: Request, segments: string[]): Promise<Response> {
  try {
    const transport = realClinicalTransport()
    const token = await transport.authenticate(request)
    if (!token) return reply({ code: 'UNAUTHORIZED', error: 'Connexion requise.' }, 401)
    const [area, id, action] = segments
    const method = request.method
    if (area === 'capacity-offers' && !id) {
      if (method === 'GET') {
        const professionalId = new URL(request.url).searchParams.get('professionalId')
        if (professionalId !== null && !validId(professionalId)) throw new Error('INVALID_INPUT')
        return reply({ offers: await transport.rpc('clinical_list_capacity_offers', {
          p_professional_id: professionalId,
        }, token) })
      }
      if (method === 'POST') {
        const body = await input(request)
        const slots = body.offerSlots
        if (!Array.isArray(slots) || slots.length < 1 || slots.length > 60
          || !slots.every(slot => slot && typeof slot === 'object' && !Array.isArray(slot)
            && Object.keys(slot).length === 3
            && typeof slot.day === 'string' && validDay(slot.day)
            && Number.isInteger(slot.startMinute) && slot.startMinute >= 480
            && slot.startMinute <= 1260 && slot.startMinute % 60 === 0
            && slot.endMinute === slot.startMinute + 60)
          || !Number.isInteger(body.requestedCount) || Number(body.requestedCount) < 1
          || Number(body.requestedCount) > slots.length
          || !['grouped', 'spread', 'same_day', 'flexible', 'other'].includes(String(body.schedulePreference))
          || typeof body.comment !== 'string' || body.comment.length > 300
          || !validId(body.operationKey as string))
          throw new Error('INVALID_INPUT')
        return reply({ offer: await transport.rpc('clinical_create_capacity_offer', {
          p_slots: slots, p_requested_count: body.requestedCount,
          p_preference: body.schedulePreference, p_comment: body.comment,
          p_operation_key: body.operationKey,
        }, token) }, 201)
      }
    }
    if (area === 'service-templates' && !id) {
      if (method === 'GET')
        return reply(await transport.rpc('clinical_list_mandate_templates', {}, token))
      if (method === 'POST') {
        const body = await input(request)
        if (!['intervention', 'psychoeducation', 'psychotherapy', 'psychological_assessment'].includes(String(body.code))
          || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1
          || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200
          || typeof body.clinicalText !== 'string' || !body.clinicalText.trim() || body.clinicalText.length > 20_000
          || typeof body.administrativeText !== 'string' || !body.administrativeText.trim() || body.administrativeText.length > 20_000
          || (body.suggestedRateCents != null && (!Number.isInteger(body.suggestedRateCents)
            || Number(body.suggestedRateCents) < 1 || Number(body.suggestedRateCents) > 10_000_000)))
          throw new Error('INVALID_INPUT')
        return reply({ template: await transport.rpc('clinical_save_mandate_template', {
          p_code: body.code, p_expected_version: body.expectedVersion,
          p_title: body.title, p_clinical_text: body.clinicalText,
          p_administrative_text: body.administrativeText,
          p_suggested_rate_cents: body.suggestedRateCents ?? null,
        }, token) })
      }
    }
    if (method === 'GET' && area === 'directory' && !id) {
      const params = new URL(request.url).searchParams
      const search = params.get('search') ?? ''
      const status = params.get('status') ?? 'active'
      const page = Number(params.get('page') ?? '0')
      if (search.length > 100 || !['active', 'archived', 'all'].includes(status)
        || !Number.isInteger(page) || page < 0 || page > 100000) throw new Error('INVALID_INPUT')
      // Calendar and the temporary archive importer still consume the legacy array.
      if (!params.has('page') && !params.has('status'))
        return reply({ clients: await transport.rpc('clinical_workspace_directory', { p_search: search }, token) })
      return reply(await transport.rpc('clinical_workspace_directory_page', {
        p_search: search, p_status: status, p_page: page, p_limit: 15,
      }, token))
    }
    if (method === 'GET' && area === 'assignment-link' && validId(id) && !action)
      return reply({ link: await transport.rpc('clinical_get_my_assignment_link', { p_assignment_id: id }, token) })
    if (method === 'POST' && area === 'assignment-link' && validId(id) && !action)
      return reply({ link: await transport.rpc('clinical_link_my_existing_assignment', { p_assignment_id: id }, token) })
    if (method === 'GET' && area === 'calendar' && !id) {
      const { searchParams } = new URL(request.url)
      const from = searchParams.get('from'), to = searchParams.get('to')
      if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new Error('INVALID_INPUT')
      return reply({ calendar: await transport.rpc('clinical_calendar_workspace', { p_from: from, p_to: to }, token) })
    }
    if (method === 'GET' && area === 'calendar' && id === 'closures' && !action) {
      const { searchParams } = new URL(request.url)
      const from = searchParams.get('from'), to = searchParams.get('to')
      if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new Error('INVALID_INPUT')
      return reply({ closures: await transport.rpc('clinical_calendar_closures', { p_from: from, p_to: to }, token) })
    }
    if (area === 'appointments' && validId(id)) {
      if (method === 'PATCH' && !action) {
        const body = await input(request)
        if (!Number.isInteger(body.version) || Number(body.version) < 1
          || typeof body.startLocal !== 'string' || !localPattern.test(body.startLocal)
          || !Number.isInteger(body.durationMinutes) || Number(body.durationMinutes) < 1
          || Number(body.durationMinutes) > 720 || typeof body.modality !== 'string'
          || !['office', 'home', 'phone', 'video'].includes(body.modality)
          || (body.officeId != null && !validId(body.officeId as string))
          || (body.modality === 'office') !== Boolean(body.officeId)
          || (body.disambiguation != null && !['earlier', 'later'].includes(body.disambiguation as string))
          || !Number.isInteger(body.travelBeforeMinutes) || Number(body.travelBeforeMinutes) < 0
          || Number(body.travelBeforeMinutes) > 180 || !Number.isInteger(body.travelAfterMinutes)
          || Number(body.travelAfterMinutes) < 0 || Number(body.travelAfterMinutes) > 180)
          throw new Error('INVALID_INPUT')
        return reply({ appointment: await transport.rpc('clinical_reschedule_appointment', {
          p_appointment_id: id, p_expected_version: body.version, p_start_local: body.startLocal,
          p_duration_minutes: body.durationMinutes, p_modality: body.modality,
          p_office_id: body.officeId ?? null, p_travel_before: body.travelBeforeMinutes,
          p_travel_after: body.travelAfterMinutes,
          p_disambiguation: body.disambiguation ?? null,
        }, token) })
      }
      if (method === 'POST' && action === 'cancel') {
        const body = await input(request)
        if (!Number.isInteger(body.version) || Number(body.version) < 1
          || !['client', 'professional', 'clinic'].includes(String(body.reason))
          || body.scope !== 'one') throw new Error('INVALID_INPUT')
        return reply({ appointments: await transport.rpc('clinical_cancel_appointment', {
          p_appointment_id: id, p_expected_version: body.version,
          p_reason: body.reason, p_scope: 'one',
        }, token) })
      }
    }
    if (method === 'GET' && area === 'legacy-import-access' && validId(id) && !action)
      return reply({ allowed: await transport.rpc('clinical_legacy_import_allowed', { p_case_id: id }, token) })
    if (method === 'GET' && area === 'legacy-billing-access' && validId(id) && !action)
      return reply({ allowed: await transport.rpc('clinical_legacy_billing_import_allowed', { p_case_id: id }, token) })
    if (area === 'cases' && validId(id)) {
      if (method === 'GET' && !action) return reply({ case: await transport.rpc('clinical_case_overview', { p_case_id: id }, token) })
      if (method === 'GET' && action === 'administration') {
        const [administration, legacySource] = await Promise.all([
          transport.rpc('clinical_case_administration', { p_case_id: id }, token),
          transport.rpc('clinical_case_legacy_source', { p_case_id: id }, token),
        ])
        return reply({ administration, legacySource })
      }
      if (method === 'PUT' && action === 'administration') {
        const body = await input(request)
        const kind = body.kind
        const party = body.party
        const fields = party as Record<string, unknown> | null
        if (!['contact', 'representative', 'payer'].includes(String(kind))
          || (body.partyId != null && !validId(body.partyId as string))
          || !party || typeof party !== 'object' || Array.isArray(party)
          || Object.keys(party).some(key => !['fullName', 'relationship', 'email', 'phone', 'authorityVerified', 'payerType'].includes(key))
          || typeof fields?.fullName !== 'string' || !fields.fullName.trim() || fields.fullName.length > 200
          || (fields.relationship != null && (typeof fields.relationship !== 'string' || fields.relationship.length > 100))
          || (fields.email != null && (typeof fields.email !== 'string' || fields.email.length > 254
            || (fields.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))))
          || (fields.phone != null && (typeof fields.phone !== 'string' || fields.phone.length > 40))
          || (kind === 'representative' && (typeof fields.relationship !== 'string'
            || !fields.relationship.trim() || typeof fields.authorityVerified !== 'boolean'))
          || (kind === 'payer' && !['self', 'parent', 'organization'].includes(String(fields.payerType))))
          throw new Error('INVALID_INPUT')
        const partyId = await transport.rpc('clinical_save_case_party', {
          p_case_id: id, p_kind: kind, p_party_id: body.partyId ?? null, p_party: party,
        }, token)
        return reply({ partyId }, body.partyId ? 200 : 201)
      }
      if (method === 'GET' && action === 'closure')
        return reply({ closure: await transport.rpc('clinical_case_closure', { p_case_id: id }, token) })
      if (method === 'POST' && action === 'close') {
        const body = await input(request)
        if (!['administrative', 'no_encounter', 'note'].includes(String(body.mode))
          || typeof body.reason !== 'string' || body.reason.trim().length < 3
          || body.reason.length > (body.mode === 'note' ? 24_000 : 1_000)) throw new Error('INVALID_INPUT')
        return reply({ closure: await transport.rpc('clinical_close_case', {
          p_case_id: id, p_mode: body.mode, p_reason: body.reason,
        }, token) })
      }
      if (method === 'GET' && action === 'notes') return reply({ notes: await transport.rpc('clinical_list_notes', { p_case_id: id }, token) })
      if (method === 'GET' && action === 'appointments') return reply({ appointments: await transport.rpc('clinical_list_note_appointments', { p_case_id: id }, token) })
      if (action === 'legacy-context') {
        if (method === 'GET') return reply({ context: await transport.rpc('clinical_read_legacy_context', { p_case_id: id }, token) })
        if (method === 'PUT' || method === 'POST') {
          const body = await input(request)
          if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0
            || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 3_500
            || !Array.isArray(body.sourceDocumentIds) || body.sourceDocumentIds.length < 1
            || body.sourceDocumentIds.length > 20 || !body.sourceDocumentIds.every(item => typeof item === 'string' && validId(item)))
            throw new Error('INVALID_INPUT')
          return reply({ context: await transport.rpc(method === 'POST'
            ? 'clinical_save_auto_legacy_context' : 'clinical_save_legacy_context', {
            p_case_id: id, p_expected_version: body.expectedVersion,
            p_text: body.text, p_source_document_ids: body.sourceDocumentIds,
          }, token) })
        }
      }
      if (action === 'legacy-documents') {
        if (method === 'GET') return reply({ documents: await transport.rpc('clinical_list_legacy_documents', { p_case_id: id }, token) })
        if (method === 'POST') {
          if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Error('INVALID_INPUT')
          const body = await readBoundedJsonObject(request, 7_000_000)
          if (typeof body.sourceId !== 'string' || !/^[a-z0-9-]{8,160}$/.test(body.sourceId)
            || typeof body.label !== 'string' || body.label.trim().length < 1 || body.label.length > 160
            || (body.pageCount != null && (!Number.isInteger(body.pageCount) || Number(body.pageCount) < 1 || Number(body.pageCount) > 500))
            || typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.sha256)
            || typeof body.base64 !== 'string' || body.base64.length > 7_000_000
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) throw new Error('INVALID_INPUT')
          return reply({ document: await transport.rpc('clinical_import_legacy_document', {
            p_case_id: id, p_source_id: body.sourceId, p_label: body.label.trim(),
            p_page_count: body.pageCount ?? null, p_sha256: body.sha256, p_base64: body.base64,
          }, token) }, 201)
        }
      }
      if (method === 'POST' && action === 'notes') {
        const body = await input(request)
        if (!isClinicalNoteType(body.noteType) || typeof body.title !== 'string' || body.title.length > 200
          || !validDay(body.encounterDate) || typeof body.text !== 'string' || body.text.length > 24_000
          || (body.appointmentId != null && !validId(body.appointmentId as string))) throw new Error('INVALID_INPUT')
        return reply({ note: await transport.rpc('clinical_create_note', {
          p_case_id: id, p_note_type: body.noteType, p_title: body.title,
          p_encounter_date: body.encounterDate, p_content: { document: body.text },
          p_appointment_id: body.appointmentId ?? null,
        }, token) }, 201)
      }
      if (method === 'POST' && action === 'appointments') {
        const body = await input(request)
        if (!validId(body.professionalId as string) || typeof body.startLocal !== 'string'
          || !localPattern.test(body.startLocal) || !Number.isInteger(body.durationMinutes)
          || Number(body.durationMinutes) < 1 || Number(body.durationMinutes) > 720
          || (body.count != null && (!Number.isInteger(body.count) || Number(body.count) < 1 || Number(body.count) > 12))
          || typeof body.modality !== 'string' || body.modality.length > 80
          || (body.officeId != null && !validId(body.officeId as string))
          || (body.disambiguation != null && !['earlier', 'later'].includes(body.disambiguation as string))) throw new Error('INVALID_INPUT')
        return reply({ appointments: await transport.rpc('clinical_create_appointments', {
          p_case_id: id, p_professional_id: body.professionalId,
          p_start_local: body.startLocal, p_duration_minutes: body.durationMinutes,
          p_modality: body.modality, p_office_id: body.officeId ?? null,
          p_count: body.count ?? 1,
          p_disambiguation: body.disambiguation ?? null,
        }, token) }, 201)
      }
    }
    if (method === 'GET' && area === 'legacy-documents' && validId(id) && !action) {
      const result = await transport.rpc('clinical_read_legacy_document', { p_document_id: id }, token)
      if (!result || typeof result !== 'object' || !('base64' in result)
        || typeof result.base64 !== 'string' || result.base64.length > 7_000_000)
        throw new Error('INVALID_STATE')
      const bytes = Buffer.from(result.base64, 'base64')
      if (bytes.length < 100 || bytes.length > 5_242_880 || bytes.subarray(0, 5).toString() !== '%PDF-')
        throw new Error('INVALID_STATE')
      return new Response(new Uint8Array(bytes), { headers: { ...headers,
        'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="notes-cliniques-historiques.pdf"' } })
    }
    if (area === 'notes' && validId(id)) {
      if (method === 'GET' && !action) return reply({ note: await transport.rpc('clinical_read_note', { p_note_id: id }, token) })
      if (method === 'POST' && action === 'amend') {
        const body = await input(request)
        if (!Number.isInteger(body.version) || body.reason !== 'correction') throw new Error('INVALID_INPUT')
        return reply({ note: await transport.rpc('clinical_amend_note', {
          p_note_id: id, p_expected_version: body.version, p_reason: 'correction',
        }, token) }, 201)
      }
      if (method === 'PATCH' && !action) {
        const body = await input(request)
        if (!Number.isInteger(body.version) || typeof body.title !== 'string' || body.title.length > 200
          || !validDay(body.encounterDate) || typeof body.text !== 'string' || body.text.length > 24_000)
          throw new Error('INVALID_INPUT')
        return reply({ note: await transport.rpc('clinical_save_note', {
          p_note_id: id, p_expected_version: body.version, p_title: body.title,
          p_encounter_date: body.encounterDate, p_content: { document: body.text },
        }, token) })
      }
      if (method === 'POST' && action === 'sign') {
        const body = await input(request)
        if (!Number.isInteger(body.version) || body.attested !== true) throw new Error('INVALID_INPUT')
        return reply({ note: await transport.rpc('clinical_sign_note', {
          p_note_id: id, p_expected_version: body.version, p_attested: true,
        }, token) })
      }
    }
    return reply({ code: 'NOT_FOUND', error: 'Ressource introuvable.' }, 404)
  } catch (cause) {
    const code = cause instanceof Error && 'code' in cause ? String(cause.code) : ''
    if (cause instanceof Error && cause.message === 'INVALID_INPUT') return reply({ code: 'INVALID_INPUT', error: 'Données invalides.' }, 400)
    if (cause instanceof JsonBodyError) return reply({ code: 'INVALID_INPUT', error: 'Document trop volumineux ou invalide.' }, cause.status)
    if (code === '42501') return reply({ code: 'FORBIDDEN', error: 'Accès refusé.' }, 403)
    if (code === '40001') return reply({ code: 'VERSION_CONFLICT', error: 'Cette version a changé. Actualisez-la.' }, 409)
    if (code === 'P0002') return reply({ code: 'NOT_FOUND', error: 'Ressource introuvable.' }, 404)
    if (code === '22023' || code === '23514' || code === '23503' || code === '23505' || code === '23P01') return reply({ code: 'INVALID_STATE', error: 'Cette opération ne peut pas être enregistrée dans l’état actuel.' }, 409)
    return reply({ code: 'REAL_WORKSPACE_UNAVAILABLE', error: 'Espace clinique indisponible.' }, 503)
  }
}
