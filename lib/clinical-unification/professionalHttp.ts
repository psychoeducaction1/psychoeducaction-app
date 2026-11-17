import { isProfessionalSlug } from '../clinical-workspace/professionalLinks.ts'
import type { ClinicalAccessContext } from '../clinical-core/types.ts'
import { JsonBodyError, readBoundedJsonObject } from '../boundedJsonBody.ts'
import { clientDocumentResponse } from '../clinical-local/clientDetailsRoute.ts'
import { signatureImageStrokes } from '../clinical-local/signatureImage.ts'
import { createUnifiedProfessionalAdapter, unifiedProfessionalActions } from './professionals.ts'
import { createUnifiedProfessionalServices } from './professionalServices.ts'
import type { UnifiedWorkspaceTransport } from './workspace.ts'
import { localProfessionalAuth, type LocalProfessionalAuth } from './professionalProvision.ts'

type Auth = { token: string; context: ClinicalAccessContext }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
const invalid = () => reply({ error: 'Vérifiez les renseignements du professionnel.', code: 'INVALID_INPUT' }, 400)

/** Called only after authenticateUnifiedRequest. `segments` begins after professionals. */
export async function handleUnifiedProfessionalRequest(request: Request, segments: string[], auth: Auth,
  transport: UnifiedWorkspaceTransport, authFactory: () => LocalProfessionalAuth = localProfessionalAuth): Promise<Response> {
  const adapter = createUnifiedProfessionalAdapter(transport)
  try {
    if (segments[0] === 'create' || segments[1] === 'invitation') {
      if (auth.context !== 'administration') return reply({ error: 'Accès administratif requis.', code: 'FORBIDDEN' }, 403)
      if (request.method !== 'POST' || new URL(request.url).search) return invalid()
      const key = request.headers.get('Idempotency-Key')
      if (!uuid(key)) return invalid()
      if (segments.length === 2 && segments[1] === 'invitation' && uuid(segments[0])) {
        // Authorize via the user's JWT BEFORE constructing the privileged Auth client.
        const details = await adapter.read(auth.token, 'administration', segments[0])
        if (!object(details) || !object(details.professional)) throw new Error('UNIFIED_RESPONSE_INVALID')
        const professional = details.professional
        if (!professional.active || !professional.platformAccess || typeof professional.email !== 'string'
          || !/^[^\s@]+@[^\s@]+\.invalid$/i.test(professional.email)) return invalid()
        const actionLink = await authFactory().invite(professional.email, segments[0], new URL(request.url).origin)
        return reply({ simulated: true, from: 'contact@psychoeducaction.com', to: professional.email,
          subject: 'Accès à la plateforme Clinique PsychoÉducAction', actionLink,
          body: `Bonjour ${professional.fullName},\n\nVotre accès à la plateforme Clinique PsychoÉducAction est prêt. Ouvrez le lien ci-dessous pour choisir ou modifier votre mot de passe, puis connectez-vous avec votre adresse courriel professionnelle.\n\n${actionLink}\n\nSi vous n’avez pas demandé cet accès, communiquez avec la clinique à contact@psychoeducaction.com.` })
      }
      if (segments.length !== 1 || segments[0] !== 'create'
        || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return invalid()
      const body = await readBoundedJsonObject(request, 8192)
      if (Object.keys(body).some(field => !['fullName', 'email', 'title'].includes(field))
        || typeof body.fullName !== 'string' || !body.fullName.trim() || body.fullName.trim().length > 200
        || typeof body.title !== 'string' || body.title.trim().length > 160
        || typeof body.email !== 'string' || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.invalid$/i.test(body.email.trim())) return invalid()
      const data = { fullName: body.fullName.trim(), title: body.title.trim(), email: body.email.trim().toLowerCase() }
      const reserve = async () => {
        const value = await transport.rpc('clinical_unified_professional_provision_begin', { p_context: auth.context, p_key: key, p_data: data }, auth.token)
        if (!object(value) || !uuid(value.actorId) || value.email !== data.email || value.fullName !== data.fullName || value.title !== data.title
          || !(value.userId === null || uuid(value.userId)) || typeof value.completed !== 'boolean') throw new Error('UNIFIED_RESPONSE_INVALID')
        return value as { actorId: string; email: string; fullName: string; title: string; userId: string | null; completed: boolean }
      }
      let reservation = await reserve()
      const localAuth = authFactory()
      const temporaryPassword = localAuth.password(reservation.actorId, key, reservation.email)
      let id = reservation.userId
      if (!id) id = await localAuth.create({ actorId: reservation.actorId, key, email: data.email, fullName: data.fullName, password: temporaryPassword })
      if (!id) { reservation = await reserve(); id = reservation.userId }
      if (!id || !uuid(id)) return reply({ error: 'Le compte n’a pas pu être préparé. Réessayez la même opération.', code: 'UNIFIED_AUTH_PROVISION_FAILED' }, 503)
      const saved = await transport.rpc('clinical_unified_professional_provision_finish', { p_context: auth.context, p_key: key, p_user_id: id }, auth.token)
      if (!object(saved) || saved.created !== true || saved.id !== id) throw new Error('UNIFIED_RESPONSE_INVALID')
      return reply({ id, temporaryPassword, fictional: true }, 201)
    }
    if (segments[0] === 'offices') {
      if (auth.context !== 'administration') return reply({ error: 'Accès administratif requis.', code: 'FORBIDDEN' }, 403)
      if (segments.length === 1 && request.method === 'GET') {
        return reply(await transport.rpc('clinical_unified_office_directory_query', { p_context: auth.context }, auth.token))
      }
      if (segments.length === 2 && segments[1] === 'commands' && request.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return invalid()
        const body = await readBoundedJsonObject(request, 8192)
        const key = request.headers.get('Idempotency-Key')
        if (!uuid(key) || !object(body.data) || body.officeId !== null && !uuid(body.officeId)
          || Object.keys(body).some(field => field !== 'officeId' && field !== 'data')) return invalid()
        const result = await transport.rpc('clinical_unified_office_directory_command', {
          p_context: auth.context, p_office_id: body.officeId, p_data: body.data, p_key: key,
        }, auth.token)
        if (!object(result) || result.saved !== true || !uuid(result.id) || !Number.isSafeInteger(result.version)
          || body.officeId !== null && result.id !== body.officeId) throw new Error('UNIFIED_RESPONSE_INVALID')
        return reply(result, 201)
      }
      return reply({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
    }
    if (segments[1] === 'services') {
      if (!uuid(segments[0])) return invalid()
      const services = createUnifiedProfessionalServices(transport)
      if (request.method === 'GET' && segments.length === 2) return reply(await services.read(auth.token, auth.context, segments[0]))
      if (request.method === 'POST' && segments.length === 3 && segments[2] === 'commands') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return invalid()
        const body = await readBoundedJsonObject(request, 8192)
        const key = request.headers.get('Idempotency-Key')
        if (!uuid(key) || !object(body.data) || Object.keys(body).some(field => field !== 'data')) return invalid()
        return reply(await services.command(auth.token, auth.context, segments[0], body.data, key), 201)
      }
      return reply({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
    }
    const target = segments[0] === 'self' || segments.length === 0 ? null : segments[0]
    if (target !== null && !uuid(target) && !(auth.context==='administration' && request.method==='GET' && segments.length===1 && isProfessionalSlug(target))) return invalid()
    if (request.method === 'GET' && segments.length <= 1) {
      return reply(await adapter.read(auth.token, auth.context, target))
    }
    if (request.method === 'GET' && segments[1] === 'documents' && uuid(target) && uuid(segments[2])
      && segments[3] === auth.context && (segments.length === 5 && segments[4] === 'download'
        || segments.length === 6 && segments[4] === 'signed' && segments[5] === 'download')) {
      const result = await adapter.document(auth.token, auth.context, target, segments[2], segments[4] === 'signed')
      const response = clientDocumentResponse(result, segments[2])
      response.headers.set('Content-Disposition', 'inline')
      return response
    }
    if (request.method !== 'POST' || segments.length !== 2 || segments[1] !== 'commands') {
      return reply({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return invalid()
    const key = request.headers.get('Idempotency-Key')
    if (!uuid(key)) return invalid()
    const body = await readBoundedJsonObject(request, 1450000)
    if (Object.keys(body).some(field => field !== 'action' && field !== 'data') || typeof body.action !== 'string'
      || !unifiedProfessionalActions.has(body.action) || !object(body.data)) return invalid()
    let data = body.data
    if (body.action === 'signature.upload') {
      if (Object.keys(data).some(field => field !== 'mediaType' && field !== 'bytesBase64')
        || !['image/png', 'image/jpeg'].includes(String(data.mediaType))
        || typeof data.bytesBase64 !== 'string' || data.bytesBase64.length > 700000) return invalid()
      try { data = { ...data, strokes: await signatureImageStrokes(Buffer.from(data.bytesBase64, 'base64')) } }
      catch { return invalid() }
    }
    return reply(await adapter.command(auth.token, auth.context, target, body.action, data, key), 201)
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'PROFESSIONAL_LINK_NOT_UNIQUE') return reply({error:'Profil introuvable ou nom ambigu. Retrouvez le professionnel dans le répertoire.',code:'NOT_FOUND'},404)
    if (cause instanceof JsonBodyError) return reply({ error: cause.message, code: 'INVALID_BODY' }, cause.status)
    throw cause // Shared facade maps RLS, version conflicts and failures; never reports a false success.
  }
}
