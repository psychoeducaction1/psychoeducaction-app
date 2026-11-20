/** Prepared deployment contract. Selecting this profile requires a separately
 * authorised release; the local pilot continues to use its existing guard. */
type Environment = Record<string, string | undefined>
export const controlledMergeDestination = {
  app: 'https://app.psychoeducaction.com',
  supabase: 'https://ipqwkcvlinadthpkdzaz.supabase.co',
  project: 'psychoeducaction-app',
} as const
export const clinicalModules = ['records', 'calendar', 'mandates', 'billing', 'fees', 'migration', 'ai'] as const
export type ControlledClinicalModule = typeof clinicalModules[number]

export function readControlledMergeProfile(env: Environment) {
  if (env.PEA_CONTROLLED_MERGE !== 'true'
    || env.PEA_CLINICAL_RUNTIME !== 'real-db'
    || env.PEA_UNIFICATION_PILOT === 'true' || env.PEA_REAL_LOCAL_REHEARSAL === 'true'
    || env.NEXT_PUBLIC_APP_URL !== controlledMergeDestination.app
    || env.NEXT_PUBLIC_SUPABASE_URL !== controlledMergeDestination.supabase
    || env.PEA_CLINICAL_REAL_SUPABASE_URL !== controlledMergeDestination.supabase
    || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== env.PEA_CLINICAL_REAL_ANON_KEY
    || !(env.PEA_REAL_BILLING_JOB_ENABLED === 'false' || env.PEA_REAL_BILLING_JOB_ENABLED === 'true' && env.PEA_CONTROLLED_AUTOMATIC_BILLING === 'true')
    || !(env.PEA_REAL_INVOICE_EMAIL_MODE === 'disabled' || env.PEA_REAL_INVOICE_EMAIL_MODE === 'manual' && env.PEA_CONTROLLED_MANUAL_INVOICE_EMAIL === 'true')
    || env.PEA_CLINICAL_LEGACY_BRIDGE === 'true'
    || env.PEA_REMOTE_SIGNATURE_TEST_DELIVERY !== '0') throw new Error('CONTROLLED_MERGE_CONFIGURATION_REFUSED')
  const accounts = (env.PEA_CONTROLLED_CLINICAL_ACCOUNTS ?? '').split(',').map(v => v.trim()).filter(Boolean)
  if (accounts.some(v => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))) throw new Error('CONTROLLED_MERGE_ACCOUNT_INVALID')
  const modules = (env.PEA_CONTROLLED_CLINICAL_MODULES ?? '').split(',').map(v => v.trim()).filter(Boolean)
  if (modules.some(v => !(clinicalModules as readonly string[]).includes(v))) throw new Error('CONTROLLED_MERGE_MODULE_INVALID')
  const aiAccounts = (env.PEA_CONTROLLED_AI_ACCOUNTS ?? '').split(',').map(v => v.trim()).filter(Boolean)
  if (aiAccounts.some(id => !accounts.includes(id))) throw new Error('CONTROLLED_MERGE_AI_ACCOUNT_INVALID')
  return { accounts: new Set(accounts), aiAccounts: new Set(aiAccounts), modules: new Set(modules), origin: controlledMergeDestination.app }
}

/** Call only with the identity validated by Supabase Auth, never a submitted ID. */
export function controlledClinicalAccess(env: Environment, verifiedUserId: string, module: ControlledClinicalModule): boolean {
  const profile = readControlledMergeProfile(env)
  return profile.accounts.has(verifiedUserId) && profile.modules.has(module)
    && (module !== 'ai' || profile.aiAccounts.has(verifiedUserId))
}

/** Identity is decoded only AFTER Supabase Auth has validated this exact token. */
export function assertControlledRequestAccess(env: Environment, requestUrl: string, verifiedToken: string): void {
  const profile = readControlledMergeProfile(env)
  const url = new URL(requestUrl)
  if (url.origin !== profile.origin) throw new Error('CONTROLLED_MERGE_ORIGIN_REFUSED')
  const claims: unknown = JSON.parse(Buffer.from(verifiedToken.split('.')[1] ?? '', 'base64url').toString('utf8'))
  if (!claims || typeof claims !== 'object' || !('sub' in claims) || typeof claims.sub !== 'string'
    || !profile.accounts.has(claims.sub)) throw new Error('CONTROLLED_MERGE_ACCOUNT_REFUSED')
  const path = url.pathname.replace(/^\/api\/clinical-workspace\/?/, '')
  const area: ControlledClinicalModule = /^(?:billing\/)?fees(?:\/|$)/.test(path) ? 'fees'
    : /^billing(?:\/|$)/.test(path) ? 'billing'
    : /^(?:calendar|capacity-offers)(?:\/|$)/.test(path) ? 'calendar'
    : /^mandates(?:\/|$)/.test(path) ? 'mandates'
    : /^migration(?:\/|$)/.test(path) ? 'migration'
    : /(?:note-assistance|ai)(?:\/|$)/.test(path) ? 'ai' : 'records'
  if (['identity', 'session', ''].includes(path)) {
    if (profile.modules.size === 0) throw new Error('CONTROLLED_MERGE_MODULE_REFUSED')
  } else if (!profile.modules.has(area)) throw new Error('CONTROLLED_MERGE_MODULE_REFUSED')
  if (area === 'ai' && !profile.aiAccounts.has(claims.sub)) throw new Error('CONTROLLED_MERGE_AI_ACCOUNT_REFUSED')
}

/** Both the verified administrator and selected professional must be in the rollout. */
export function controlledAssignmentEnabled(env: Environment, actorId: string, professionalId: unknown): boolean {
  if (env.PEA_CONTROLLED_MERGE !== 'true') return false
  const profile = readControlledMergeProfile(env)
  return profile.modules.has('records') && profile.modules.has('mandates')
    && profile.accounts.has(actorId) && typeof professionalId === 'string' && profile.accounts.has(professionalId)
}

export function controlledClinicalHeaders(env: Environment) {
  readControlledMergeProfile(env)
  const api = controlledMergeDestination.supabase
  return [
    { key: 'Content-Security-Policy', value: ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self' blob:", `connect-src 'self' ${api} ${api.replace('https:', 'wss:')}`, "frame-src 'self' blob:", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ') },
    { key: 'Cache-Control', value: 'private, no-store' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), display-capture=(self), payment=(), geolocation=()' },
  ]
}
