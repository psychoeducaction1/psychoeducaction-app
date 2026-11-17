import type { ClinicalAccessContext, ClinicalActorInput } from '../clinical-core/types'
import type { CalendarActor, AppointmentStatus } from '../clinical-calendar/types'
export type BillingActor = CalendarActor

export type BillingAppointment = { id: string; clientId: string; professionalId: string; startAt: string; endAt: string; status: AppointmentStatus }
export type BillingPayer = { id: string; clientId: string; name: string; email: string; type: 'self' | 'parent' | 'organization' }
export type BillingClient = { id: string; name: string; payers: BillingPayer[] }
export type BillingDirectory = { actors: () => readonly CalendarActor[]; clientsFor: (actorId: ClinicalActorInput) => readonly BillingClient[]; appointmentsFor: (actorId: ClinicalActorInput) => readonly BillingAppointment[] }
export type BillingRate = { id: string; serviceCode: 'consultation'; effectiveFrom: string; hourlyClientCents: number; currency: 'CAD'; createdAt: string }
export type BillingInvoice = {
  id: string; number: string | null; appointmentId: string; clientId: string; professionalId: string; clientName: string;
  payer: BillingPayer; serviceDate: string; appointmentStart: string; appointmentEnd: string; durationMinutes: number;
  rateId: string; hourlyClientCents: number; totalCents: number; currency: 'CAD'; status: 'draft' | 'validated';
  createdAt: string; validatedAt: string | null; version: number;
}
export type BillingLedgerKind = 'payment' | 'credit' | 'refund'
export type BillingLedgerReason = 'simulation' | 'billing_correction' | 'service_adjustment'
export type BillingLedgerEntry = { id: string; invoiceId: string; kind: BillingLedgerKind; amountCents: number; reason: BillingLedgerReason; requestKey: string; actorId: string; at: string }
export type BillingAudit = { id: string; actorId: string; context?: ClinicalAccessContext; action: string; resourceId: string; at: string }
export type BillingBalance = { paidCents: number; creditedCents: number; refundedCents: number; dueCents: number; refundableCents: number }
export type BillingInvoiceView = BillingInvoice & { balance: BillingBalance; ledger: BillingLedgerEntry[]; professionalName: string }
export type BillingStore = { rates: BillingRate[]; invoices: BillingInvoice[]; ledger: BillingLedgerEntry[]; audit: BillingAudit[]; nextInvoiceNumber: number }
export type FeeQuote = (input: { professionalId: string; clientAmountCents: number; durationMinutes: number; weeklyCompletedMeetings: number }) => number
export type ProfessionalFeeView = { serviceDate: string; durationMinutes: number; amountCents: number; clientName: string; state: 'estimate' }
export type BillingAdministrativeWorkspace = {
  kind: 'administrative'; mode: 'isolated_fixture'; durable: false; context: ClinicalAccessContext; actor: CalendarActor; currentTime: string;
  clients: BillingClient[]; professionals: CalendarActor[]; rates: BillingRate[]; invoices: BillingInvoiceView[];
  eligibleAppointments: (BillingAppointment & { clientName: string; professionalName: string })[]; audit: BillingAudit[];
}
export type BillingProfessionalWorkspace = {
  kind: 'professional'; mode: 'isolated_fixture'; durable: false; context: ClinicalAccessContext; actor: CalendarActor; currentTime: string;
  fees: ProfessionalFeeView[]; totalFeesCents: number;
}
export type BillingWorkspace = BillingAdministrativeWorkspace | BillingProfessionalWorkspace
const BILLING_ERROR_BRAND = Symbol.for('pea.clinical.billing.error.v1')
export class BillingError extends Error {
  readonly [BILLING_ERROR_BRAND] = true
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 400) { super(message); this.name = 'BillingError'; this.code = code; this.status = status }
}
export function isBillingError(value: unknown): value is BillingError {
  return value instanceof BillingError || (value instanceof Error && BILLING_ERROR_BRAND in value && value[BILLING_ERROR_BRAND] === true && 'status' in value && typeof value.status === 'number' && 'code' in value && typeof value.code === 'string')
}
