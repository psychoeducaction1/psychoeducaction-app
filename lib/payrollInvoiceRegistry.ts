import type { InvoicePeriod, PayrollInvoiceData } from '@/lib/generatePayrollInvoiceDocx'

export const PAYROLL_INVOICE_TEMPLATE_VERSION = 2
export type PayrollInvoiceSnapshot = {
  templateVersion: number
  calculationVersion?: string
  sourceSha256?: string
  period: InvoicePeriod
  invoice: PayrollInvoiceData
}
export type PayrollInvoiceRecord = {
  id: string
  number: string
  version: number
  reason: string | null
  snapshot: PayrollInvoiceSnapshot | null
}

export function validateInvoiceRevision(reason: unknown, expectedVersion: unknown) {
  if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500) {
    throw new Error('Décrivez le motif du rectificatif (10 à 500 caractères).')
  }
  if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) {
    throw new Error('La version précédente est requise pour éviter une correction concurrente.')
  }
  return { reason: reason.trim(), expectedVersion: Number(expectedVersion) }
}

export function payrollInvoiceSnapshot(period: InvoicePeriod, invoice: PayrollInvoiceData, sourceSha256?: string): PayrollInvoiceSnapshot {
  // JSON normalise le snapshot, sans référence mutable au calcul ni données patient.
  return JSON.parse(JSON.stringify({ templateVersion: PAYROLL_INVOICE_TEMPLATE_VERSION, calculationVersion: 'decimal-cad-per-activity-v1', sourceSha256, period, invoice }))
}
