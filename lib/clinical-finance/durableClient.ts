import type { ClinicalAccessContext, ClinicalActorInput } from '@/lib/clinical-core/types'
import type { DurableBillingAck, DurableBillingCommand, DurableBillingFilter, DurableBillingWorkspace } from './durableTypes'
import type { FeeAck, FeeCommand, FeeWorkspace } from './feeTypes'
import { isDurableBillingCommand } from '@/lib/clinical-finance/validation'
import { isDurableBillingAck, isDurableBillingWorkspace } from '@/lib/clinical-finance/transport'
import { isFeeCommand } from '@/lib/clinical-finance/feeValidation'
import { isFeeAck, isFeeWorkspace } from '@/lib/clinical-finance/feeTransport'
import { ClinicalApiError, clinicalContextFromPath, clinicalRequest } from '@/lib/clinical-workspace/api'
import { clinicalSessionHeaders } from '@/lib/clinical-unification/authClient'

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const actorId = (actor: ClinicalActorInput) => typeof actor === 'string' ? actor : actor.actorId
const contextOf = (actor: ClinicalActorInput): ClinicalAccessContext => typeof actor === 'string' ? clinicalContextFromPath(typeof window === 'undefined' ? '/clinique' : window.location.pathname) : actor.context
const invalid = () => new ClinicalApiError('La demande financière est invalide.', 400, 'INVALID_INPUT')
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]))
  return value
}
type FilterInput = Partial<DurableBillingFilter> & { invoiceId?: string }
export function billingQuery(filters: FilterInput = {}): URLSearchParams {
  if (Object.keys(filters).some(key => !['search', 'status', 'page', 'pageSize', 'invoiceId', 'clientId', 'activityId', 'professional', 'clientName', 'invoiceNumber', 'clientNumber', 'dateFrom', 'dateTo', 'recurring'].includes(key))) throw invalid()
  const search = filters.search ?? '', status = filters.status ?? 'all', page = filters.page ?? 1, size = filters.pageSize ?? 10
  const professional = filters.professional ?? '', clientName = filters.clientName ?? '', invoiceNumber = filters.invoiceNumber ?? '', clientNumber = filters.clientNumber ?? ''
  const dateFrom = filters.dateFrom ?? null, dateTo = filters.dateTo ?? null, recurring = filters.recurring ?? 'all'
  if (typeof search !== 'string' || search.length > 120 || !['all', 'draft', 'issued', 'unpaid', 'partial', 'paid'].includes(status)
    || !Number.isInteger(page) || page < 1 || page > 100000 || ![10, 25, 50].includes(size) || filters.invoiceId !== undefined && !uuid(filters.invoiceId)
    || filters.clientId != null && !uuid(filters.clientId) || filters.activityId != null && !uuid(filters.activityId)
    || ![[professional,120],[clientName,120],[invoiceNumber,80],[clientNumber,20]].every(([value,max]) => typeof value === 'string' && value.length <= Number(max))
    || !['all','yes','no'].includes(recurring) || [dateFrom,dateTo].some(value => value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)))
    || dateFrom !== null && dateTo !== null && dateFrom > dateTo) throw invalid()
  const query = new URLSearchParams({ search, status, page: String(page), pageSize: String(size) })
  if (filters.invoiceId) query.set('invoiceId', filters.invoiceId.toLowerCase())
  if (filters.clientId) query.set('clientId', filters.clientId.toLowerCase())
  if (filters.activityId) query.set('activityId', filters.activityId.toLowerCase())
  query.set('professional', professional); query.set('clientName', clientName); query.set('invoiceNumber', invoiceNumber); query.set('clientNumber', clientNumber); query.set('recurring', recurring)
  if (dateFrom) query.set('dateFrom', dateFrom)
  if (dateTo) query.set('dateTo', dateTo)
  return query
}
async function readProjection<T>(actor: ClinicalActorInput, path: string, validate: (value: unknown) => boolean, signal?: AbortSignal): Promise<T> {
  if (!uuid(actorId(actor))) throw invalid()
  const response = await fetch('/api/clinical-workspace' + path, { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal,
    headers: { ...await clinicalSessionHeaders(), 'X-Clinical-Fixture-Actor': actorId(actor), 'X-Clinical-Context': contextOf(actor) } })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    throw new ClinicalApiError(typeof body.error === 'string' ? body.error : 'La projection financière est indisponible.', response.status, typeof body.code === 'string' ? body.code : undefined)
  }
  if (!validate(payload)) throw new ClinicalApiError('Projection financière inattendue. Aucune donnée n’a été affichée.', 502, 'INVALID_RESPONSE')
  return payload as T
}
export async function loadBilling(actor: ClinicalActorInput, filters: FilterInput = {}, signal?: AbortSignal): Promise<DurableBillingWorkspace> {
  if (contextOf(actor) !== 'administration') throw new ClinicalApiError('Les factures clients nécessitent le contexte administratif.', 403, 'FORBIDDEN')
  const query = billingQuery(filters)
  const expected: DurableBillingFilter = { search: query.get('search')!, status: query.get('status') as DurableBillingFilter['status'], page: Number(query.get('page')), pageSize: Number(query.get('pageSize')) as DurableBillingFilter['pageSize'], clientId: query.get('clientId'), activityId: query.get('activityId'), professional: query.get('professional')!, clientName: query.get('clientName')!, invoiceNumber: query.get('invoiceNumber')!, clientNumber: query.get('clientNumber')!, dateFrom: query.get('dateFrom'), dateTo: query.get('dateTo'), recurring: query.get('recurring') as DurableBillingFilter['recurring'] }
  return readProjection(actor, '/billing?' + query, value => isDurableBillingWorkspace(value, contextOf(actor), actorId(actor), expected), signal)
}
export type BillingReminderPolicy = { firstDays: number; secondDays: number; version: number }
export type OpeningFeePolicy = { patientId: string; charge: boolean; reason: string; version: number; prepared: boolean }
const openingFeePolicy = (value: unknown): value is OpeningFeePolicy => {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'charge,patientId,prepared,reason,version') return false
  const policy = value as Record<string, unknown>
  return uuid(policy.patientId) && typeof policy.charge === 'boolean' && typeof policy.reason === 'string'
    && policy.reason.length <= 500 && Number.isInteger(policy.version) && Number(policy.version) >= 0 && typeof policy.prepared === 'boolean'
}
export function loadOpeningFeePolicy(actor: ClinicalActorInput, patientId: string): Promise<OpeningFeePolicy> {
  if (!uuid(patientId) || contextOf(actor) !== 'administration') throw invalid()
  return readProjection(actor, '/billing/opening-policy?patientId=' + encodeURIComponent(patientId), openingFeePolicy)
}
export async function saveOpeningFeePolicy(actor: ClinicalActorInput, patientId: string, charge: boolean, reason: string): Promise<OpeningFeePolicy> {
  if (!uuid(patientId) || typeof charge !== 'boolean' || typeof reason !== 'string' || reason.length > 500 || (!charge && !reason.trim()) || contextOf(actor) !== 'administration') throw invalid()
  const current = await loadOpeningFeePolicy(actor, patientId)
  return clinicalRequest(actor, '/billing/opening-policy', { patientId, charge, reason, expectedVersion: current.version }, 'POST', undefined, 'administration', openingFeePolicy)
}
const reminderPolicy = (value: unknown): value is BillingReminderPolicy => {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'firstDays,secondDays,version') return false
  const policy = value as Record<string, unknown>
  return Number.isInteger(policy.firstDays) && Number.isInteger(policy.secondDays) && Number.isInteger(policy.version)
    && Number(policy.firstDays) >= 1 && Number(policy.firstDays) < Number(policy.secondDays) && Number(policy.secondDays) <= 90 && Number(policy.version) >= 1
}
export function loadBillingReminderPolicy(actor: ClinicalActorInput, signal?: AbortSignal): Promise<BillingReminderPolicy> {
  return clinicalRequest(actor, '/billing/settings/reminders', undefined, 'GET', signal, 'administration', reminderPolicy)
}
export function saveBillingReminderPolicy(actor: ClinicalActorInput, policy: BillingReminderPolicy): Promise<BillingReminderPolicy> {
  if (!reminderPolicy(policy)) throw invalid()
  return clinicalRequest(actor, '/billing/settings/reminders', { firstDays: policy.firstDays, secondDays: policy.secondDays, expectedVersion: policy.version }, 'POST', undefined, 'administration', reminderPolicy)
}
export async function loadFees(actor: ClinicalActorInput, signal?: AbortSignal): Promise<FeeWorkspace> {
  return readProjection(actor, '/billing/fees', value => isFeeWorkspace(value, contextOf(actor), actorId(actor)), signal)
}
/** Only a SHA-256 fingerprint and random UUID survive a reload; never a financial payload. */
async function commandIntent(actor: ClinicalActorInput, command: DurableBillingCommand | FeeCommand) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical([actorId(actor), contextOf(actor), command]))))
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    const storage = window.sessionStorage, storageKey = 'pea.lab.billing.command.v1:' + fingerprint
    const previous = storage.getItem(storageKey), key = previous && uuid(previous) ? previous : crypto.randomUUID()
    storage.setItem(storageKey, key)
    if (storage.getItem(storageKey) !== key) throw new Error('Intention not retained')
    return { key, clear() { try { storage.removeItem(storageKey) } catch { /* A valid acknowledgement remains confirmed. */ } } }
  } catch { throw new ClinicalApiError('Le stockage de session doit être disponible pour reprendre cette opération sans doublon.', 503, 'INTENT_STORAGE_UNAVAILABLE') }
}
async function mutate<A>(actor: ClinicalActorInput, command: DurableBillingCommand | FeeCommand, valid: (value: unknown) => boolean): Promise<A> {
  if (contextOf(actor) !== 'administration') throw new ClinicalApiError('Cette opération nécessite le contexte administratif.', 403, 'FORBIDDEN')
  if (!uuid(actorId(actor))) throw invalid()
  const intent = await commandIntent(actor, command)
  try {
    const ack = await clinicalRequest<A>(actor, '/billing/commands', { key: intent.key, ...command }, 'POST', undefined, undefined, valid)
    intent.clear()
    return ack
  } catch (cause) {
    if (cause instanceof ClinicalApiError && cause.status >= 400 && cause.status < 500 && ![408, 429].includes(cause.status)) intent.clear()
    throw cause
  }
}
export async function runBillingCommand(actor: ClinicalActorInput, command: DurableBillingCommand): Promise<DurableBillingAck> {
  if (!isDurableBillingCommand(command)) throw invalid()
  return mutate(actor, command, value => isDurableBillingAck(value, command.action))
}
export async function runFeeCommand(actor: ClinicalActorInput, command: FeeCommand): Promise<FeeAck> {
  if (!isFeeCommand(command)) throw invalid()
  return mutate(actor, command, value => isFeeAck(value, command.action))
}
export function billingDocumentDownloadUrl(documentId: string, context: ClinicalAccessContext): string {
  if (!uuid(documentId) || !['administration', 'clinical'].includes(context)) throw invalid()
  return '/api/clinical-workspace/billing/documents/' + documentId + '/' + context + '/download'
}

export function feeDocumentDownloadUrl(documentId: string, context: ClinicalAccessContext): string {
  if (!uuid(documentId) || !['administration', 'clinical'].includes(context)) throw invalid()
  return '/api/clinical-workspace/billing/fees/documents/' + documentId + '/' + context + '/download'
}
