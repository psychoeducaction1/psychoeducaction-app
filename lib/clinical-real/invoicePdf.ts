import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export type RealInvoice = {
  id: string; number: number | null; status: 'open' | 'closed';
  payerName: string; payerAddress?: string | null; patientName: string; professionalName: string;
  totalCents: number; paidCents: number; dueCents: number;
  lines: { serviceAt: string; service: string; amountCents: number }[];
  payments: { receivedAt: string; amountCents: number }[];
}

const cad = (cents: number) => new Intl.NumberFormat('fr-CA', {
  style: 'currency', currency: 'CAD', currencyDisplay: 'symbol',
}).format(cents / 100)
const day = (instant: string) => new Intl.DateTimeFormat('fr-CA', {
  dateStyle: 'medium', timeZone: 'America/Toronto',
}).format(new Date(instant))

/** L'aperçu d'une facture ouverte est distinct du document émis. */
export async function renderRealInvoicePdf(invoice: RealInvoice, clinic: {
  name: string; address: string; phone: string; email: string;
}): Promise<Uint8Array> {
  if (!invoice.lines.length || !Number.isInteger(invoice.totalCents)
    || invoice.totalCents <= 0 || invoice.lines.some(line => !Number.isInteger(line.amountCents)
      || line.amountCents <= 0 || !Number.isFinite(Date.parse(line.serviceAt)))) {
    throw new Error('INVOICE_PDF_INVALID_SOURCE')
  }
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const brown = rgb(0.36, 0.22, 0.14)
  const gray = rgb(0.35, 0.34, 0.33)
  const logo = await pdf.embedPng(await readFile(join(process.cwd(), 'public', 'psychoeducaction-email-logo.png')))
  const width = 595.28, height = 841.89
  let page = pdf.addPage([width, height]); let y = height - 62
  const text = (value: string, x: number, at: number, size = 10, strong = false) => {
    page.drawText(value.replace(/[\r\n]+/g, ' ').slice(0, 110), {
      x, y: at, size, font: strong ? bold : regular, color: strong ? brown : gray,
    })
  }
  const rule = (at: number) => page.drawLine({ start: { x: 42, y: at },
    end: { x: width - 42, y: at }, thickness: 0.7, color: rgb(0.75, 0.68, 0.59) })
  const footer = () => {
    rule(73)
    text([clinic.name, clinic.address, clinic.phone, clinic.email].filter(Boolean).join(' · '), 42, 57, 8)
    text(`Page ${pdf.getPageCount()}`, width - 89, 41, 8)
  }
  const newPage = () => { footer(); page = pdf.addPage([width, height]); y = height - 56 }
  page.drawImage(logo, { x: 42, y: height - 130, width: 150, height: 70 })
  text(clinic.name, 295, height - 65, 11, true)
  if (clinic.address) text(clinic.address, 295, height - 82, 9)
  if (clinic.phone) text(clinic.phone, 295, height - 97, 9)
  if (clinic.email) text(clinic.email, 295, height - 112, 9)
  y = height - 158; rule(y)
  y -= 28; text(invoice.number ? `Facture no ${invoice.number}` : 'Aperçu de la facture ouverte', 42, y, 16, true)
  y -= 27; text(`À l'attention de : ${invoice.payerName}`, 42, y, 10, true)
  if (invoice.payerAddress) { y -= 16; text(invoice.payerAddress, 42, y, 9) }
  y -= 17; text(`Actes effectués dans le dossier : ${invoice.patientName}`, 42, y)
  y -= 17; text(`Professionnel : ${invoice.professionalName}`, 42, y)
  y -= 25; rule(y)
  y -= 19; text('Date', 46, y, 9, true); text('Service', 160, y, 9, true)
  text('Montant', 485, y, 9, true)
  y -= 10; rule(y)
  for (const line of invoice.lines) {
    if (y < 170) newPage()
    y -= 22; text(day(line.serviceAt), 46, y, 9)
    text(line.service.slice(0, 50), 160, y, 9)
    text(cad(line.amountCents), 475, y, 9)
    rule(y - 8)
  }
  if (y < 200) newPage()
  y -= 35; text(`Total : ${cad(invoice.totalCents)}`, 360, y, 11, true)
  y -= 20; text(`Paiements reçus : ${cad(invoice.paidCents)}`, 360, y)
  y -= 20; text(`À payer : ${cad(invoice.dueCents)}`, 360, y, 11, true)
  if (invoice.payments.length) {
    y -= 35; text('Paiements', 42, y, 10, true)
    for (const payment of invoice.payments) {
      if (y < 155) newPage()
      y -= 18; text(`${day(payment.receivedAt)} · ${cad(payment.amountCents)}`, 42, y)
    }
  }
  if (y < 125) newPage()
  y -= 39
  text(invoice.dueCents === 0 && invoice.status === 'closed'
    ? 'Ce document est un reçu officiel lorsque les sommes à recevoir sont à zéro.'
    : 'Document de facturation. Un reçu sera disponible après paiement complet.', 42, y, 9)
  footer()
  return pdf.save({ useObjectStreams: false })
}
