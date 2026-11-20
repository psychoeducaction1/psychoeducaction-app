import { supabase } from '@/lib/supabaseClient'

export type RealDirectoryEntry = { patientId: string; firstName: string; lastName: string;
  birthDate: string | null; caseId: string | null; caseStatus: string | null; caseLabel: string | null }
export type RealAppointment = { id: string; caseId: string; clientId: string; professionalId: string;
  officeId: string | null; startAt: string; endAt: string; modality: string; status: string; version: number;
  travelBeforeMinutes: number; travelAfterMinutes: number;
  billable?: boolean; billingDecisionRecorded?: boolean; billingPrepared?: boolean }
export type RealCase = { id: string; label: string; status: string; patientId: string;
  firstName: string; lastName: string; birthDate: string | null; appointments: RealAppointment[];
  service?: string; consultationReason?: string; legacyWaitingListId?: string | null;
  professionals: { id: string; name: string }[]; offices: { id: string; name: string }[] }
export type RealCaseAdministration = { caseId: string;
  contacts: { id: string; name: string; relationship: string; email: string; phone: string }[];
  representatives: { id: string; name: string; relationship: string; authorityVerified: boolean }[];
  payers: { id: string; name: string; type: string; email: string }[] }
export type RealCaseLegacySource = { waitingListId: string; requesters: string[];
  emails: string[]; phones: string[]; city: string | null; service: string | null }
export type RealNoteMeta = { id: string; title: string; noteType: string; encounterDate: string;
  status: string; version: number; appointmentId: string | null; authorId: string }
export type RealNote = RealNoteMeta & { content: Record<string, string> }
export type RealLegacyDocument = { id: string; caseId: string; label: string;
  pageCount: number | null; sha256: string; importedAt: string }
export type RealCaseClosure = { mode: 'administrative' | 'no_encounter' | 'note';
  reason: string; noteId: string | null; closedAt: string; actorId: string }
export type RealCalendarClosure = { caseId: string; closedAt: string;
  professionalId: string; noteId: string }

/** Direct RPC avoids the hosting platform's small request-body limit for PDF uploads.
 * The database function independently checks the authenticated user's case rights. */
export async function realLegacyImportPdf(args: { caseId: string; sourceId: string;
  label: string; sha256: string; base64: string; pageCount?: number }): Promise<void> {
  const { data: session, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !session.session?.access_token) throw new Error('Reconnectez-vous avant l’import.')
  const { error } = await supabase.rpc('clinical_import_legacy_document', {
    p_case_id: args.caseId, p_source_id: args.sourceId, p_label: args.label,
    p_page_count: args.pageCount ?? null, p_sha256: args.sha256, p_base64: args.base64,
  })
  if (error) throw new Error('Import impossible. Vérifiez l’accès au dossier, le type et la taille du PDF.')
}

export async function realWorkspaceRequest<T>(path: string, method = 'GET', body?: Record<string, unknown>): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//') || /[#\\]/.test(path)) throw new Error('Chemin clinique invalide.')
  const parsed = new URL(path, 'http://clinical.local')
  if (parsed.origin !== 'http://clinical.local' || (parsed.search && !['/directory', '/calendar', '/calendar/closures'].includes(parsed.pathname)))
    throw new Error('Chemin clinique invalide.')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Reconnectez-vous pour ouvrir le dossier clinique.')
  const response = await fetch('/api/clinical-workspace/real' + path, {
    method, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Espace clinique indisponible.')
  return result as T
}

export async function realLegacyDocumentPdf(id: string): Promise<Blob> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new Error('Document invalide.')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Reconnectez-vous pour ouvrir le document.')
  const response = await fetch(`/api/clinical-workspace/real/legacy-documents/${id}`, {
    method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  })
  if (!response.ok) throw new Error('Document historique indisponible ou accès refusé.')
  return response.blob()
}

export async function realNoteAssistanceRequest<T>(appointmentId: string, body?: Record<string, unknown>): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appointmentId))
    throw new Error('Rencontre invalide.')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Reconnectez-vous pour utiliser l’aide IA.')
  const response = await fetch('/api/clinical-workspace/note-assistance' + (body ? '' : `?appointmentId=${appointmentId}`), {
    method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify({ ...body, appointmentId }) : undefined,
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'L’aide IA est indisponible.')
  return result as T
}

export async function realNoteAudioRequest(appointmentId: string, file: File): Promise<{ transcript: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appointmentId))
    throw new Error('Rencontre invalide.')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Reconnectez-vous pour transcrire l’audio.')
  const form = new FormData()
  form.set('fictional', 'true')
  form.set('audio', file)
  const response = await fetch(`/api/clinical-workspace/note-assistance?appointmentId=${appointmentId}`, {
    method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${data.session.access_token}` }, body: form,
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Transcription indisponible.')
  if (typeof result?.transcript !== 'string') throw new Error('Transcription invalide.')
  return { transcript: result.transcript }
}
