import { supabase } from '@/lib/supabaseClient'
import { unifiedAuthorizationHeaders } from '@/lib/clinical-unification/authClient'
import { procedureUuid } from './model'
import { procedurePdfMaxBytes, type ProcedurePdf, type ProcedurePdfInput } from './pdfModel'

export class ProcedureError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function pdfResponse(path: string, signal?: AbortSignal, body?: ProcedurePdfInput) {
  const headers = await unifiedAuthorizationHeaders(() => supabase.auth.getSession())
  const response = await fetch('/api/procedures/files' + path, { method: body ? 'POST' : 'GET', headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' })
  if (!response.ok) { const payload = await response.json().catch(() => null); throw new ProcedureError(payload?.error ?? 'Documents indisponibles.', response.status) }
  return response
}
export async function listProcedurePdfs(articleId: string, signal?: AbortSignal): Promise<{ canEdit: boolean; files: ProcedurePdf[] }> {
  if (!procedureUuid.test(articleId)) throw new ProcedureError('Procédure invalide.', 400)
  return (await pdfResponse('?article=' + articleId, signal)).json()
}
export async function saveProcedurePdf(input: ProcedurePdfInput) { return (await pdfResponse('', undefined, input)).json() as Promise<{ id: string; version: number }> }
export async function readProcedurePdf(id: string, signal?: AbortSignal): Promise<Blob> {
  if (!procedureUuid.test(id)) throw new ProcedureError('Document invalide.', 400)
  const response = await pdfResponse('/' + id, signal)
  if (response.headers.get('content-type') !== 'application/pdf') throw new ProcedureError('Document non vérifiable.', 502)
  const blob = await response.blob()
  if (!blob.size || blob.size > procedurePdfMaxBytes) throw new ProcedureError('Document non vérifiable.', 502)
  return blob
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
