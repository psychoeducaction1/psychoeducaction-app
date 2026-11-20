import { assertControlledRequestAccess } from './controlledMergeProfile.ts'
import type { ClinicalAccessContext } from '../clinical-core/types'
import { realClinicalTransport } from '../clinical-real/transport.ts'
import { assertUnificationRuntime } from './isolation.ts'
import { withUnifiedDocumentAuthorization } from './authDocumentCookie.ts'

export class UnifiedAuthenticationError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code }
}

type AuthenticationTransport = { authenticate(request: Request): Promise<string | null> }

/** The validated user JWT is propagated to RPCs, which derive all rights from auth.uid(). */
export async function authenticateUnifiedRequest(
  request: Request,
  transport?: AuthenticationTransport,
  assertIsolation: () => void = assertUnificationRuntime,
): Promise<{ token: string; context: ClinicalAccessContext }> {
  assertIsolation()
  request = withUnifiedDocumentAuthorization(request)
  const origin = request.headers.get('Origin')
  if (origin && origin !== new URL(request.url).origin) throw new UnifiedAuthenticationError(403, 'ORIGIN_REFUSED')
  const context = request.headers.get('X-Clinical-Context')
  if (context !== 'administration' && context !== 'clinical') throw new UnifiedAuthenticationError(400, 'CONTEXT_REQUIRED')
  const token = await (transport ?? realClinicalTransport()).authenticate(request)
  if (!token) throw new UnifiedAuthenticationError(401, 'UNAUTHORIZED')
  if (process.env.PEA_CONTROLLED_MERGE === 'true') {
    try { assertControlledRequestAccess(process.env, request.url, token) }
    catch { throw new UnifiedAuthenticationError(403, 'CLINICAL_ACTIVATION_REQUIRED') }
  }
  // X-Clinical-Fixture-Actor is intentionally not read: it confers no identity or rights.
  return { token, context }
}
