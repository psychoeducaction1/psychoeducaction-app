import { supabase } from '@/lib/supabaseClient'

export type RealBillingInvoice = {
  id: string; patientId: string; caseId: string; patientName: string;
  professionalName: string; payerName: string; status: 'open' | 'closed';
  number: number | null; totalCents: number; paidCents: number; dueCents: number;
  lastPaymentAt: string | null; lastPaymentCents: number | null;
  version: number; createdAt: string; closedAt: string | null;
}
export type RealBillingDetail = RealBillingInvoice & {
  lines: { appointmentId: string; serviceAt: string; service: string; amountCents: number; kind: string }[];
  payments: { id: string; amountCents: number; method: string; receivedAt: string }[];
}
export type RealBillingReconciliation = { processedCases: number; blockedCaseIds: string[] }
export type RealOpeningFeePolicy = {
  patientId: string; decision: 'charge' | 'waive' | null; reason: string | null; locked: boolean
}
export type RealBillingSettings = { openingFeeCents: number; firstReminderDays: number;
  secondReminderDays: number; version: number; changedAt: string }

async function request(path: string, method = 'GET', payload?: unknown): Promise<Response> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Reconnectez-vous pour accéder à la facturation.')
  const response = await fetch('/api/clinical-workspace/billing/' + path, {
    method, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${data.session.access_token}`,
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(typeof result?.error === 'string' ? result.error : 'La facturation est indisponible.')
  }
  return response
}
async function feeRequest(path: string, method = 'GET', payload?: unknown): Promise<Response> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Reconnectez-vous pour accéder aux honoraires.')
  const response = await fetch('/api/clinical-workspace/fees/' + path, {
    method, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${data.session.access_token}`,
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(typeof result?.error === 'string' ? result.error : 'Les honoraires sont indisponibles.')
  }
  return response
}
export type RealFeeStatement = { id: string; professionalId: string; from: string; to: string;
  totalCents: number; validatedAt: string }
export type RealFeeRule = 'standard' | 'legacy_80' | 'legacy_supervised_110_35' | 'owner_full_clinic' | 'service_libre'
export type RealFeeCategory = 'intervenant_psychoeducation' | 'psychoeducateur_membre_ordre' | 'psychotherapeute'
export type RealFeeContract = { id: string; professionalId: string; effectiveFrom: string;
  rule: RealFeeRule; category: RealFeeCategory | null; supervisorId: string | null;
  reason: string; createdAt: string }
export type RealFeePreview = { appointments: number; totalCents: number; supervisorCents?: number;
  blocked: boolean; quoteHash?: string; warnings: { sourceId: string; code: string }[];
  lines: { appointmentId: string | null; adjustmentId?: string | null;
    trueupAppointmentId?: string | null; trueupAdjustmentId?: string | null; serviceAt: string;
    kind?: string; serviceCents?: number; basisPoints?: number; feeCents: number;
    supervisorCents?: number; weeklyMeetingCount?: number }[] }
export async function realFeePreview(professionalId: string, from: string, to: string) {
  const query = new URLSearchParams({ professionalId, from, to })
  const response = await feeRequest(`preview?${query}`)
  return (await response.json()).preview as RealFeePreview
}
export async function realFeeStatements(professionalId?: string) {
  const response = await feeRequest('statements' + (professionalId ? `?professionalId=${encodeURIComponent(professionalId)}` : ''))
  return (await response.json()).statements as RealFeeStatement[]
}
export async function openRealFeeStatementPdf(id: string) {
  const tab = window.open('', '_blank')
  if (!tab) throw new Error('Autorisez les fenêtres pour voir le relevé.')
  tab.opener = null
  try {
    const response = await feeRequest(`statements/${encodeURIComponent(id)}/pdf`)
    const blob = await response.blob()
    if (blob.type !== 'application/pdf') throw new Error('Le document PDF est invalide.')
    const url = URL.createObjectURL(blob)
    tab.location.href = url
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (error) { tab.close(); throw error }
}
export async function realFeeValidate(professionalId: string, from: string, to: string, quoteHash: string) {
  const response = await feeRequest('validate', 'POST', { professionalId, from, to, quoteHash })
  return (await response.json()).statement as { id: string; totalCents: number; appointments: number }
}
export async function realFeeContracts(professionalId: string): Promise<RealFeeContract[]> {
  const response = await feeRequest(`contracts?professionalId=${encodeURIComponent(professionalId)}`)
  return (await response.json()).contracts as RealFeeContract[]
}
export async function addRealFeeContract(input: { professionalId: string; effectiveFrom: string;
  rule: RealFeeRule; category: RealFeeCategory | null; supervisorId: string | null; reason: string }) {
  const response = await feeRequest('contracts', 'POST', input)
  return (await response.json()).contract as { id: string }
}
export async function addRealFeeAdjustment(input: { professionalId: string; serviceDate: string;
  kind: 'report' | 'travel' | 'cancellation'; clientAmountCents: number; durationMinutes: number;
  meetingEquivalentHalfUnits: number; appointmentId: string | null; reason: string }) {
  const response = await feeRequest('adjustments', 'POST', input)
  return (await response.json()).adjustment as { id: string }
}
export async function realFeeCancellationCandidates(professionalId: string, serviceDate: string): Promise<{
  id: string; startAt: string }[]> {
  const response = await feeRequest(`cancellations?professionalId=${encodeURIComponent(professionalId)}&serviceDate=${encodeURIComponent(serviceDate)}`)
  return (await response.json()).appointments as { id: string; startAt: string }[]
}
export async function realFeeBillableActivities(professionalId: string, serviceDate: string,
  kind: 'report' | 'travel'): Promise<{ id: string; startAt: string; amountCents: number;
    durationMinutes: number; service: string }[]> {
  const query = new URLSearchParams({ professionalId, serviceDate, kind })
  const response = await feeRequest(`billable-activities?${query}`)
  return (await response.json()).appointments
}
export async function listRealInvoices(status?: 'open' | 'closed') {
  const response = await request('invoices' + (status ? `?status=${status}` : ''))
  return response.json() as Promise<{ invoices: RealBillingInvoice[]; reconciliation: RealBillingReconciliation }>
}
export async function realInvoice(id: string) {
  const response = await request(`invoices/${id}`)
  return (await response.json()).invoice as RealBillingDetail
}
export async function realOpeningFeePolicy(patientId: string): Promise<RealOpeningFeePolicy> {
  const response = await request(`opening-fee/${patientId}`)
  return (await response.json()).policy
}
export async function realBillingSettings(): Promise<RealBillingSettings> {
  const response = await request('settings')
  return (await response.json()).settings as RealBillingSettings
}
export async function saveRealBillingSettings(input: Pick<RealBillingSettings,
  'openingFeeCents' | 'firstReminderDays' | 'secondReminderDays' | 'version'>): Promise<RealBillingSettings> {
  const response = await request('settings', 'POST', input)
  return (await response.json()).settings as RealBillingSettings
}
export async function realBillingRecipientOptions(id: string): Promise<{
  options: { id: string; name: string; email: string }[];
  selected: { payerId: string; email: string; address: string } | null;
  sendStatus: string | null;
}> {
  const response = await request(`recipients/${id}`)
  return (await response.json()).recipients
}
export async function realBillingAction(action: string, body: Record<string, unknown>) {
  const response = await request(action, 'POST', body)
  return response.json()
}
export async function openRealInvoicePdf(id: string, kind: 'invoice' | 'receipt' = 'invoice') {
  const tab = window.open('', '_blank')
  if (!tab) throw new Error('Autorisez les fenêtres pour voir la facture.')
  tab.opener = null
  try {
    const response = await request(`invoices/${id}/pdf?kind=${kind}`)
    const blob = await response.blob()
    if (blob.type !== 'application/pdf') throw new Error('Le document PDF est invalide.')
    const url = URL.createObjectURL(blob)
    tab.location.href = url
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (error) { tab.close(); throw error }
}
