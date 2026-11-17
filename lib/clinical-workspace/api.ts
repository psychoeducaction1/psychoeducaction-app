import { clinicalUiText } from './presentationText.ts'
import type { ClinicalAccessContext, ClinicalActorInput } from '@/lib/clinical-core/types'
import { clinicalSessionHeaders, UnifiedSessionError } from '@/lib/clinical-unification/authClient'

export class ClinicalApiError extends Error {
  status: number
  code: string | undefined
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code }
}

/** Certain permission refusals invalidate locally displayed clinical material. */
export function isClinicalAccessDenied(cause: unknown): boolean {
  return cause instanceof ClinicalApiError && (cause.status === 401 || cause.status === 403)
}

export function clinicalContextFromPath(pathname: string): ClinicalAccessContext {
  return /^\/administration(?:\/|$)/.test(pathname) ? 'administration' : 'clinical'
}

async function sessionHeaders(): Promise<Record<string, string>> {
  try { return await clinicalSessionHeaders() }
  catch (cause) {
    if (cause instanceof UnifiedSessionError) throw new ClinicalApiError(cause.message, cause.status, cause.code)
    throw cause
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]))
  return value
}

type Intent = { storage: Storage; key: string; id: string }
async function mutationIntent(actorId: string, context: ClinicalAccessContext, method: string, path: string, body: string): Promise<Intent> {
  try {
    if (typeof window === 'undefined' || !globalThis.crypto?.subtle) throw new Error('Unavailable intent storage')
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([actorId, context, method, path, body])))
    const key = `pea.lab.intent.v1:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
    const storage = window.sessionStorage
    const previous = storage.getItem(key)
    const id = previous && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previous) ? previous : globalThis.crypto.randomUUID()
    storage.setItem(key, id)
    if (storage.getItem(key) !== id) throw new Error('Intent not retained')
    return { storage, key, id }
  } catch { throw new ClinicalApiError(clinicalUiText("Le navigateur ne peut pas conserver cette opération pour une reprise fiable. Autorisez le stockage de session du laboratoire avant de réessayer.","Le navigateur ne peut pas conserver cette opération pour une reprise fiable. Autorisez le stockage de session de l’application avant de réessayer."), 503, 'INTENT_STORAGE_UNAVAILABLE') }
}

export async function clinicalRequest<T>(actor: ClinicalActorInput, path = '', body?: Record<string, unknown>, method = 'GET', signal?: AbortSignal, explicitContext?: ClinicalAccessContext, validateResponse?: (value: unknown) => boolean): Promise<T> {
  if (path && (!path.startsWith('/') || path.startsWith('//') || /[?#]/.test(path))) throw new ClinicalApiError(clinicalUiText("Chemin du laboratoire invalide.","Adresse de la page invalide."), 400, 'INVALID_PATH')
  const actorId = typeof actor === 'string' ? actor : actor.actorId
  const context = explicitContext ?? (typeof actor === 'object' ? actor.context : clinicalContextFromPath(typeof window === 'undefined' ? '/clinique' : window.location.pathname))
  const serialized = body ? JSON.stringify(canonical(body)) : undefined
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
  // Only SHA-256 fingerprints and random UUIDs survive a reload. No body, client
  // name, clinical text, password or session token is stored by this helper.
  const intent = mutation ? await mutationIntent(actorId, context, method.toUpperCase(), path, serialized ?? '') : undefined
  const response = await fetch(`/api/clinical-workspace${path}`, {
    method, cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal,
    headers: { ...await sessionHeaders(), 'X-Clinical-Fixture-Actor': actorId, 'X-Clinical-Context': context,
      ...(serialized ? { 'Content-Type': 'application/json' } : {}), ...(intent ? { 'Idempotency-Key': intent.id } : {}) },
    ...(serialized ? { body: serialized } : {}),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    // A lost response, abort, 408/429 or server failure may follow a commit.
    // Preserve its key; only a certain refusal can end that intention.
    if (intent && response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) intent.storage.removeItem(intent.key)
    throw new ClinicalApiError(payload?.error ?? 'L’opération n’a pas pu être confirmée.', response.status, payload?.code)
  }
  let valid = Boolean(payload && typeof payload === 'object')
  try { if (valid && validateResponse) valid = validateResponse(payload) } catch { valid = false }
  if (!valid) throw new ClinicalApiError('Réponse inattendue. Actualisez la section sans perdre votre saisie.', 502, 'INVALID_RESPONSE')
  if (intent) intent.storage.removeItem(intent.key)
  return payload as T
}

export async function clinicalNotePdf(actorId: string, context: ClinicalAccessContext, noteId: string): Promise<Blob> {
  if (!/^[0-9a-f-]{36}$/i.test(noteId)) throw new ClinicalApiError('Identifiant de note invalide.', 400, 'INVALID_PATH')
  const response = await fetch(`/api/clinical-workspace/notes/${noteId}/pdf`, { cache: 'no-store', credentials: 'same-origin', redirect: 'error', headers: { ...await sessionHeaders(), 'X-Clinical-Fixture-Actor': actorId, 'X-Clinical-Context': context } })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new ClinicalApiError(payload?.error ?? 'Le PDF de la note ne peut pas être ouvert.', response.status, payload?.code)
  }
  if (!response.headers.get('Content-Type')?.startsWith('application/pdf')) throw new ClinicalApiError('Le document reçu n’est pas un PDF.', 502, 'INVALID_RESPONSE')
  return response.blob()
}
