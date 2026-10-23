import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type {
  ProfessionalPayrollInfo,
  ProfessionalPayrollResult,
} from '@/lib/payrollCalculator'
import { isPayrollDate, TRAVEL_FEE_RATE_PER_KM, validatePayrollPeriod } from '@/lib/payrollCalculator'
import { decimalSum, formatPayrollQuantity } from '@/lib/payrollDecimal'
import type { PayrollInvoiceRecord } from '@/lib/payrollInvoiceRegistry'

export type InvoicePeriod = {
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  dueDate: string // YYYY-MM-DD
}

export type PayrollInvoiceOptions = {
  invoiceNumber?: string
  weeklyContextConfirmed?: boolean
  record?: PayrollInvoiceRecord
}

export type PayrollInvoiceData = {
  professional: Pick<ProfessionalPayrollInfo, 'fullName' | 'professionalAddress' | 'professionalPhone' | 'email' | 'professionalTitle'>
  lineItems: { label: string; quantity: number; unitPay: number; totalPay: number; unit?: 'h' | 'élément' }[]
  cancellationLineItems: { label: string; count: number; unitPay: number; totalPay: number }[]
  travelFeesTotal: number
  travelKilometersTotal: number
  cancellationCount: number
  cancellationFeesTotal: number
  meetingsPay: number
  grandTotal: number
}

/** Projection destinée au fournisseur : aucun tarif client, pourcentage ou libellé libre. */
export function toPayrollInvoiceData(result: ProfessionalPayrollResult): PayrollInvoiceData {
  if (result.invoiceIssues?.length || result.lineItems.some(item => item.totalHours <= 0)) {
    throw new Error('Facture bloquée : confirmez les quantités et les règles des activités signalées avant émission.')
  }
  const professional = result.professional
  return {
    professional: {
      fullName: professional.fullName,
      professionalAddress: professional.professionalAddress,
      professionalPhone: professional.professionalPhone,
      email: professional.email,
      professionalTitle: professional.professionalTitle,
    },
    lineItems: result.lineItems.map((item) => ({
      label: item.kind === 'rapport_evaluation' || (!item.kind && item.label.startsWith("Rapport d'évaluation"))
        ? "Rapport d'évaluation psychoéducative"
        : item.kind === 'entretien_telephonique' || (!item.kind && item.label === 'Entretien téléphonique')
          ? 'Entretien téléphonique' : 'Rencontre',
      quantity: item.totalHours,
      unitPay: item.totalHours > 0 ? item.totalPay / item.totalHours : 0,
      totalPay: item.totalPay,
      unit: item.unit ?? (item.kind === 'entretien_telephonique' ? 'élément' : 'h'),
    })),
    cancellationLineItems: result.cancellationLineItems.map((item) => ({
      label: 'Honoraires d’annulation', count: item.count,
      unitPay: item.count > 0 ? item.totalPay / item.count : 0, totalPay: item.totalPay,
    })),
    travelFeesTotal: result.travelFeesTotal,
    travelKilometersTotal: result.travelKilometersTotal,
    cancellationCount: result.cancellationCount,
    cancellationFeesTotal: result.cancellationFeesTotal,
    meetingsPay: decimalSum(result.lineItems.map(item => item.totalPay)),
    grandTotal: result.grandTotal,
  }
}

function validateInvoicePeriod(result: ProfessionalPayrollResult, period: InvoicePeriod, options?: PayrollInvoiceOptions) {
  validatePayrollPeriod(period)
  if (!isPayrollDate(period.dueDate)) throw new Error('La date d’échéance doit être valide.')
  if (!result.period || result.period.startDate !== period.startDate || result.period.endDate !== period.endDate) {
    throw new Error('Recalculez la paie pour cette période avant de générer une facture.')
  }
  if (result.requiresWeeklyReview && !options?.weeklyContextConfirmed) {
    throw new Error('Vérifiez que l’export contient les semaines complètes avant de générer une facture.')
  }
}

const CLINIC_NAME = 'Clinique PsychoÉducAction'
const CLINIC_ADDRESS = '401, Chemin du Coteau-Rouge'
const CLINIC_CITY = 'Longueuil, J4J 1X5'
const CLINIC_PHONE = 'Tél : (438) 500-1388'
const CLINIC_BUSINESS_NUMBER = 'N° entreprise : 9523-0991 QUEBEC INC'

const COLOR_PAGE = 'FFFFFF'
const COLOR_DARK = '332820'
const COLOR_PANEL = 'F8F3EC'
const COLOR_PANEL_ALT = 'FFFDF9'
const COLOR_GOLD = '5B4A1F'
const COLOR_GOLD_LINE = 'A78343'
const COLOR_BLUSH = 'E9C8B8'
const COLOR_TEXT = '332820'
const COLOR_MUTED = '7A6859'
const COLOR_ACCENT = 'D95C2B'
const COLOR_WHITE = 'FFFFFF'

const TABLE_COLUMN_WIDTHS = [5600, 1000, 1800, 1800]
const TABLE_WIDTH = TABLE_COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0)
const LOGO_SRC = '/psychoeducaction-logo.svg'

type ParagraphAlignment = (typeof AlignmentType)[keyof typeof AlignmentType]

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
  return formatPayrollQuantity(value)
}

export function buildPayrollInvoiceNumber(
  result: Pick<PayrollInvoiceData, 'professional'>,
  invoiceNumber: string
): string {
  const initials =
    result.professional.fullName
      .split(/\s+/)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'XX'
  if (!/^\d{1,9}$/.test(invoiceNumber)) throw new Error('Le numéro historique doit contenir uniquement des chiffres.')
  const invoiceDigits = invoiceNumber.padStart(3, '0')

  return `PEA-${initials}-${invoiceDigits}`
}

export function buildPayrollInvoiceShortNumber(invoiceNumber: string): string {
  return invoiceNumber
}

export function buildPayrollInvoiceFileName(
  result: ProfessionalPayrollResult,
  period: InvoicePeriod,
  options?: PayrollInvoiceOptions
): string {
  const safeName = result.professional.fullName.replace(/[^a-z0-9]+/gi, '-')
  const invoicePart = options?.record
    ? `${options.record.number}-v${options.record.version}-${options.record.id}`
    : options?.invoiceNumber
    ? buildPayrollInvoiceNumber(result, options.invoiceNumber)
    : period.endDate

  return `Facture-${safeName}-${invoicePart}.docx`
}

function run(
  text: string,
  options?: {
    bold?: boolean
    color?: string
    size?: number
    italics?: boolean
  }
) {
  return new TextRun({
    text,
    bold: options?.bold,
    color: options?.color ?? COLOR_TEXT,
    size: options?.size ?? 18,
    italics: options?.italics,
  })
}

function paragraph(
  children: TextRun[],
  options?: {
    alignment?: ParagraphAlignment
    spacingAfter?: number
    spacingBefore?: number
  }
) {
  return new Paragraph({
    alignment: options?.alignment,
    spacing: {
      before: options?.spacingBefore ?? 0,
      after: options?.spacingAfter ?? 80,
    },
    children,
  })
}

function cell(
  children: (Paragraph | Table)[],
  options?: {
    fill?: string
    width?: number
    columnSpan?: number
  }
) {
  return new TableCell({
    width: options?.width ? { size: options.width, type: WidthType.DXA } : undefined,
    columnSpan: options?.columnSpan,
    shading: { type: ShadingType.CLEAR, fill: options?.fill ?? COLOR_PANEL, color: 'auto' },
    margins: { top: 110, bottom: 110, left: 140, right: 140 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: COLOR_GOLD_LINE },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: COLOR_GOLD_LINE },
      left: { style: BorderStyle.SINGLE, size: 1, color: COLOR_GOLD_LINE },
      right: { style: BorderStyle.SINGLE, size: 1, color: COLOR_GOLD_LINE },
    },
    children,
  })
}

function emptyLine(fill = COLOR_PAGE) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          cell([new Paragraph({ text: '' })], {
            fill,
            width: TABLE_WIDTH,
          }),
        ],
      }),
    ],
  })
}

function headerCell(text: string, width: number) {
  return cell([paragraph([run(text, { bold: true, color: COLOR_DARK, size: 16 })])], {
    fill: COLOR_BLUSH,
    width,
  })
}

function bodyCell(
  text: string,
  width: number,
  options?: {
    alignment?: ParagraphAlignment
    bold?: boolean
    color?: string
    fill?: string
  }
) {
  return cell(
    [
      paragraph([run(text, { bold: options?.bold, color: options?.color ?? COLOR_TEXT })], {
        alignment: options?.alignment,
      }),
    ],
    { fill: options?.fill ?? COLOR_PANEL, width }
  )
}

function buildInfoBox(title: string, lines: string[]): Table {
  return new Table({
    width: { size: TABLE_WIDTH / 2 - 220, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          cell([paragraph([run(title, { bold: true, color: COLOR_DARK, size: 16 })])], {
            fill: COLOR_BLUSH,
            width: TABLE_WIDTH / 2 - 220,
          }),
        ],
      }),
      new TableRow({
        children: [
          cell(
            lines.map((line) => paragraph([run(line, { color: COLOR_TEXT })], { spacingAfter: 35 })),
            { fill: COLOR_PANEL, width: TABLE_WIDTH / 2 - 220 }
          ),
        ],
      }),
    ],
  })
}

function buildHeaderTable(
  result: PayrollInvoiceData,
  period: InvoicePeriod,
  logoData: Uint8Array | null,
  options?: PayrollInvoiceOptions
): Table {
  const logoChildren = logoData
    ? [
        new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: logoData,
              transformation: { width: 205, height: 82 },
            }),
          ],
        }),
      ]
    : [paragraph([run(CLINIC_NAME, { bold: true, color: COLOR_GOLD, size: 30 })])]

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          cell(logoChildren, { fill: COLOR_PAGE, width: 5200 }),
          cell(
            [
              paragraph([run('FACTURE', { bold: true, color: COLOR_GOLD, size: 30 })], {
                alignment: AlignmentType.RIGHT,
                spacingAfter: 120,
              }),
              paragraph([run(`N° ${options?.record?.number ?? (options?.invoiceNumber ? buildPayrollInvoiceNumber(result, options.invoiceNumber) : 'BROUILLON')}`, { color: COLOR_ACCENT })], {
                alignment: AlignmentType.RIGHT,
                spacingAfter: 40,
              }),
              paragraph(
                [
                  run(
                    `Période : Du ${formatDateFr(period.startDate)} au ${formatDateFr(
                      period.endDate
                    )}`,
                    { color: COLOR_MUTED }
                  ),
                ],
                { alignment: AlignmentType.RIGHT, spacingAfter: 40 }
              ),
              paragraph(
                [run(`Date d'échéance : ${formatDateFr(period.dueDate)}`, { color: COLOR_ACCENT })],
                { alignment: AlignmentType.RIGHT, spacingAfter: 0 }
              ),
            ],
            { fill: COLOR_PAGE, width: 5000 }
          ),
        ],
      }),
    ],
  })
}

function buildPartyTable(result: PayrollInvoiceData): Table {
  const { professional } = result
  const supplierLines = [
    professional.fullName,
    ...(professional.professionalAddress ? [professional.professionalAddress] : []),
    ...(professional.professionalPhone ? [`Tél : ${professional.professionalPhone}`] : []),
    ...(professional.email ? [professional.email] : []),
    ...(professional.professionalTitle ? [professional.professionalTitle] : []),
  ]

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          cell(
            [
              buildInfoBox('FACTURÉ À', [
                CLINIC_NAME,
                CLINIC_ADDRESS,
                CLINIC_CITY,
                CLINIC_PHONE,
                CLINIC_BUSINESS_NUMBER,
              ]),
            ],
            { fill: COLOR_PAGE, width: TABLE_WIDTH / 2 }
          ),
          cell([buildInfoBox('FOURNISSEUR', supplierLines)], {
            fill: COLOR_PAGE,
            width: TABLE_WIDTH / 2,
          }),
        ],
      }),
    ],
  })
}

function buildRateTable(result: PayrollInvoiceData): Table {
  const headerRow = new TableRow({
    children: ['Description du service', 'Qté', 'Prix unitaire (CAD)', 'Total (CAD)'].map(
      (text, index) => headerCell(text, TABLE_COLUMN_WIDTHS[index])
    ),
  })

  const itemRows = result.lineItems.map((item) => {
    return new TableRow({
      children: [
        bodyCell(item.label, TABLE_COLUMN_WIDTHS[0], { bold: true }),
        bodyCell(formatPayrollQuantity(item.quantity, item.unit), TABLE_COLUMN_WIDTHS[1], {
          alignment: AlignmentType.CENTER,
        }),
        bodyCell(new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 6 }).format(item.unitPay), TABLE_COLUMN_WIDTHS[2], {
          alignment: AlignmentType.RIGHT,
        }),
        bodyCell(formatCurrency(item.totalPay), TABLE_COLUMN_WIDTHS[3], {
          alignment: AlignmentType.RIGHT,
          bold: true,
        }),
      ],
    })
  })

  const totalRow = new TableRow({
    children: [
      bodyCell('TOTAL', TABLE_COLUMN_WIDTHS[0] + TABLE_COLUMN_WIDTHS[1] + TABLE_COLUMN_WIDTHS[2], {
        alignment: AlignmentType.RIGHT,
        bold: true,
        color: COLOR_WHITE,
        fill: COLOR_GOLD,
      }),
      bodyCell(formatCurrency(result.meetingsPay), TABLE_COLUMN_WIDTHS[3], {
        alignment: AlignmentType.RIGHT,
        bold: true,
        color: COLOR_WHITE,
        fill: COLOR_GOLD,
      }),
    ],
  })

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: TABLE_COLUMN_WIDTHS,
    rows: [headerRow, ...itemRows, totalRow],
  })
}

function buildRateSection(result: PayrollInvoiceData): (Paragraph | Table)[] {
  if (result.lineItems.length === 0) return []
  return [
    paragraph([run('Honoraires professionnels', { bold: true, color: COLOR_MUTED })], {
      spacingBefore: 240,
      spacingAfter: 120,
    }),
    buildRateTable(result),
  ]
}

function buildExtrasTable(result: PayrollInvoiceData): Table | null {
  const rows: TableRow[] = []

  if (result.travelFeesTotal > 0) {
    rows.push(
      new TableRow({
        children: [
          bodyCell('Frais de déplacement', TABLE_COLUMN_WIDTHS[0], { bold: true }),
          bodyCell(formatQuantity(result.travelKilometersTotal), TABLE_COLUMN_WIDTHS[1], {
            alignment: AlignmentType.CENTER,
          }),
          bodyCell(formatCurrency(TRAVEL_FEE_RATE_PER_KM), TABLE_COLUMN_WIDTHS[2], {
            alignment: AlignmentType.RIGHT,
          }),
          bodyCell(formatCurrency(result.travelFeesTotal), TABLE_COLUMN_WIDTHS[3], {
            alignment: AlignmentType.RIGHT,
            bold: true,
          }),
        ],
      })
    )
  }

  if (result.cancellationCount > 0) {
    rows.push(
      ...result.cancellationLineItems.map(
        (item) =>
          new TableRow({
            children: [
              bodyCell(item.label, TABLE_COLUMN_WIDTHS[0], { bold: true }),
              bodyCell(String(item.count), TABLE_COLUMN_WIDTHS[1], {
                alignment: AlignmentType.CENTER,
              }),
              bodyCell(formatCurrency(item.unitPay), TABLE_COLUMN_WIDTHS[2], {
                alignment: AlignmentType.RIGHT,
              }),
              bodyCell(formatCurrency(item.totalPay), TABLE_COLUMN_WIDTHS[3], {
                alignment: AlignmentType.RIGHT,
                bold: true,
              }),
            ],
          })
      )
    )
  }

  if (rows.length === 0) return null

  const totalExtras = decimalSum([result.travelFeesTotal, result.cancellationFeesTotal])

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: TABLE_COLUMN_WIDTHS,
    rows: [
      new TableRow({
        children: ['Description du service', 'Qté', 'Prix unitaire (CAD)', 'Total (CAD)'].map(
          (text, index) => headerCell(text, TABLE_COLUMN_WIDTHS[index])
        ),
      }),
      ...rows,
      new TableRow({
        children: [
          bodyCell(
            'TOTAL',
            TABLE_COLUMN_WIDTHS[0] + TABLE_COLUMN_WIDTHS[1] + TABLE_COLUMN_WIDTHS[2],
            {
              alignment: AlignmentType.RIGHT,
              bold: true,
              color: COLOR_WHITE,
              fill: COLOR_GOLD,
            }
          ),
          bodyCell(formatCurrency(totalExtras), TABLE_COLUMN_WIDTHS[3], {
            alignment: AlignmentType.RIGHT,
            bold: true,
            color: COLOR_WHITE,
            fill: COLOR_GOLD,
          }),
        ],
      }),
    ],
  })
}

function buildPaymentSummary(result: PayrollInvoiceData, period: InvoicePeriod): Table {
  const totalLines = result.lineItems.length > 0 ? [
    paragraph(
      [
        run('Honoraires professionnels : ', { bold: true, color: COLOR_TEXT }),
        run(formatCurrency(result.meetingsPay), { bold: true, color: COLOR_ACCENT }),
      ],
      { spacingAfter: 40 }
    )
  ] : []

  if (result.travelFeesTotal > 0) {
    totalLines.push(
      paragraph(
        [
          run('Frais de déplacement : ', { bold: true, color: COLOR_TEXT }),
          run(formatCurrency(result.travelFeesTotal), { bold: true, color: COLOR_ACCENT }),
        ],
        { spacingAfter: 40 }
      )
    )
  }

  if (result.cancellationFeesTotal > 0) {
    totalLines.push(
      paragraph(
        [
          run("Frais d'annulation : ", { bold: true, color: COLOR_TEXT }),
          run(formatCurrency(result.cancellationFeesTotal), { bold: true, color: COLOR_ACCENT }),
        ],
        { spacingAfter: 40 }
      )
    )
  }

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          cell([paragraph([run('INFORMATIONS DE PAIEMENT', { bold: true, color: COLOR_DARK })])], {
            fill: COLOR_BLUSH,
            width: TABLE_WIDTH,
            columnSpan: 2,
          }),
        ],
      }),
      new TableRow({
        children: [
          cell(
            [
              ...totalLines,
              paragraph([run('Méthode : ', { bold: true }), run('Virement bancaire')], {
                spacingAfter: 40,
              }),
              paragraph([run('Échéance : ', { bold: true }), run(formatDateFr(period.dueDate))], {
                spacingAfter: 0,
              }),
            ],
            { fill: COLOR_PANEL, width: 5600 }
          ),
          cell(
            [
              paragraph([run('TOTAL GÉNÉRAL', { bold: true, color: COLOR_WHITE, size: 18 })], {
                alignment: AlignmentType.RIGHT,
                spacingAfter: 60,
              }),
              paragraph([run(formatCurrency(result.grandTotal), { bold: true, color: COLOR_ACCENT, size: 26 })], {
                alignment: AlignmentType.RIGHT,
                spacingAfter: 0,
              }),
            ],
            { fill: COLOR_PANEL_ALT, width: 4600 }
          ),
        ],
      }),
    ],
  })
}

function buildSignatureSection(result: PayrollInvoiceData, period: InvoicePeriod): Table {
  const { professional } = result
  const title = professional.professionalTitle ?? 'Professionnel'

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          cell(
            [
              paragraph([run('Signature :', { bold: true, color: COLOR_MUTED })], {
                spacingAfter: 260,
              }),
              paragraph([run('__________________________________', { color: COLOR_GOLD_LINE })], {
                spacingAfter: 40,
              }),
              paragraph([run(professional.fullName, { color: COLOR_MUTED })], { spacingAfter: 0 }),
            ],
            { fill: COLOR_PAGE, width: TABLE_WIDTH / 2 }
          ),
          cell(
            [
              paragraph(
                [run('Date : ', { bold: true, color: COLOR_MUTED }), run(formatDateFr(period.endDate))],
                { spacingAfter: 260 }
              ),
              paragraph([run('__________________________________', { color: COLOR_GOLD_LINE })], {
                spacingAfter: 40,
              }),
              paragraph([run(title, { color: COLOR_MUTED })], { spacingAfter: 0 }),
            ],
            { fill: COLOR_PAGE, width: TABLE_WIDTH / 2 }
          ),
        ],
      }),
    ],
  })
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Logo introuvable.'))
    image.src = src
  })
}

async function loadLogoImage(): Promise<Uint8Array | null> {
  let objectUrl = ''

  try {
    const response = await fetch(LOGO_SRC)
    if (!response.ok) return null

    const svgText = await response.text()
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml' })
    objectUrl = URL.createObjectURL(svgBlob)
    const image = await loadImage(objectUrl)
    const canvas = document.createElement('canvas')
    const width = image.naturalWidth || 949
    const height = image.naturalHeight || 408
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return null

    context.clearRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    return dataUrlToBytes(canvas.toDataURL('image/png'))
  } catch {
    return null
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

export function generatePayrollInvoiceDocument(
  result: ProfessionalPayrollResult,
  period: InvoicePeriod,
  logoData: Uint8Array | null,
  options?: PayrollInvoiceOptions
): Document {
  validateInvoicePeriod(result, period, options)
  const invoice = toPayrollInvoiceData(result)
  return generatePayrollInvoiceDocumentFromData(invoice, period, logoData, options)
}

// Les régénérations utilisent le snapshot immuable, jamais le profil ou le calcul courant.
export function generatePayrollInvoiceDocumentFromData(
  invoice: PayrollInvoiceData, period: InvoicePeriod, logoData: Uint8Array | null,
  options?: PayrollInvoiceOptions
): Document {
  validatePayrollPeriod(period)
  if (!isPayrollDate(period.dueDate)) throw new Error('Date d’échéance invalide.')
  if (invoice.lineItems.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.totalPay) || item.totalPay < 0) ||
    decimalSum(invoice.lineItems.map(item => item.totalPay)) !== invoice.meetingsPay ||
    decimalSum(invoice.cancellationLineItems.map(item => item.totalPay)) !== invoice.cancellationFeesTotal ||
    !Number.isFinite(invoice.travelFeesTotal) || invoice.travelFeesTotal < 0) {
    throw new Error('Quantités ou montants de facture incohérents : émission bloquée.')
  }
  if (decimalSum([invoice.meetingsPay, invoice.cancellationFeesTotal, invoice.travelFeesTotal]) !== invoice.grandTotal) {
    throw new Error('Les postes de la facture ne correspondent pas au total.')
  }
  const extrasTable = buildExtrasTable(invoice)

  return new Document({
    background: { color: COLOR_PAGE },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 620, right: 620, bottom: 620, left: 620 },
          },
        },
        children: [
          buildHeaderTable(invoice, period, logoData, options),
          paragraph([run(options?.record
            ? `Identifiant : ${options.record.id} — Version ${options.record.version}${options.record.version > 1 ? ' — RECTIFICATIF NON SIGNÉ — nouvelle approbation requise' : ''}`
            : 'BROUILLON NON ÉMIS — aucune signature antérieure ne vaut approbation', { size: 14 })]),
          ...(options?.record?.reason ? [paragraph([run(`Motif du rectificatif : ${options.record.reason}`)])] : []),
          emptyLine(),
          buildPartyTable(invoice),
          ...buildRateSection(invoice),
          ...(extrasTable
            ? [
                paragraph([run('Frais additionnels', { bold: true, color: COLOR_MUTED })], {
                  spacingBefore: 240,
                  spacingAfter: 120,
                }),
                extrasTable,
              ]
            : []),
          emptyLine(),
          buildPaymentSummary(invoice, period),
          emptyLine(),
          buildSignatureSection(invoice, period),
          paragraph(
            [
              run(`${CLINIC_NAME} - ${CLINIC_ADDRESS}, ${CLINIC_CITY} - ${CLINIC_PHONE}`, {
                color: COLOR_MUTED,
                size: 14,
              }),
            ],
            { alignment: AlignmentType.CENTER, spacingBefore: 260, spacingAfter: 0 }
          ),
        ],
      },
    ],
  })
}

export async function createPayrollInvoiceBlob(
  result: ProfessionalPayrollResult,
  period: InvoicePeriod,
  options?: PayrollInvoiceOptions
): Promise<Blob> {
  validateInvoicePeriod(result, period, options)
  const logoData = await loadLogoImage()
  const registeredSnapshot = options?.record?.snapshot
  if (options?.record && !registeredSnapshot) throw new Error('Téléchargez les octets archivés de l’original historique; aucune régénération de l’original.')
  const doc = registeredSnapshot
    ? generatePayrollInvoiceDocumentFromData(registeredSnapshot.invoice, registeredSnapshot.period, logoData, options)
    : generatePayrollInvoiceDocument(result, period, logoData, options)

  return Packer.toBlob(doc)
}

export async function downloadPayrollInvoice(
  result: ProfessionalPayrollResult,
  period: InvoicePeriod,
  options?: PayrollInvoiceOptions
): Promise<void> {
  const blob = await createPayrollInvoiceBlob(result, period, options)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = buildPayrollInvoiceFileName(result, period, options)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
