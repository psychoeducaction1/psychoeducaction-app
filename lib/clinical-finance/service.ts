import { actorIdOf, canAdmin as admin, hasCapability, resolveActor } from '../clinical-core/capabilities.ts'
import type { ClinicalActorInput } from '../clinical-core/types'
import { calendarWeekday, localDateTime, shiftCalendarDate, validCalendarDate } from '../clinical-calendar/time.ts'
import {
  BillingError, type BillingAudit, type BillingBalance, type BillingDirectory, type BillingInvoice,
  type BillingLedgerEntry, type BillingLedgerKind, type BillingLedgerReason, type BillingStore, type BillingWorkspace, type FeeQuote,
} from './types.ts'

const moneyLimit = 100_000_000
function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new BillingError('INVALID_INPUT', `${label} invalide.`)
  return value
}
function keys(value: object, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new BillingError('INVALID_INPUT', 'Un champ financier fourni n’est pas autorisé.')
}
export function createBillingStore(seed: Partial<BillingStore> = {}): BillingStore {
  return structuredClone({ rates: [], invoices: [], ledger: [], audit: [], nextInvoiceNumber: 1, ...seed })
}
export function invoiceBalance(invoice: Pick<BillingInvoice, 'totalCents'>, entries: readonly BillingLedgerEntry[]): BillingBalance {
  const sum = (kind: BillingLedgerKind) => entries.filter(value => value.kind === kind).reduce((total, value) => total + value.amountCents, 0)
  const paidCents = sum('payment'), creditedCents = sum('credit'), refundedCents = sum('refund')
  const balance = invoice.totalCents - creditedCents - paidCents + refundedCents
  return { paidCents, creditedCents, refundedCents, dueCents: Math.max(balance, 0), refundableCents: Math.max(-balance, 0) }
}
/** Montants entiers en cents; arrondi commercial unique au cent, jamais une multiplication de dollars flottants. */
export function priceForMinutes(hourlyClientCents: number, durationMinutes: number): number {
  integer(hourlyClientCents, 1, moneyLimit, 'Tarif horaire en cents')
  integer(durationMinutes, 1, 720, 'Durée')
  return integer(Math.floor((hourlyClientCents * durationMinutes + 30) / 60), 1, moneyLimit, 'Total en cents')
}

export function createClinicalFinanceService(options: { store: BillingStore; directory: BillingDirectory; quoteFee: FeeQuote; now?: () => Date; newId?: () => string }) {
  const { store, directory, quoteFee } = options
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? (() => crypto.randomUUID())
  function actorFor(input: ClinicalActorInput, administrative = false) {
    try {
      const actor = directory.actors().find(value => value.id === actorIdOf(input))
      const active = actor ? resolveActor(actor, input) : null
      if (active && (!administrative || admin(active))) return active
    } catch { /* Do not infer a different context after a refusal. */ }
    throw new BillingError('FORBIDDEN', 'Accès financier ou contexte non autorisé.', 403)
  }
  function audit(actorId: ClinicalActorInput, action: string, resourceId: string): BillingAudit { return { id: newId(), actorId: actorFor(actorId).id, context: actorFor(actorId).context, action, resourceId, at: now().toISOString() } }
  function invoiceFor(actorId: ClinicalActorInput, invoiceId: string) {
    actorFor(actorId, true)
    const invoice = store.invoices.find(value => value.id === invoiceId)
    if (!invoice) throw new BillingError('NOT_FOUND', 'Facture fictive introuvable.', 404)
    return invoice
  }
  function expected(invoice: BillingInvoice, version: number) {
    integer(version, 1, Number.MAX_SAFE_INTEGER, 'Version')
    if (invoice.version !== version) throw new BillingError('VERSION_CONFLICT', 'Cette facture a changé. Actualisez avant de continuer.', 409)
  }
  function readyAppointment(actorId: ClinicalActorInput, appointmentId: string) {
    const appointment = directory.appointmentsFor(actorId).find(value => value.id === appointmentId)
    if (!appointment) throw new BillingError('NOT_FOUND', 'Rencontre non disponible.', 404)
    const endDate = localDateTime(appointment.endAt).slice(0, 10)
    if (appointment.status !== 'completed' || Date.parse(appointment.endAt) > now().getTime() || shiftCalendarDate(endDate, 1) > localDateTime(now()).slice(0, 10)) {
      throw new BillingError('NOT_READY', 'Le brouillon est disponible à partir du lendemain de la fin d’une rencontre indiquée comme effectuée, à Montréal.', 409)
    }
    return appointment
  }
  function createInvoiceDraft(actorId: ClinicalActorInput, input: { appointmentId: string; payerId: string }) {
    actorFor(actorId, true)
    keys(input, ['appointmentId', 'payerId'])
    const appointment = readyAppointment(actorId, input.appointmentId)
    const client = directory.clientsFor(actorId).find(value => value.id === appointment.clientId)
    const payer = client?.payers.find(value => value.id === input.payerId && value.clientId === client.id)
    if (!client || !payer) throw new BillingError('INVALID_PAYER', 'Choisissez un payeur rattaché à ce client. Un parent et un client sont des identités distinctes.')
    const existing = store.invoices.find(value => value.appointmentId === appointment.id)
    if (existing) {
      if (existing.payer.id !== payer.id) throw new BillingError('DUPLICATE', 'Une facture existe déjà pour cette rencontre avec un autre payeur.', 409)
      return structuredClone(existing)
    }
    const serviceDate = localDateTime(appointment.startAt).slice(0, 10)
    const rate = [...store.rates].filter(value => value.effectiveFrom <= serviceDate).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
    if (!rate) throw new BillingError('RATE_MISSING', 'Aucun tarif historique ne couvre cette rencontre.', 409)
    const durationMinutes = integer((Date.parse(appointment.endAt) - Date.parse(appointment.startAt)) / 60_000, 1, 720, 'Durée')
    const invoice: BillingInvoice = { id: newId(), number: null, appointmentId: appointment.id, clientId: client.id, professionalId: appointment.professionalId,
      clientName: client.name, payer: structuredClone(payer), serviceDate, appointmentStart: appointment.startAt, appointmentEnd: appointment.endAt, durationMinutes,
      rateId: rate.id, hourlyClientCents: rate.hourlyClientCents, totalCents: priceForMinutes(rate.hourlyClientCents, durationMinutes), currency: 'CAD',
      status: 'draft', createdAt: now().toISOString(), validatedAt: null, version: 1 }
    const event = audit(actorId, 'invoice_drafted', invoice.id)
    store.invoices = [...store.invoices, invoice]
    store.audit = [...store.audit, event]
    return structuredClone(invoice)
  }
  function validateInvoice(actorId: ClinicalActorInput, invoiceId: string, input: { expectedVersion: number; confirmed: true }) {
    const invoice = invoiceFor(actorId, invoiceId)
    keys(input, ['expectedVersion', 'confirmed'])
    expected(invoice, input.expectedVersion)
    if (input.confirmed !== true || invoice.status !== 'draft') throw new BillingError('INVALID_TRANSITION', 'Une validation manuelle explicite du brouillon est requise.', 409)
    const appointment = readyAppointment(actorId, invoice.appointmentId)
    if (appointment.startAt !== invoice.appointmentStart || appointment.endAt !== invoice.appointmentEnd || appointment.clientId !== invoice.clientId || appointment.professionalId !== invoice.professionalId) {
      throw new BillingError('SOURCE_CHANGED', 'La rencontre a changé depuis la préparation de cette facture.', 409)
    }
    integer(store.nextInvoiceNumber, 1, 999_999, 'Numéro de facture')
    const candidate = { ...invoice, status: 'validated' as const, number: `SIM-${localDateTime(now()).slice(0, 4)}-${String(store.nextInvoiceNumber).padStart(6, '0')}`,
      validatedAt: now().toISOString(), version: invoice.version + 1 }
    const event = audit(actorId, 'invoice_validated', invoice.id)
    store.invoices = store.invoices.map(value => value.id === invoice.id ? candidate : value)
    store.nextInvoiceNumber++
    store.audit = [...store.audit, event]
    return structuredClone(candidate)
  }
  function appendLedgerEntry(actorId: ClinicalActorInput, invoiceId: string, input: { expectedVersion: number; kind: BillingLedgerKind; amountCents: number; reason: BillingLedgerReason; requestKey: string }) {
    const invoice = invoiceFor(actorId, invoiceId)
    keys(input, ['expectedVersion', 'kind', 'amountCents', 'reason', 'requestKey'])
    if (!['payment', 'credit', 'refund'].includes(input.kind) || !['simulation', 'billing_correction', 'service_adjustment'].includes(input.reason)
      || typeof input.requestKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(input.requestKey)) throw new BillingError('INVALID_INPUT', 'Écriture du registre invalide.')
    integer(input.amountCents, 1, moneyLimit, 'Montant en cents')
    const existing = store.ledger.find(value => value.invoiceId === invoice.id && value.requestKey === input.requestKey)
    if (existing) {
      if (existing.kind !== input.kind || existing.amountCents !== input.amountCents || existing.reason !== input.reason) throw new BillingError('IDEMPOTENCY_CONFLICT', 'Cette demande a déjà été utilisée pour une autre écriture.', 409)
      return structuredClone(existing)
    }
    expected(invoice, input.expectedVersion)
    if (invoice.status !== 'validated') throw new BillingError('INVALID_TRANSITION', 'Validez la facture avant une simulation de paiement, d’avoir ou de remboursement.', 409)
    const balance = invoiceBalance(invoice, store.ledger.filter(value => value.invoiceId === invoice.id))
    const limit = input.kind === 'payment' ? balance.dueCents : input.kind === 'credit' ? invoice.totalCents - balance.creditedCents : balance.refundableCents
    if (input.amountCents > limit) throw new BillingError('AMOUNT_EXCEEDED', input.kind === 'refund' ? 'Un remboursement exige un avoir et ne peut dépasser le trop-perçu remboursable.' : 'Le montant dépasse le solde autorisé pour cette opération.', 409)
    const entry: BillingLedgerEntry = { id: newId(), invoiceId: invoice.id, kind: input.kind, amountCents: input.amountCents, reason: input.reason, requestKey: input.requestKey, actorId: actorFor(actorId).id, at: now().toISOString() }
    const event = audit(actorId, `ledger_${input.kind}`, invoice.id)
    const candidate = { ...invoice, version: invoice.version + 1 }
    store.invoices = store.invoices.map(value => value.id === invoice.id ? candidate : value)
    store.ledger = [...store.ledger, entry]
    store.audit = [...store.audit, event]
    return structuredClone(entry)
  }
  function addRate(actorId: ClinicalActorInput, input: { effectiveFrom: string; hourlyClientCents: number }) {
    actorFor(actorId, true)
    keys(input, ['effectiveFrom', 'hourlyClientCents'])
    if (!validCalendarDate(input.effectiveFrom) || input.effectiveFrom < localDateTime(now()).slice(0, 10)) throw new BillingError('INVALID_INPUT', 'Le nouveau tarif doit prendre effet aujourd’hui ou plus tard; les tarifs historiques sont conservés.')
    integer(input.hourlyClientCents, 1, moneyLimit, 'Tarif horaire en cents')
    if (store.rates.some(value => value.effectiveFrom === input.effectiveFrom)) throw new BillingError('DUPLICATE', 'Un tarif existe déjà pour cette date d’entrée en vigueur.', 409)
    const rate = { id: newId(), serviceCode: 'consultation' as const, effectiveFrom: input.effectiveFrom, hourlyClientCents: input.hourlyClientCents, currency: 'CAD' as const, createdAt: now().toISOString() }
    const event = audit(actorId, 'rate_added', rate.id)
    store.rates = [...store.rates, rate]
    store.audit = [...store.audit, event]
    return structuredClone(rate)
  }
  function getWorkspace(actorId: ClinicalActorInput): BillingWorkspace {
    const actor = actorFor(actorId)
    const clients = directory.clientsFor(actorId)
    const appointments = directory.appointmentsFor(actorId)
    const base = { mode: 'isolated_fixture' as const, durable: false as const, context: actor.context, actor, currentTime: now().toISOString() }
    if (!admin(actor)) {
      const fees = store.invoices.filter(value => value.professionalId === actor.id && value.status === 'validated').map(invoice => {
        const weekStart = shiftCalendarDate(invoice.serviceDate, 1 - calendarWeekday(invoice.serviceDate))
        const weekEnd = shiftCalendarDate(weekStart, 6)
        const weeklyCompletedMeetings = appointments.filter(value => value.professionalId === actor.id && value.status === 'completed'
          && localDateTime(value.startAt).slice(0, 10) >= weekStart && localDateTime(value.startAt).slice(0, 10) <= weekEnd).length
        const amountCents = integer(quoteFee({ professionalId: actor.id, clientAmountCents: invoice.totalCents, durationMinutes: invoice.durationMinutes, weeklyCompletedMeetings }), 0, moneyLimit, 'Honoraires en cents')
        return { serviceDate: invoice.serviceDate, durationMinutes: invoice.durationMinutes, amountCents,
          clientName: clients.find(value => value.id === invoice.clientId)?.name ?? 'Client hors accès actuel', state: 'estimate' as const }
      })
      return structuredClone({ ...base, kind: 'professional', fees, totalFeesCents: fees.reduce((total, value) => total + value.amountCents, 0) })
    }
    const professionals = directory.actors().filter(value => hasCapability(value, 'practice'))
    const eligibleAppointments = appointments.filter(value => {
      if (store.invoices.some(invoice => invoice.appointmentId === value.id)) return false
      return value.status === 'completed' && Date.parse(value.endAt) <= now().getTime() && shiftCalendarDate(localDateTime(value.endAt).slice(0, 10), 1) <= localDateTime(now()).slice(0, 10)
    }).map(value => ({ ...value, clientName: clients.find(client => client.id === value.clientId)?.name ?? 'Client non disponible', professionalName: professionals.find(pro => pro.id === value.professionalId)?.name ?? 'Professionnel non disponible' }))
    return structuredClone({ ...base, kind: 'administrative', clients: [...clients], professionals: [...professionals], rates: store.rates,
      invoices: store.invoices.map(invoice => ({ ...invoice, professionalName: professionals.find(value => value.id === invoice.professionalId)?.name ?? 'Professionnel non disponible',
        balance: invoiceBalance(invoice, store.ledger.filter(value => value.invoiceId === invoice.id)), ledger: store.ledger.filter(value => value.invoiceId === invoice.id) })),
      eligibleAppointments, audit: store.audit })
  }
  return { getWorkspace, createInvoiceDraft, validateInvoice, appendLedgerEntry, addRate }
}
