import type { ClinicalAccessContext, FixtureActor } from '../clinical-core/types'

/** Build-time switch; the server independently enforces the isolated runtime. */
export function isUnifiedClinicalClient(): boolean {
  return process.env.NEXT_PUBLIC_PEA_CLINICAL_UNIFICATION === 'true'
}

export class UnifiedSessionError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) {
    super(message); this.status = status; this.code = code
  }
}

type SessionResult = { data: { session: { access_token: string } | null }; error: unknown }
type SessionReader = () => Promise<SessionResult>
const tokenPattern = /^[A-Za-z0-9._~-]{1,8192}$/

/** No privileged credential or client-supplied actor is used as authentication. */
export async function unifiedAuthorizationHeaders(readSession: SessionReader): Promise<Record<string, string>> {
  const { data, error } = await readSession()
  const token = data.session?.access_token
  if (error || typeof token !== 'string' || !tokenPattern.test(token)) {
    throw new UnifiedSessionError('Reconnectez-vous pour accéder à cet espace.', 401, 'UNAUTHORIZED')
  }
  return { Authorization: `Bearer ${token}` }
}

/** Shared by original laboratory transports, including PDF and calendar requests. */
export async function clinicalSessionHeaders(): Promise<Record<string, string>> {
  if (!isUnifiedClinicalClient()) return {}
  if (typeof window === 'undefined' || !isUnifiedClientOrigin(window.location.origin)) {
    throw new UnifiedSessionError('Ce pilote est réservé à la copie locale isolée.', 403, 'UNIFICATION_ORIGIN_REFUSED')
  }
  const { supabase } = await import('@/lib/supabaseClient')
  return unifiedAuthorizationHeaders(() => supabase.auth.getSession())
}

/** Keep the original request body and UI flow while attaching the caller's session. */
export async function clinicalSessionFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/api/clinical-workspace/') || /[\\#\r\n]/.test(path)) {
    throw new UnifiedSessionError('Chemin clinique invalide.', 400, 'INVALID_PATH')
  }
  const headers = new Headers(init.headers)
  for (const [name, value] of Object.entries(await clinicalSessionHeaders())) headers.set(name, value)
  return fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
}

export type UnifiedIdentity = { mode: 'isolated_unified'; durable: true; actor: FixtureActor }

export function readUnifiedIdentity(value: unknown): UnifiedIdentity {
  if (!value || typeof value !== 'object') throw new UnifiedSessionError('Identité du pilote invalide.', 502, 'INVALID_IDENTITY')
  const data = value as Record<string, unknown>
  const actor = data.actor as Record<string, unknown> | undefined
  if (data.mode !== 'isolated_unified' || data.durable !== true || !actor
    || typeof actor.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actor.id)
    || typeof actor.displayName !== 'string'
    || !['admin', 'assistant', 'professional', 'supervisor'].includes(String(actor.role))
    || !Array.isArray(actor.capabilities) || actor.capabilities.some(item => !['administration', 'practice', 'supervision'].includes(item))
    || !Array.isArray(actor.permissions) || actor.permissions.some(item => item !== 'manage_clinical_access')) {
    throw new UnifiedSessionError('Identité du pilote invalide.', 502, 'INVALID_IDENTITY')
  }
  return data as UnifiedIdentity
}

export async function loadUnifiedIdentity(context: ClinicalAccessContext, signal?: AbortSignal): Promise<UnifiedIdentity> {
  const response = await fetch('/api/clinical-workspace/identity', {
    cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal,
    headers: { ...await clinicalSessionHeaders(), 'X-Clinical-Context': context },
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new UnifiedSessionError('La session ou les droits ne permettent pas d’ouvrir cet espace.', response.status, response.status === 401 ? 'UNAUTHORIZED' : 'IDENTITY_UNAVAILABLE')
  return readUnifiedIdentity(payload)
}

export async function completeUnifiedSignOut(clearDocuments: () => Promise<{ ok: boolean }>, clearSession: () => Promise<{ error: unknown }>): Promise<void> {
  let incomplete = false
  try { if (!(await clearDocuments()).ok) incomplete = true } catch { incomplete = true }
  // Never leave the local Auth session behind when cookie deletion fails.
  try { if ((await clearSession()).error) incomplete = true } catch { incomplete = true }
  if (incomplete) throw new UnifiedSessionError('La déconnexion complète n’a pas pu être confirmée. Réessayez lorsque la connexion sera rétablie.', 503, 'SIGNOUT_UNAVAILABLE')
}

export async function clearUnifiedLocalAuth(auth: { stopAutoRefresh(): Promise<void>; signOut(options: { scope: 'local' }): Promise<{ error: unknown }> }, storage: Pick<Storage, 'removeItem'>, key: string, onPendingAuth: () => void = () => {}, timeoutMs = 8000): Promise<{ error: unknown }> {
  if (!/^sb-[a-z0-9-]+-auth-token$/.test(key)) throw new Error('AUTH_STORAGE_KEY_REFUSED')
  let error: unknown = null
  let pending = false
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => { pending = true; reject(new Error('SIGNOUT_TIMED_OUT')) }, timeoutMs) })]) }
    finally { if (timer) clearTimeout(timer) }
  }
  try { await bounded(auth.stopAutoRefresh()); error = (await bounded(auth.signOut({ scope: 'local' }))).error } catch (cause) { error = cause }
  finally {
    for (const suffix of ['', '-code-verifier', '-user']) {
      try { storage.removeItem(key + suffix) } catch (cause) { error = cause }
    }
  }
  // The SDK returns early on an Auth network error. With its persisted session
  // removed, this second call clears its local state and emits SIGNED_OUT without
  // an access token or another logout request. Keep the first failure explicit.
  if (error && !pending) { try { await bounded(auth.signOut({ scope: 'local' })) } catch { /* Local entries are already removed. */ } }
  // A timed-out SDK operation can still own a Web Lock. Do not queue another
  // sign-out behind it; the browser unloads this instance after local cleanup.
  if (pending) onPendingAuth()
  return { error }
}

export async function signOutUnifiedSession(): Promise<void> {
  if (typeof window === 'undefined' || !isUnifiedClientOrigin(window.location.origin)) {
    throw new UnifiedSessionError('Ce pilote est réservé à la copie locale isolée.', 403, 'UNIFICATION_ORIGIN_REFUSED')
  }
  const { supabase, supabaseAuthStorageKey } = await import('@/lib/supabaseClient')
  await completeUnifiedSignOut(
    () => fetch('/api/clinical-workspace/session', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) }),
    () => clearUnifiedLocalAuth(supabase.auth, window.localStorage, supabaseAuthStorageKey, () => window.location.replace('/login')),
  )
}

export function isUnifiedClientOrigin(origin: string): boolean {
  if (process.env.NEXT_PUBLIC_PEA_CONTROLLED_MERGE === 'true') return origin === 'https://app.psychoeducaction.com'
  return ['http://127.0.0.1:3102', 'http://127.0.0.1:3103', 'http://127.0.0.1:3110'].includes(origin)
}
