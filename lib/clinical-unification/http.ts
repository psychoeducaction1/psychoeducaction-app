import { readControlledMergeProfile } from './controlledMergeProfile.ts'
import { authenticateUnifiedRequest, UnifiedAuthenticationError } from './auth.ts'
import { clearUnifiedDocumentCookie, unifiedDocumentCookie } from './authDocumentCookie.ts'
import { assertUnificationRuntime } from './isolation.ts'
import { createUnifiedWorkspaceReader } from './workspace.ts'
import { realClinicalTransport } from '../clinical-real/transport.ts'
import { mandateDefaultFailure } from '../clinical-mandates/defaultErrors.ts'

export type UnifiedHttpTransport = ReturnType<typeof realClinicalTransport>
export type UnifiedHttpContext = { token: string; context: 'administration' | 'clinical'; transport: UnifiedHttpTransport }
export type UnifiedDomainHandler = (request: Request, segments: string[], identity: UnifiedHttpContext) => Promise<Response | null>
type Dependencies = { transport?: UnifiedHttpTransport; assertIsolation?: () => void; handlers?: UnifiedDomainHandler[] }
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Cookie, X-Clinical-Context' }
export const unifiedJson = (body: unknown, status = 200) => Response.json(body, { status, headers })

/** Next's node adapter reconstructs URLs with localhost even when it is bound
 * to 127.0.0.1. Accept only the fixed pilot listener; never trust forwarded hosts. */
export function unifiedListenerRequest(request: Request): Request {
  const url = new URL(request.url)
  const host = request.headers.get('host')
  if (url.origin === 'http://localhost:3110' && host === '127.0.0.1:3110') {
    url.hostname = '127.0.0.1'
    return new Request(url, request)
  }
  if (host && host !== url.host) throw new UnifiedAuthenticationError(403, 'HOST_REFUSED')
  return request
}

export function unifiedHttpFailure(error: unknown): Response {
  if (error instanceof UnifiedAuthenticationError) return unifiedJson({ error: 'Accès à cet espace refusé.', code: error.code }, error.status)
  if (error instanceof Error && ['DOCUMENT_COOKIE_ORIGIN_REFUSED', 'DOCUMENT_COOKIE_TOKEN_EXPIRED'].includes(error.message)) {
    return unifiedJson({ error: 'La session documentaire locale n’a pas pu être établie.', code: error.message }, 503)
  }
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === '42501') return unifiedJson({ error: 'Accès à ce dossier refusé.', code: 'FORBIDDEN' }, 403)
  if (code === 'P0002') return unifiedJson({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
  if (code === '40001' || code === '23505' || code === '23P01') return unifiedJson({ error: 'Les données ont changé ou ce créneau est occupé. Actualisez avant de réessayer.', code: 'CONFLICT' }, 409)
  const prerequisite = mandateDefaultFailure(error)
  if (prerequisite) return unifiedJson({ error: prerequisite.message, code: prerequisite.code }, prerequisite.status)
  if (code === '22023') return unifiedJson({ error: 'Vérifiez les renseignements saisis.', code: 'INVALID_INPUT' }, 400)
  return unifiedJson({ error: 'Le service clinique est momentanément indisponible.', code: 'UNIFIED_UNAVAILABLE' }, 503)
}

/** Original laboratory URL contract. Identity comes only from a verified JWT. */
export async function handleUnifiedWorkspaceHttp(request: Request, segments: string[], dependencies: Dependencies = {}): Promise<Response> {
  try {
    const assertIsolation = dependencies.assertIsolation ?? assertUnificationRuntime
    assertIsolation()
    request = unifiedListenerRequest(request)
    // Clearing a cookie grants no access and must remain possible after JWT expiry
    // or an Auth outage. Require the fixed local origin; never invoke a domain RPC.
    if (request.method === 'DELETE' && segments.join('/') === 'session') {
      const url = new URL(request.url)
      const site = request.headers.get('Sec-Fetch-Site')
      const referer = request.headers.get('Referer')
      if (url.origin !== (process.env.PEA_CONTROLLED_MERGE === 'true' ? readControlledMergeProfile(process.env).origin : 'http://127.0.0.1:3110') || url.search
        || request.headers.get('Origin') !== url.origin
        || site && site !== 'same-origin'
        || referer && new URL(referer).origin !== url.origin) {
        throw new UnifiedAuthenticationError(403, 'SIGNOUT_ORIGIN_REFUSED')
      }
      const response = unifiedJson({ signedOut: true })
      response.headers.set('Set-Cookie', clearUnifiedDocumentCookie(request.url))
      return response
    }
    if (request.method === 'POST' && segments.length === 3 && segments[0] === 'mandates'
      && segments[1] === 'portal' && ['open', 'sign'].includes(segments[2])) {
      if (process.env.PEA_CONTROLLED_MERGE === 'true' && !readControlledMergeProfile(process.env).modules.has('mandates')) throw new UnifiedAuthenticationError(403, 'CLINICAL_ACTIVATION_REQUIRED')
      const [{ handleRealMandateHttp }, { realMandateDependencies }] = await Promise.all([
        import('../clinical-real/mandateHttp.ts'), import('../clinical-real/mandateTransport.ts')])
      return handleRealMandateHttp(request, segments.slice(1), realMandateDependencies())
    }
    const transport = dependencies.transport ?? realClinicalTransport()
    const identity = await authenticateUnifiedRequest(request, transport, assertIsolation)
    const reader = createUnifiedWorkspaceReader(transport)
    if (request.method === 'GET' && segments.join('/') === 'identity') {
      const value = await reader.identity(identity.token, identity.context)
      const response = unifiedJson(value)
      response.headers.set('Set-Cookie', unifiedDocumentCookie(identity.token, request.url))
      return response
    }
    if (request.method === 'GET' && segments.length === 0) return unifiedJson({ workspace: await reader.workspace(identity.token, identity.context) })
    for (const handler of dependencies.handlers ?? []) {
      const result = await handler(request, segments, { ...identity, transport })
      if (result) return result
    }
    return unifiedJson({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
  } catch (error) { return unifiedHttpFailure(error) }
}
