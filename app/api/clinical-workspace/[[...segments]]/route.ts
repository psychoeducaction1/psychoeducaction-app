import { isDurableClinicalRuntime } from '@/lib/clinical-local/runtime'
import { handleLocalWorkspace } from '@/lib/clinical-local/workspaceRoute'
import type { ClinicalActorInput } from '@/lib/clinical-core/types'
import { CLINICAL_FIXTURE_ACTORS } from '@/lib/clinical-core/actors'
import { getClinicalFixtureActor, isClinicalFixtureEnabled } from '@/lib/clinical-core/fixtureAccess'
import { ClinicalError, isClinicalError } from '@/lib/clinical-core/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
type RouteContext = { params: Promise<{ segments?: string[] }> }
const MAX_BODY_BYTES = 96 * 1024
const responseHeaders = { 'Cache-Control': 'private, no-store', Vary: 'X-Clinical-Fixture-Actor, X-Clinical-Context', 'X-Content-Type-Options': 'nosniff' }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: responseHeaders }) }

async function readBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new ClinicalError(400, 'INVALID_INPUT', 'Un contenu JSON est requis.')
  const length = request.headers.get('Content-Length')
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new ClinicalError(413, 'BODY_TOO_LARGE', 'La requête dépasse la taille autorisée.')
  const reader = request.body?.getReader()
  if (!reader) throw new ClinicalError(400, 'INVALID_INPUT', 'Un contenu JSON est requis.')
  let bytes = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new ClinicalError(413, 'BODY_TOO_LARGE', 'La requête dépasse la taille autorisée.') }
      chunks.push(value)
    }
    const combined = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(combined)) }
    catch { throw new ClinicalError(400, 'INVALID_INPUT', 'Le JSON fourni est invalide.') }
  } finally { reader.releaseLock() }
}

async function handle(request: Request, context: RouteContext) {
  if (process.env.PEA_CLINICAL_RUNTIME === 'real-db') {
    const segments = (await context.params).segments ?? []
    if (process.env.PEA_UNIFICATION_PILOT === 'true' || process.env.PEA_CONTROLLED_MERGE === 'true') {
      const { handleUnifiedWorkspaceHttp } = await import('@/lib/clinical-unification/http')
      const { handleUnifiedFinanceHttp } = await import('@/lib/clinical-unification/financeHttp')
      const { handleUnifiedProfessionalRequest } = await import('@/lib/clinical-unification/professionalHttp')
      const { handleMigration } = await import('@/lib/clinical-unification/migrationHttp')
      const { handleUnifiedClients } = await import('@/lib/clinical-unification/clientHttp')
      const { handleUnifiedMandates } = await import('@/lib/clinical-unification/mandateHttp')
      const { handleUnifiedCalendarRequest } = await import('@/lib/clinical-unification/calendarHttp')
      const { handleUnifiedCapacityRequest } = await import('@/lib/clinical-unification/capacityHttp')
      const { handleUnifiedAdmissionRequest } = await import('@/lib/clinical-unification/admissionHttp')
      const { handleUnifiedAssignmentLink } = await import('@/lib/clinical-unification/assignmentLinkHttp')
      const { handleUnifiedClientAssignment } = await import('@/lib/clinical-unification/clientAssignmentHttp')
      return handleUnifiedWorkspaceHttp(request, segments, { handlers: [handleMigration,
        handleUnifiedAssignmentLink,
        handleUnifiedClientAssignment,
        handleUnifiedClients,
        handleUnifiedMandates,
        async (incoming, path, identity) => path[0] === 'admission'
          ? handleUnifiedAdmissionRequest(incoming, path.slice(1), identity, identity.transport) : null,
        async (incoming, path, identity) => path[0] === 'capacity-offers'
          ? handleUnifiedCapacityRequest(incoming, path.slice(1), identity, identity.transport) : null,
        async (incoming, path, identity) => path[0] === 'calendar'
          ? handleUnifiedCalendarRequest(incoming, path.slice(1), identity, identity.transport) : null,
        async (incoming, path, identity) => path[0] === 'professionals'
          ? handleUnifiedProfessionalRequest(incoming, path.slice(1), identity, identity.transport) : null,
        async (incoming, path) => path[0] === 'billing' ? handleUnifiedFinanceHttp(incoming, path.slice(1))
          : path[0] === 'fees' ? handleUnifiedFinanceHttp(incoming, path) : null,
      ] })
    }
    if (segments[0] === 'real') {
      const { handleRealWorkspaceHttp } = await import('@/lib/clinical-real/workspaceHttp')
      return handleRealWorkspaceHttp(request, segments.slice(1))
    }
    if (segments[0] === 'billing' || segments[0] === 'fees') {
      const { handleRealFinanceHttp } = await import('@/lib/clinical-real/financeHttp')
      return handleRealFinanceHttp(request, segments)
    }
    if (segments[0] !== 'mandates') return json({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
    const [{ handleRealMandateHttp }, { realMandateDependencies }] = await Promise.all([
      import('@/lib/clinical-real/mandateHttp'), import('@/lib/clinical-real/mandateTransport')])
    try { return await handleRealMandateHttp(request, segments.slice(1), realMandateDependencies()) }
    catch { return json({ error: 'Service de mandat indisponible.', code: 'REAL_MANDATE_UNAVAILABLE' }, 503) }
  }
  if (isDurableClinicalRuntime()) {
    const segments = (await context.params).segments ?? []
    if (request.method === 'POST' && segments.join('/') === 'billing/stripe/checkout') {
      return (await import('@/app/api/clinical-workspace/billing/stripe/checkout/route')).POST(request)
    }
    if (['GET', 'POST', 'PATCH'].includes(request.method) && segments.join('/') === 'billing/stripe/card') {
      const route = await import('@/app/api/clinical-workspace/billing/stripe/card/route')
      return route[request.method as 'GET' | 'POST' | 'PATCH'](request)
    }
    if (request.method === 'POST' && segments.join('/') === 'billing/stripe/charge') {
      return (await import('@/app/api/clinical-workspace/billing/stripe/charge/route')).POST(request)
    }    if (request.method === 'POST' && segments.join('/') === 'billing/stripe/webhook') {
      return (await import('@/app/api/clinical-workspace/billing/stripe/webhook/route')).POST(request)
    }
    return handleLocalWorkspace(request, segments)
  }
  // Fail closed before importing/initializing the memory service.
  if (!isClinicalFixtureEnabled()) return json({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
  const { segments = [] } = await context.params
  if (request.method === 'GET' && segments.length === 1 && segments[0] === 'actors') return json({ actors: CLINICAL_FIXTURE_ACTORS, mode: 'isolated_fixture', durable: false })
  const actor = getClinicalFixtureActor(request.headers.get('X-Clinical-Fixture-Actor'))
  if (!actor) return json({ error: 'Sélectionnez un compte de démonstration autorisé.', code: 'FORBIDDEN' }, 403)
  try {
    const { getComposedClinicalFixtureService } = await import('@/lib/clinical-workspace/fixtureComposition')
    const service = getComposedClinicalFixtureService()
    const chosenContext = request.headers.get('X-Clinical-Context')
    const actorInput: ClinicalActorInput = chosenContext === null ? actor.id : chosenContext === 'administration' || chosenContext === 'clinical' ? { actorId: actor.id, context: chosenContext } : (() => { throw new ClinicalError(400, 'INVALID_CONTEXT', 'Contexte invalide.') })()
    const [area, id, action] = segments
    const get = request.method === 'GET'
    const post = request.method === 'POST'
    const patch = request.method === 'PATCH'
    const remove = request.method === 'DELETE'
    if (get && segments.length === 0) return json({ workspace: service.getWorkspace(actorInput) })
    if (get && area === 'audit' && segments.length === 1) return json({ events: service.listAudit(actorInput) })
    if (area === 'clients') {
      if (get && segments.length === 1) return json({ clients: service.listClients(actorInput) })
      if (post && segments.length === 1) return json({ client: service.createClient(actorInput, await readBody(request)) }, 201)
      if (patch && id && segments.length === 2) return json({ client: service.updateAdministrativeRecord(actorInput, id, await readBody(request)) })
      if (post && id && segments.length === 3) {
        const body = await readBody(request)
        switch (action) {
          case 'assign': return json({ client: service.assignRequest(actorInput, id, body) }, 201)
          case 'contacts': return json({ client: service.addContact(actorInput, id, body) }, 201)
          case 'representatives': return json({ client: service.addRepresentative(actorInput, id, body) }, 201)
          case 'payers': return json({ client: service.addPayer(actorInput, id, body) }, 201)
          case 'requests': return json({ client: service.createRequest(actorInput, id, body) }, 201)
          case 'episodes': return json({ client: service.createEpisode(actorInput, id, body) }, 201)
          case 'assignment-links': return json({ client: service.linkAssignment(actorInput, id, body) }, 201)
        }
      }
    }
    if (area === 'records') {
      if (post && segments.length === 1) return json({ record: service.createClinicalRecord(actorInput, await readBody(request)) }, 201)
      if (get && id && segments.length === 2) return json({ record: service.getClinicalRecord(actorInput, id) })
      if (get && id && segments.length === 3 && action === 'appointments') return json({ appointments: service.listNoteAppointments(actorInput, id) })
      if (post && id && segments.length === 3 && action === 'notes') return json({ note: service.createNote(actorInput, id, await readBody(request)) }, 201)
      if (patch && id && segments.length === 3 && action === 'access') return json({ record: service.updateClinicalAccess(actorInput, id, await readBody(request)) })
    }
    if (area === 'notes' && id) {
      if (get && segments.length === 2) return json({ note: service.getNote(actorInput, id) })
      if (remove && segments.length === 2) return json({ result: service.deleteNote(actorInput, id, await readBody(request)) })
      if (patch && segments.length === 2) return json({ note: service.saveNote(actorInput, id, await readBody(request)) })
      if (post && segments.length === 3) {
        const body = await readBody(request)
        switch (action) {
          case 'sign': return json({ note: service.signNote(actorInput, id, body) })
          case 'cosign': return json({ note: service.cosignNote(actorInput, id, body) })
          case 'amend': return json({ note: service.amendNote(actorInput, id, body) }, 201)
        }
      }
    }
    return json({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
  } catch (error) {
    if (isClinicalError(error)) return json({ error: error.message, code: error.code }, error.status)
    return json({ error: 'Le démonstrateur ne peut pas effectuer cette opération.', code: 'FIXTURE_ERROR' }, 503)
  }
}
export async function GET(request: Request, context: RouteContext) { return handle(request, context) }
export async function POST(request: Request, context: RouteContext) { return handle(request, context) }
export async function PATCH(request: Request, context: RouteContext) { return handle(request, context) }
export async function DELETE(request: Request, context: RouteContext) { return handle(request, context) }
