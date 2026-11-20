type Environment = Record<string, string | undefined>

export const ISOLATED_APP_ORIGIN = process.env.PEA_LAB_PORT === '3101' ? 'http://127.0.0.1:3101' : 'http://127.0.0.1:3100'
export const ISOLATED_SUPABASE_ORIGIN = 'http://127.0.0.1:54321'
export const ISOLATED_FIXTURE_ANON_KEY = 'isolated-fixture-public-key'
export const ISOLATED_DISABLED_API_PATH = '/api/lab-auth/disabled'

// This evidence must come from the local runtime-file guard, never from an HTTP
// header or a provider variable inherited by the launcher. The fixture needs none.
export type VerifiedLocalRuntime = {
  projectId: string
  anonKey: string
  serviceRoleKey: string
}

export function isLoopbackUrl(value: string | undefined, allowQuery = false): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && (allowQuery || !url.search) && !url.hash
  } catch { return false }
}

const blockedConfiguration = /(?:^|_)(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|SECRET|PASSWORD|PRIVATE_KEY|DATABASE_URL|DATABASE_URI|DSN)$|^(?:PG|OPENAI_|RESEND_|STRIPE_|SQUARE_|GOOGLE_|META_|TURNSTILE_|PUBLIC_INTAKE_|SMTP_|SENDGRID_|MAILGUN_|DATABASE_|DB_|S3_|AWS_|AZURE_|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NODE_OPTIONS$|NODE_PATH$|NODE_TLS_REJECT_UNAUTHORIZED$|NODE_EXTRA_CA_CERTS$)/i
const localConfiguration = new Set(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_PEA_ISOLATED_DEVELOPMENT', 'PEA_ISOLATED_DEVELOPMENT', 'PEA_CLINICAL_FIXTURES', 'PEA_CLINICAL_RUNTIME', 'PEA_LOCAL_PROJECT_ID',
  'NEXT_TELEMETRY_DISABLED', 'CLINICAL_NOTES_AI_ENABLED', 'PEA_LAB_PORT'])

export function assertDevelopmentIsolation(environment: Environment, verified?: VerifiedLocalRuntime) {
  if (environment.PEA_ISOLATED_DEVELOPMENT !== 'true' || environment.NEXT_PUBLIC_PEA_ISOLATED_DEVELOPMENT !== 'true'
    || environment.PEA_CLINICAL_FIXTURES !== 'true') throw new Error('Le mode de développement fictif isolé est obligatoire.')
  if (environment.PEA_LAB_PORT && !['3100', '3101'].includes(environment.PEA_LAB_PORT)) throw new Error('Le port local du laboratoire est invalide.')
  if (environment.NEXT_PUBLIC_SUPABASE_URL !== ISOLATED_SUPABASE_ORIGIN || environment.NEXT_PUBLIC_APP_URL !== ISOLATED_APP_ORIGIN) {
    throw new Error('Le laboratoire accepte uniquement ses deux origines locales réservées.')
  }
  if (environment.CLINICAL_NOTES_AI_ENABLED !== 'false') throw new Error('L’IA externe doit rester désactivée dans l’environnement du lanceur.')
  if (['VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'NETLIFY', 'CF_PAGES', 'FLY_APP_NAME', 'RENDER'].some(key => Boolean(environment[key]))) {
    throw new Error('Le laboratoire local ne peut pas être déployé.')
  }
  const runtime = environment.PEA_CLINICAL_RUNTIME ?? 'fixture'
  if (!['fixture', 'local-db'].includes(runtime)) throw new Error('Le mode de stockage local est invalide.')
  if (runtime === 'fixture' && environment.NEXT_PUBLIC_SUPABASE_ANON_KEY !== ISOLATED_FIXTURE_ANON_KEY) {
    throw new Error('Le mode fictif ne peut utiliser une clé de fournisseur.')
  }
  if (runtime === 'local-db' && (!verified || !verified.projectId || !verified.anonKey || !verified.serviceRoleKey
    || environment.PEA_LOCAL_PROJECT_ID !== verified.projectId || environment.NEXT_PUBLIC_SUPABASE_ANON_KEY !== verified.anonKey
    || environment.SUPABASE_SERVICE_ROLE_KEY !== verified.serviceRoleKey)) throw new Error('La configuration du projet local n’a pas été vérifiée.')
  for (const [key, value] of Object.entries(environment)) {
    if (!value || localConfiguration.has(key) || (runtime === 'local-db' && key === 'SUPABASE_SERVICE_ROLE_KEY' && verified)) continue
    // Next.js adds these two runtime flags to its dev worker after the launcher has
    // sanitized the inherited environment. Keep every other Node override blocked.
    if (key === 'NODE_OPTIONS' && /^--max-old-space-size=\d+ --enable-source-maps$/.test(value)) continue
    if (blockedConfiguration.test(key) || /^NEXT_PUBLIC_/i.test(key) || /^SUPABASE_/i.test(key)) {
      throw new Error('Une configuration fournisseur ou réseau interdite est présente dans le laboratoire.')
    }
  }
}

export function installDevelopmentFetchGuard(environment: Environment, scope: { fetch: typeof fetch } = globalThis, verified?: VerifiedLocalRuntime, stripeTestEnabled = false, openAiPilotKey?: string) {
  assertDevelopmentIsolation(environment, verified)
  const original = scope.fetch
  scope.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let url: URL
    try { url = new URL(target) } catch { throw new Error('Développement isolé : accès réseau externe bloqué.') }
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const stripePath = url.pathname
    const stripeEndpoint = method === 'POST'
      ? ['/v1/checkout/sessions', '/v1/customers', '/v1/setup_intents', '/v1/payment_intents'].includes(stripePath)
      : method === 'GET' && (
        /^\/v1\/checkout\/sessions\/cs_test_[A-Za-z0-9]+$/.test(stripePath)
        || /^\/v1\/setup_intents\/seti_[A-Za-z0-9]+$/.test(stripePath)
        || /^\/v1\/payment_methods\/pm_[A-Za-z0-9]+$/.test(stripePath)
        || /^\/v1\/payment_intents\/pi_[A-Za-z0-9]+$/.test(stripePath))
    const stripe = stripeTestEnabled && url.origin === 'https://api.stripe.com' && stripeEndpoint && !url.search
      && /^Bearer sk_test_[A-Za-z0-9]+$/.test(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('Authorization') ?? '')
    const openAi = Boolean(openAiPilotKey && verified && environment.PEA_CLINICAL_RUNTIME === 'local-db'
      && url.origin === 'https://api.openai.com' && !url.search && method === 'POST'
      && ['/v1/audio/transcriptions', '/v1/responses'].includes(url.pathname)
      && new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('Authorization') === `Bearer ${openAiPilotKey}`)
    if (!([ISOLATED_APP_ORIGIN, ISOLATED_SUPABASE_ORIGIN].includes(url.origin) || stripe || openAi) || url.username || url.password || url.hash) {
      throw new Error('Développement isolé : accès réseau externe bloqué.')
    }
    return original(input, { ...init, redirect: 'error' })
  }) as typeof fetch
  return () => { scope.fetch = original }
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const networkError = () => new Error('Développement isolé : transport réseau externe bloqué.')
const localPipe = (path: unknown) => typeof path === 'string' && (path.startsWith('/') || path.toLowerCase().startsWith('\\\\.\\pipe\\'))

export function assertLocalSocketTarget(args: unknown[], stripeTestEnabled = false, openAiPilotEnabled = false) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  if (typeof first === 'string' && !/^\d+$/.test(first)) { if (localPipe(first)) return; throw networkError() }
  const options: Record<string, unknown> = first && typeof first === 'object' ? first as Record<string, unknown> : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' }
  if (options.path !== undefined && options.path !== null) { if (localPipe(options.path)) return; throw networkError() }
  const host = options.host ?? options.hostname ?? 'localhost'
  if (typeof host !== 'string' || !(loopbackHosts.has(host) || stripeTestEnabled && host === 'api.stripe.com' && Number(options.port) === 443
    || openAiPilotEnabled && host === 'api.openai.com' && Number(options.port) === 443) || options.lookup !== undefined) throw networkError()
}

type CallableScope = { [key: string]: (...args: unknown[]) => unknown }
export function installDevelopmentSocketGuard(scope: CallableScope, stripeTestEnabled = false, openAiPilotEnabled = false) {
  const original = scope.connect
  scope.connect = function (...args: unknown[]) { assertLocalSocketTarget(args, stripeTestEnabled, openAiPilotEnabled); return Reflect.apply(original, this, args) }
  return () => { scope.connect = original }
}

export function assertLocalHttpTarget(args: unknown[]) {
  const first = args[0]
  let url: URL | null = null
  try { if (typeof first === 'string' || first instanceof URL) url = new URL(first) } catch { throw networkError() }
  const overrides = (url ? args[1] : first) as Record<string, unknown> | undefined
  if (url && (url.username || url.password || !['http:', 'https:'].includes(url.protocol))) throw networkError()
  const host = overrides?.hostname ?? overrides?.host ?? url?.hostname ?? 'localhost'
  // Host:port belongs in the HTTP Host header, not the connection's hostname.
  if (typeof host !== 'string' || !loopbackHosts.has(host) || overrides?.lookup !== undefined
    || (overrides?.socketPath !== undefined && !localPipe(overrides.socketPath))) throw networkError()
}

export function installDevelopmentHttpGuard(scope: CallableScope) {
  const originals = { request: scope.request, get: scope.get }
  for (const method of ['request', 'get'] as const) {
    scope[method] = function (...args: unknown[]) { assertLocalHttpTarget(args); return Reflect.apply(originals[method], this, args) }
  }
  return () => { scope.request = originals.request; scope.get = originals.get }
}

export function developmentSecurityHeaders(production: boolean) {
  const directives = ["default-src 'self'", `script-src 'self' 'unsafe-inline' https://js.stripe.com${production ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self' blob:",
    `connect-src 'self' ${ISOLATED_SUPABASE_ORIGIN} ws://127.0.0.1:54321 ${ISOLATED_APP_ORIGIN.replace('http:', 'ws:')} https://api.stripe.com https://checkout.stripe.com`,
    "frame-src https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"]
  return [{ key: 'Content-Security-Policy', value: directives.join('; ') }, { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), display-capture=(self), payment=(), geolocation=()' }]
}

export function developmentLegacyApiRewrites() {
  // beforeFiles prevents loading a legacy handler. The reserved destination has
  // an unconditional 404 handler excluded from this rule, avoiding a loop.
  return [{ source: '/api/:path((?!(?:clinical-workspace|clinical-calendar|clinical-billing|lab-auth|cron/clinical-assignment-reminders)(?:/|$)).*)', destination: ISOLATED_DISABLED_API_PATH }]
}

// Page aliases exist only in this guarded local laboratory. Next preserves
// incoming query parameters; legacy API handlers remain disabled independently.
export function developmentLegacyPageRedirects() {
  return [
    ['/login', '/connexion'],
    ['/direction', '/administration'],
    ['/direction/calendrier', '/administration/appels?tab=calendar'],
    ['/direction/prospects', '/administration/appels'],
    ['/direction/liste-attente', '/administration/attente'],
    ['/direction/assignations-en-cours', '/administration/demarches'],
    ['/direction/taches-administratives', '/administration/taches'],
    ['/direction/professionnels', '/administration/professionnels'],
    ['/direction/journal-audit', '/administration/journal'],
    ['/professionnel', '/clinique/mon-profil'],
    ['/professionnel/demande', '/clinique/demandes'],
    ['/professionnel/preferences', '/clinique/mon-profil?tab=preferences'],
    ['/professionnel/clients', '/clinique/assignations'],
    ['/professionnel/historique', '/clinique/assignations?tab=history'],
  ].map(([source, destination]) => ({ source, destination, permanent: false }))
}
