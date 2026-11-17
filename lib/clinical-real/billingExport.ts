import type { RealBillingInvoice } from './billingClient'

const safeCell = (value: string | number | null) => {
  const text = value === null ? '' : String(value)
  // Les noms proviennent des dossiers : neutraliser les formules à l'ouverture dans Excel.
  const safe = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
const dollars = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

/** Exporte strictement les lignes affichées après les filtres du navigateur. */
export function billingCsv(invoices: RealBillingInvoice[]): string {
  const headers = ['Numéro', 'Date', 'Client', 'Payeur', 'Professionnel', 'Statut',
    'Total CAD', 'Payé CAD', 'À payer CAD', 'Dernier paiement', 'Montant du dernier paiement CAD']
  const lines = invoices.map(invoice => [invoice.number ?? '',
    (invoice.closedAt ?? invoice.createdAt).slice(0, 10), invoice.patientName,
    invoice.payerName, invoice.professionalName, invoice.dueCents > 0 ? 'À payer' : 'Payée',
    dollars(invoice.totalCents), dollars(invoice.paidCents), dollars(invoice.dueCents),
    invoice.lastPaymentAt?.slice(0, 10) ?? '',
    invoice.lastPaymentCents === null ? '' : dollars(invoice.lastPaymentCents)])
  return '\uFEFF' + [headers, ...lines].map(line => line.map(safeCell).join(';')).join('\r\n') + '\r\n'
}
