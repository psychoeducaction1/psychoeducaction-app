import type { PayrollInvoiceData } from './generatePayrollInvoiceDocx'
import { decimalProduct, decimalSum } from '@/lib/payrollDecimal'

export type InvoiceEditLine = { label: string; quantity: number; unitPay: number; unit: 'h' | 'élément'; cancellation?: boolean }
export type InvoiceEdit = { lines: InvoiceEditLine[]; travelFeesTotal: number }

export function editableInvoice(invoice: PayrollInvoiceData): InvoiceEdit {
  return { lines: [...invoice.lineItems.map(i => ({ label: i.label, quantity: i.quantity, unitPay: i.unitPay, unit: i.unit ?? 'élément' as const })),
    ...invoice.cancellationLineItems.map(i => ({ label: i.label, quantity: i.count, unitPay: i.unitPay, unit: 'élément' as const, cancellation: true }))], travelFeesTotal: invoice.travelFeesTotal }
}

/** Whitelist the editable fields and recompute every amount on the server. */
export function applyInvoiceEdit(base: PayrollInvoiceData, input: unknown): PayrollInvoiceData {
  if (!input || typeof input !== 'object') throw new Error('Rectification invalide.')
  const edit = input as InvoiceEdit
  const validNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000000
  if (!Array.isArray(edit.lines) || edit.lines.length > 200 || !validNumber(edit.travelFeesTotal)) throw new Error('Lignes ou déplacement invalides.')
  const invoice: PayrollInvoiceData = { ...base, lineItems: [], cancellationLineItems: [], travelFeesTotal: decimalProduct(edit.travelFeesTotal, 1) }
  for (const line of edit.lines) {
    if (!line || typeof line.label !== 'string' || !line.label.trim() || line.label.length > 200 || !validNumber(line.quantity) || line.quantity <= 0 || !validNumber(line.unitPay) || !['h', 'élément'].includes(line.unit) || (line.cancellation !== undefined && typeof line.cancellation !== 'boolean') || (line.cancellation && !Number.isInteger(line.quantity))) throw new Error('Description, quantité ou prix unitaire invalide.')
    const totalPay = decimalProduct(line.quantity, line.unitPay)
    if (line.cancellation) invoice.cancellationLineItems.push({ label: line.label.trim(), count: line.quantity, unitPay: line.unitPay, totalPay })
    else invoice.lineItems.push({ label: line.label.trim(), quantity: line.quantity, unit: line.unit, unitPay: line.unitPay, totalPay })
  }
  if (!edit.lines.length && invoice.travelFeesTotal === 0) throw new Error('La facture doit contenir au moins un poste.')
  invoice.cancellationCount = decimalSum(invoice.cancellationLineItems.map(i => i.count))
  invoice.cancellationFeesTotal = decimalSum(invoice.cancellationLineItems.map(i => i.totalPay))
  invoice.meetingsPay = decimalSum(invoice.lineItems.map(i => i.totalPay))
  invoice.travelKilometersTotal = decimalProduct(invoice.travelFeesTotal, 1, 0.64)
  invoice.grandTotal = decimalSum([invoice.meetingsPay, invoice.cancellationFeesTotal, invoice.travelFeesTotal])
  return invoice
}
