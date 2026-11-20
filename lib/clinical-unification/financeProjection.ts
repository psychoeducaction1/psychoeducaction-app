import type { FixtureActor } from '../clinical-core/types'
import type { BillingEligibleActivity, BillingHistory, DurableBillingFilter, DurableBillingLedger, DurableBillingWorkspace, DurableInvoice } from '../clinical-finance/durableTypes'
import { isDurableBillingFilter } from '../clinical-finance/validation.ts'
import { isDurableBillingWorkspace } from '../clinical-finance/transport.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function parseUnifiedBillingFilters(url: string): { filters: DurableBillingFilter; invoiceId: string | null } {
  const q = new URL(url).searchParams
  const keys = ['search','status','page','pageSize','invoiceId','clientId','activityId','professional','clientName','invoiceNumber','clientNumber','dateFrom','dateTo','recurring']
  if ([...q.keys()].some(key => !keys.includes(key) || q.getAll(key).length !== 1)) throw new Error('INVALID_INPUT')
  const filters = { search: q.get('search') ?? '', status: q.get('status') ?? 'all', page: Number(q.get('page') ?? '1'),
    pageSize: Number(q.get('pageSize') ?? '10'), clientId: q.get('clientId'), activityId: q.get('activityId'),
    professional: q.get('professional') ?? '', clientName: q.get('clientName') ?? '', invoiceNumber: q.get('invoiceNumber') ?? '',
    clientNumber: q.get('clientNumber') ?? '', dateFrom: q.get('dateFrom'), dateTo: q.get('dateTo'), recurring: q.get('recurring') ?? 'all' }
  if (!isDurableBillingFilter(filters) || q.has('invoiceId') && !uuid.test(q.get('invoiceId')!)) throw new Error('INVALID_INPUT')
  return { filters, invoiceId: q.get('invoiceId') }
}
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-CA')
const has = (s: string, query: string) => norm(s).includes(norm(query))
const invoiceDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' })
type FilterMetadata = { caseNumber: string | null; invoiceDate: string; recurring: boolean }

function metadata(value: unknown): FilterMetadata {
  if (!value || typeof value !== 'object' || !('caseNumber' in value) || !(value.caseNumber === null || typeof value.caseNumber === 'string' && /^\d{6}$/.test(value.caseNumber))
    || !('invoiceDate' in value) || typeof value.invoiceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.invoiceDate)
    || !('recurring' in value) || typeof value.recurring !== 'boolean') throw new Error('INVALID_RESPONSE')
  return value as FilterMetadata
}

/** Every invoice comes from the authenticated SQL projection. No identity or monetary value is inferred. */
export function projectUnifiedBilling(data: unknown, actor: FixtureActor, filters: DurableBillingFilter, invoiceId: string | null, day: string): DurableBillingWorkspace {
  if (!data || typeof data !== 'object' || !('invoices' in data) || !Array.isArray(data.invoices)
    || !('ledger' in data) || !Array.isArray(data.ledger)) throw new Error('INVALID_RESPONSE')
  const filterMetadata = 'filterMetadata' in data && data.filterMetadata && typeof data.filterMetadata === 'object' ? data.filterMetadata as Record<string, unknown> : null
  if ((filters.clientNumber || filters.recurring !== 'all') && !filterMetadata) throw new Error('INVALID_RESPONSE')
  const history = 'history' in data ? data.history : []
  const eligible = 'eligibleActivities' in data ? data.eligibleActivities : []
  if (!Array.isArray(history) || !Array.isArray(eligible)) throw new Error('INVALID_RESPONSE')
  const source = data.invoices as DurableInvoice[]
  const rows = source.filter(i => {
    if (filters.status === 'voided' ? !i.voidedAt : Boolean(i.voidedAt)) return false
    const meta = filterMetadata ? metadata(filterMetadata[i.id]) : null
    const date = meta?.invoiceDate ?? invoiceDay.format(new Date(i.issuedAt ?? i.createdAt))
    return (!filters.clientId || i.clientId === filters.clientId)
    && (!filters.activityId || (i.activityIds ?? [i.activityId]).includes(filters.activityId))
    && has(i.professionalName, filters.professional) && has(i.clientName, filters.clientName)
    && has(i.number ?? '', filters.invoiceNumber)
    && (!filters.search || [i.clientName, i.payerName, i.professionalName, i.number ?? ''].some(v => has(v, filters.search)))
    && (!filters.clientNumber || has(meta?.caseNumber ?? '', filters.clientNumber))
    && (filters.recurring === 'all' || meta?.recurring === (filters.recurring === 'yes'))
    && (!filters.dateFrom || date >= filters.dateFrom) && (!filters.dateTo || date <= filters.dateTo)
    && (filters.status === 'all' || filters.status === 'voided' || filters.status === 'draft' || filters.status === 'issued'
      ? filters.status === 'all' || filters.status === 'voided' || i.status === filters.status
      : filters.status === 'unpaid' ? i.dueCents > 0 : i.paymentStatus === filters.status)
  })
  const selected = invoiceId ? rows.find(i => i.id === invoiceId) : undefined
  const methodMap: Record<string, DurableBillingLedger['method']> = { cash: 'cash_demo', transfer: 'transfer_demo', card_external: 'card_demo', other: 'deposit_demo', cheque: 'deposit_demo' }
  const result: DurableBillingWorkspace = { mode: 'isolated_unified', fictional: false, context: 'administration', actor,
    kind: 'administrative', canManagePayments: 'canManagePayments' in data && data.canManagePayments === true, canCreditRefund: true, currentDate: day, taxWarning: '',
    allocationRule: 'Les montants et les payeurs proviennent de la version du mandat liée à chaque prestation.',
    automaticPreparation: ('automaticPreparation' in data ? data.automaticPreparation
      : { mode: 'user_action', lastRunAt: null, preparedCount: 0 }) as DurableBillingWorkspace['automaticPreparation'], filters,
    invoices: rows.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize), total: rows.length,
    summary: rows.reduce((sum, i) => ({ totalCents: sum.totalCents + i.totalCents, paidCents: sum.paidCents + i.paidCents - i.refundedCents, dueCents: sum.dueCents + i.dueCents }), { totalCents: 0, paidCents: 0, dueCents: 0 }),
    selected: selected ? { invoice: selected, ledger: data.ledger.filter(l => l.invoiceId === selected.id)
      .map(l => ({ ...l, method: methodMap[l.method] ?? null })), history: (history as BillingHistory[]).filter(h => h.invoiceId === selected.id) } : null,
    eligibleActivities: (eligible as BillingEligibleActivity[]).filter(a => (!filters.clientId || a.clientId === filters.clientId)
      && (!filters.activityId || a.id === filters.activityId)), openingCandidates: [] }
  if (!isDurableBillingWorkspace(result, 'administration', actor.id, filters)) throw new Error('INVALID_RESPONSE')
  return result
}
