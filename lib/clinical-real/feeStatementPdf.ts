import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

type FeeLine = { serviceDate: string; kind: string; feeCents: number }
type Statement = { id: string; professionalName: string; from: string; to: string;
  validatedAt: string; totalCents: number; lines: FeeLine[] }
const date = /^\d{4}-\d{2}-\d{2}$/
const uuid = /^[a-f0-9-]{36}$/i
const money = (value: number) => (value / 100).toFixed(2).replace('.', ',') + ' $'
const labels: Record<string, string> = {
  meeting: 'Rencontre', report: 'Rapport', travel: 'Déplacement',
  cancellation: 'Annulation', regularisation: 'Complément de semaine',
}

function statement(value: unknown): Statement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('FEE_PDF_INVALID')
  const item = value as Partial<Statement>
  if (typeof item.id !== 'string' || !uuid.test(item.id)
    || typeof item.professionalName !== 'string' || !item.professionalName.trim()
    || item.professionalName.length > 200
    || typeof item.from !== 'string' || !date.test(item.from)
    || typeof item.to !== 'string' || !date.test(item.to)
    || typeof item.validatedAt !== 'string' || Number.isNaN(Date.parse(item.validatedAt))
    || !Number.isSafeInteger(item.totalCents) || item.totalCents! < 0
    || !Array.isArray(item.lines) || item.lines.length < 1 || item.lines.length > 2000
    || !item.lines.every(line => line && date.test(line.serviceDate)
      && Object.hasOwn(labels, line.kind) && Number.isSafeInteger(line.feeCents)
      && line.feeCents >= 0)) throw new Error('FEE_PDF_INVALID')
  if (item.lines.reduce((sum, line) => sum + line.feeCents, 0) !== item.totalCents)
    throw new Error('FEE_PDF_TOTAL_MISMATCH')
  return item as Statement
}

/** Relevé privé : aucune identité de client ni tarif facturé au client. */
export async function renderRealFeeStatementPdf(source: unknown): Promise<Uint8Array> {
  const data = statement(source)
  const pdf = await PDFDocument.create()
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.20, 0.16, 0.13)
  const printableName = [...data.professionalName.replace(/\s+/g, ' ').trim()]
    .map(character => { try { normal.encodeText(character); return character } catch { return '?' } })
    .join('')
  let name = printableName
  while (normal.widthOfTextAtSize(`Professionnel : ${name}`, 10) > 520 && name.length > 1)
    name = name.slice(0, -1)
  if (name !== printableName) name = `${name.trimEnd()}...`
  let page = pdf.addPage([612, 792])
  let y = 744
  const heading = () => {
    page.drawText('RELEVÉ D’HONORAIRES', { x: 44, y, size: 15, font: bold, color: ink })
    y -= 28
    page.drawText(`Professionnel : ${name}`, { x: 44, y, size: 10, font: normal, color: ink })
    y -= 17
    page.drawText(`Période : ${data.from} au ${data.to}`, { x: 44, y, size: 10, font: normal, color: ink })
    y -= 17
    page.drawText(`Validé le : ${data.validatedAt.slice(0, 10)}`, { x: 44, y, size: 10, font: normal, color: ink })
    y -= 28
    page.drawText('Date', { x: 44, y, size: 9, font: bold, color: ink })
    page.drawText('Activité', { x: 174, y, size: 9, font: bold, color: ink })
    page.drawText('Honoraires', { x: 458, y, size: 9, font: bold, color: ink })
    y -= 14
  }
  heading()
  for (const line of data.lines) {
    if (y < 72) { page = pdf.addPage([612, 792]); y = 744; heading() }
    page.drawText(line.serviceDate, { x: 44, y, size: 9, font: normal, color: ink })
    page.drawText(labels[line.kind], { x: 174, y, size: 9, font: normal, color: ink })
    page.drawText(money(line.feeCents), { x: 458, y, size: 9, font: normal, color: ink })
    y -= 18
  }
  if (y < 70) { page = pdf.addPage([612, 792]); y = 744 }
  page.drawLine({ start: { x: 44, y: y + 7 }, end: { x: 568, y: y + 7 },
    thickness: 1, color: ink })
  page.drawText(`TOTAL : ${money(data.totalCents)}`, {
    x: 390, y: y - 9, size: 11, font: bold, color: ink,
  })
  return pdf.save({ useObjectStreams: false })
}
