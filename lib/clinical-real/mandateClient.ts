import { supabase } from '@/lib/supabaseClient'

export type RealMandatePerson = {
  id: string
  fullName: string
  role: 'client' | 'representative' | 'payer'
  sourceRepresentativeId: string | null
  canConsent: boolean
}
export type RealMandateSummary = {
  mandateId: string
  patientId: string
  patientName: string
  under14: boolean | null
  revisionId: string
  version: number
  status: 'draft' | 'prepared' | 'partially_signed' | 'signed' | 'archived'
  service: string
  canManage: boolean
  canEdit: boolean
  clinicalText: string
  administrativeText: string | null
  rateCents: number | null
  availablePeople: RealMandatePerson[] | null
  people: RealMandatePerson[]
  payers: { personId: string; basisPoints: number }[] | null
  signers: { personId: string; audience: 'clinical' | 'administrative'; required: boolean; signedAt: string | null }[]
  documents: { id: string; audience: 'clinical' | 'administrative'; sha256: string }[]
}
export type RealMandateVersion = {
  revisionId: string
  number: number
  status: RealMandateSummary['status']
  createdAt: string
  preparedAt: string | null
  isCurrent: boolean
  documents: RealMandateSummary['documents']
}
const root = '/api/clinical-workspace/mandates'
async function token() {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Reconnectez-vous pour accéder au mandat.')
  return data.session.access_token
}
async function request(path: string, method = 'GET', payload?: unknown): Promise<Response> {
  const accessToken = await token()
  const response = await fetch(root + path, {
    method, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${accessToken}`,
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = body && typeof body.error === 'string' ? body.error : 'Le mandat est indisponible.'
    throw new Error(message)
  }
  return response
}
export async function loadRealMandate(caseId: string): Promise<RealMandateSummary | null> {
  const response = await request(`/cases/${caseId}`)
  return (await response.json()).mandate as RealMandateSummary | null
}
export async function loadRealMandateVersions(caseId: string): Promise<RealMandateVersion[]> {
  const response = await request(`/cases/${caseId}/versions`)
  return (await response.json()).versions as RealMandateVersion[]
}
export async function newRealMandateVersion(summary: RealMandateSummary) {
  await request(`/revisions/${summary.revisionId}/new-version`, 'POST',
    { expectedVersion: summary.version })
}
export async function saveRealMandate(summary: RealMandateSummary, data: Record<string, unknown>) {
  await request(`/revisions/${summary.revisionId}/draft`, 'PATCH',
    { expectedVersion: summary.version, data })
}
export async function prepareRealMandate(summary: RealMandateSummary) {
  await request(`/revisions/${summary.revisionId}/prepare`, 'POST',
    { expectedVersion: summary.version })
}
export async function signRealMandate(summary: RealMandateSummary, personId: string,
  audience: 'clinical' | 'administrative', documentId: string, documentHash: string, name: string) {
  await request(`/revisions/${summary.revisionId}/sign`, 'POST', {
    expectedVersion: summary.version, personId, audience, documentId, documentHash,
    mode: 'in_person_typed', evidence: { name, attested: true },
  })
}
export async function inviteRealMandate(summary: RealMandateSummary, personId: string,
  audience: 'clinical' | 'administrative', recipientEmail: string) {
  await request(`/revisions/${summary.revisionId}/invite`, 'POST', {
    expectedVersion: summary.version, personId, audience, recipientEmail,
  })
}
export async function openRealMandatePdf(documentId: string): Promise<void> {
  const tab = window.open('', '_blank')
  if (!tab) throw new Error('Autorisez les fenêtres de cette application pour voir le PDF.')
  tab.opener = null
  try {
    const response = await request(`/documents/${documentId}`)
    const blob = await response.blob()
    if (blob.type !== 'application/pdf') throw new Error('Document PDF invalide.')
    const url = URL.createObjectURL(blob)
    tab.location.href = url
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (cause) {
    tab.close()
    throw cause
  }
}
