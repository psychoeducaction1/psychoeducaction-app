type Environment = Record<string, string | undefined>

const localApi = 'http://127.0.0.1:55321'
const localApps = new Set(['http://127.0.0.1:3102', 'http://127.0.0.1:3103', 'http://127.0.0.1:3110'])
const hostedSupabase = /^https:\/\/[a-z0-9-]+\.supabase\.co$/

function rehearsalApi(environment: Environment): string {
  return environment.PEA_UNIFICATION_PILOT === 'true' ? 'http://127.0.0.1:56321' : localApi
}

export function isRealLocalRehearsal(environment: Environment): boolean {
  return environment.PEA_CLINICAL_RUNTIME === 'real-db'
    && environment.PEA_REAL_LOCAL_REHEARSAL === 'true'
    && (environment.NODE_ENV !== 'production' || environment.PEA_REAL_LOCAL_BUILD === 'true')
    && !environment.VERCEL && !environment.VERCEL_ENV
    && environment.NEXT_PUBLIC_SUPABASE_URL === rehearsalApi(environment)
    && environment.PEA_CLINICAL_REAL_SUPABASE_URL === rehearsalApi(environment)
    && localApps.has(environment.NEXT_PUBLIC_APP_URL ?? '')
    && !!environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
    && environment.NEXT_PUBLIC_SUPABASE_ANON_KEY === environment.PEA_CLINICAL_REAL_ANON_KEY
    && environment.PEA_REAL_BILLING_JOB_ENABLED !== 'true'
    && environment.PEA_REMOTE_SIGNATURE_TEST_DELIVERY !== '1'
    && (environment.PEA_REAL_INVOICE_EMAIL_MODE ?? 'disabled') === 'disabled'
    && !environment.RESEND_API_KEY
}

export function assertRealClinicalIsolation(environment: Environment) {
  if (isRealLocalRehearsal(environment)) return
  const app = environment.NEXT_PUBLIC_APP_URL
  if (environment.PEA_REAL_LOCAL_REHEARSAL === 'true'
    || environment.PEA_CLINICAL_RUNTIME !== 'real-db'
    || !hostedSupabase.test(environment.NEXT_PUBLIC_SUPABASE_URL ?? '')
    || environment.NEXT_PUBLIC_SUPABASE_URL !== environment.PEA_CLINICAL_REAL_SUPABASE_URL
    || environment.NEXT_PUBLIC_SUPABASE_ANON_KEY !== environment.PEA_CLINICAL_REAL_ANON_KEY
    || !app || !/^https:\/\/[a-z0-9.-]+$/.test(app))
    throw new Error('Configuration clinique réelle refusée.')
}

export function installRealLocalFetchGuard(environment: Environment) {
  if (!isRealLocalRehearsal(environment)) throw new Error('Recette clinique locale refusée.')
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(target)
    if ((url.origin !== rehearsalApi(environment) && !localApps.has(url.origin)) || url.username || url.password || url.hash)
      throw new Error('Recette clinique : accès réseau externe bloqué.')
    return original(input, { ...init, redirect: 'error' })
  }) as typeof fetch
}

export function realClinicalSecurityHeaders(environment: Environment) {
  assertRealClinicalIsolation(environment)
  const origin = environment.NEXT_PUBLIC_SUPABASE_URL!
  const socket = origin.replace(/^http/, 'ws')
  const local = isRealLocalRehearsal(environment)
  const directives = ["default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://js.stripe.com${local ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "font-src 'self' data:", "media-src 'self' blob:",
    `connect-src 'self' ${origin} ${socket} https://api.stripe.com`,
    "frame-src https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com",
    "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
    "form-action 'self'", "frame-ancestors 'none'"]
  return [{ key: 'Content-Security-Policy', value: directives.join('; ') },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), display-capture=(self), payment=(), geolocation=()' }]
}
