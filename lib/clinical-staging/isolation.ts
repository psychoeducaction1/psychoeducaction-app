import { isStagingClinicalRuntime, stagingAllowedEmails } from './runtime.ts'

type Environment = Record<string, string | undefined>
const STAGING_SUPABASE_ORIGIN = 'https://csnmblsosfgjgljgtwyr.supabase.co'

export function assertStagingIsolation(environment: Environment = process.env) {
  if (!isStagingClinicalRuntime(environment)
    || environment.NODE_ENV !== 'production'
    || (environment.VERCEL_GIT_COMMIT_REF && environment.VERCEL_GIT_COMMIT_REF !== 'feature/plateforme-clinique')
    || environment.PEA_ISOLATED_DEVELOPMENT === 'true'
    || environment.CLINICAL_NOTES_AI_ENABLED !== 'false'
    || !environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || !environment.SUPABASE_SERVICE_ROLE_KEY
    || environment.NEXT_PUBLIC_SUPABASE_ANON_KEY === environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('STAGING_ISOLATION_REFUSED')
  }
  stagingAllowedEmails(environment)
}

export function installStagingFetchGuard(environment: Environment = process.env, scope: { fetch: typeof fetch } = globalThis) {
  assertStagingIsolation(environment)
  const original = scope.fetch
  const appOrigin = environment.NEXT_PUBLIC_APP_URL!
  scope.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let url: URL
    try { url = new URL(target) } catch { throw new Error('STAGING_NETWORK_REFUSED') }
    if (![STAGING_SUPABASE_ORIGIN, appOrigin].includes(url.origin)
      || url.username || url.password || url.hash) throw new Error('STAGING_NETWORK_REFUSED')
    return original(input, { ...init, redirect: 'error' })
  }) as typeof fetch
  return () => { scope.fetch = original }
}

export function stagingSecurityHeaders() {
  const directives = ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self' blob:",
    `connect-src 'self' ${STAGING_SUPABASE_ORIGIN} wss://csnmblsosfgjgljgtwyr.supabase.co`,
    "frame-src 'none'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
    "form-action 'self'", "frame-ancestors 'none'"]
  return [{ key: 'Content-Security-Policy', value: directives.join('; ') },
    { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), display-capture=(), payment=(), geolocation=()' }]
}
