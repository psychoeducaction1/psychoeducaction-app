import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { ProfessionalPayrollResult } from '@/lib/payrollCalculator'

export type InvoicePeriod = {
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  dueDate: string // YYYY-MM-DD
}

const CLINIC_NAME = 'Clinique PsychoÉducAction'
const CLINIC_ADDRESS = '401, Chemin du Coteau-Rouge'
const CLINIC_CITY = 'Longueuil, J4J 1X5'
const CLINIC_PHONE = 'Tél : (438) 500-1388'
const CLINIC_BUSINESS_NUMBER = 'N° entreprise : 9523-0991 QUEBEC INC'

const TABLE_COLUMN_WIDTHS = [4500, 1400, 1700, 1700]
const TABLE_WIDTH = TABLE_COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0)

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(value)
}

function formatDateFr(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function buildInvoiceNumber(result: ProfessionalPayrollResult, period: InvoicePeriod): string {
  const initials =
    result.professional.fullName
      .split(/\s+/)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'XX'
  const periodCode = period.endDate.replace(/-/g, '')
  return `CMPEA-${initials}-${periodCode}`
}

function cellParagraph(
  text: string,
  options?: { bold?: boolean; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] }
) {
  return new Paragraph({
    alignment: options?.alignment,
    children: [new TextRun({ text, bold: options?.bold })],
  })
}

function headerCell(text: string) {
  return new TableCell({
    width: { size: 0, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: 'EFE1D2', color: 'auto' },
    children: [cellParagraph(text, { bold: true })],
  })
}

function bodyCell(text: string, alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]) {
  return new TableCell({
    width: { size: 0, type: WidthType.DXA },
    children: [cellParagraph(text, { alignment })],
  })
}

function buildLineItemsTable(result: ProfessionalPayrollResult): Table {
  const headerRow = new TableRow({
    children: ['Description du service', 'Qté', 'Prix unitaire (CAD)', 'Total (CAD)'].map(
      (text) => headerCell(text)
    ),
  })

  const itemRows = result.lineItems.map((item) => {
    const unitPrice = item.isFlatRate ? item.rate : item.amount * item.rate

    return new TableRow({
      children: [
        bodyCell(item.label),
        bodyCell(formatQuantity(item.totalHours), AlignmentType.CENTER),
        bodyCell(formatCurrency(unitPrice), AlignmentType.RIGHT),
        bodyCell(formatCurrency(item.totalPay), AlignmentType.RIGHT),
      ],
    })
  })

  const extraRows: TableRow[] = []

  if (result.travelFeesTotal > 0) {
    extraRows.push(
      new TableRow({
        children: [
          bodyCell('Frais de déplacement'),
          bodyCell('', AlignmentType.CENTER),
          bodyCell('', AlignmentType.RIGHT),
          bodyCell(formatCurrency(result.travelFeesTotal), AlignmentType.RIGHT),
        ],
      })
    )
  }

  if (result.cancellationCount > 0) {
    const perCancellation = result.cancellationFeesTotal / result.cancellationCount

    extraRows.push(
      new TableRow({
        children: [
          bodyCell("Frais d'annulation de rencontre"),
          bodyCell(String(result.cancellationCount), AlignmentType.CENTER),
          bodyCell(formatCurrency(perCancellation), AlignmentType.RIGHT),
          bodyCell(formatCurrency(result.cancellationFeesTotal), AlignmentType.RIGHT),
        ],
      })
    )
  }

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: TABLE_COLUMN_WIDTHS,
    rows: [headerRow, ...itemRows, ...extraRows],
  })
}

export function generatePayrollInvoiceDocument(
  result: ProfessionalPayrollResult,
  period: InvoicePeriod
): Document {
  const { professional, grandTotal } = result
  const professionalTitleLine = professional.professionalTitle
    ? [new Paragraph({ text: professional.professionalTitle })]
    : []

  return new Document({
    sections: [
      {
        properties: {
          page: { size: { width: 12240, height: 15840 } },
        },
        children: [
          new Paragraph({ text: 'FACTURE', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `N° ${buildInvoiceNumber(result, period)}` }),
          new Paragraph({
            text: `Période : Du ${formatDateFr(period.startDate)} au ${formatDateFr(period.endDate)}`,
          }),
          new Paragraph({ text: `Date d'échéance : ${formatDateFr(period.dueDate)}` }),
          new Paragraph({ text: '' }),

          new Paragraph({ text: 'FACTURÉ À', heading: HeadingLevel.HEADING_3 }),
          new Paragraph({ text: CLINIC_NAME }),
          new Paragraph({ text: CLINIC_ADDRESS }),
          new Paragraph({ text: CLINIC_CITY }),
          new Paragraph({ text: CLINIC_PHONE }),
          new Paragraph({ text: CLINIC_BUSINESS_NUMBER }),
          new Paragraph({ text: '' }),

          new Paragraph({ text: 'FOURNISSEUR', heading: HeadingLevel.HEADING_3 }),
          new Paragraph({ text: professional.fullName }),
          ...(professional.professionalAddress
            ? [new Paragraph({ text: professional.professionalAddress })]
            : []),
          ...(professional.professionalPhone
            ? [new Paragraph({ text: `Tél : ${professional.professionalPhone}` })]
            : []),
          ...professionalTitleLine,
          new Paragraph({ text: '' }),

          buildLineItemsTable(result),
          new Paragraph({ text: '' }),
          new Paragraph({
            children: [
              new TextRun({ text: `TOTAL GÉNÉRAL : ${formatCurrency(grandTotal)}`, bold: true, size: 28 }),
            ],
          }),
          new Paragraph({ text: '' }),

          new Paragraph({ text: 'INFORMATIONS DE PAIEMENT', heading: HeadingLevel.HEADING_3 }),
          new Paragraph({ text: 'Méthode : Virement bancaire' }),
          new Paragraph({ text: `Échéance : ${formatDateFr(period.dueDate)}` }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: '' }),

          new Paragraph({ text: 'Signature :' }),
          new Paragraph({ text: '' }),
          new Paragraph({ text: '__________________________________' }),
          new Paragraph({
            text: professional.professionalTitle
              ? `${professional.fullName}, ${professional.professionalTitle}`
              : professional.fullName,
          }),
        ],
      },
    ],
  })
}

export async function downloadPayrollInvoice(
  result: ProfessionalPayrollResult,
  period: InvoicePeriod
): Promise<void> {
  const doc = generatePayrollInvoiceDocument(result, period)
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const safeName = result.professional.fullName.replace(/[^a-z0-9]+/gi, '-')

  link.href = url
  link.download = `Facture-${safeName}-${period.endDate}.docx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
