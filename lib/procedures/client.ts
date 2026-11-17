import { supabase } from '@/lib/supabaseClient'
import { unifiedAuthorizationHeaders } from '@/lib/clinical-unification/authClient'

export class ProcedureError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export async function procedureRequest<T>(body?: Record<string, unknown>, signal?: AbortSignal, accessOnly = false): Promise<T> {
  const headers = await unifiedAuthorizationHeaders(() => supabase.auth.getSession())
  const response = await fetch('/api/procedures' + (accessOnly ? '?access=1' : ''), {
    method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal,
    headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new ProcedureError(payload?.error ?? 'Les procédures sont indisponibles.', response.status)
  if (!payload || typeof payload !== 'object') throw new ProcedureError('Réponse inattendue. Actualisez avant de réessayer.', 502)
  return payload as T
}
