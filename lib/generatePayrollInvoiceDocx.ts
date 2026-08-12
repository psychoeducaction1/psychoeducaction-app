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
  InvoiceLineItem,
  PayrollRateGroup,
  ProfessionalPayrollResult,
} from '@/lib/payrollCalculator'
import { TRAVEL_FEE_RATE_PER_KM } from '@/lib/payrollCalculator'

export type InvoicePeriod = {
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  dueDate: string // YYYY-MM-DD
}

export type PayrollInvoiceOptions = {
  invoiceNumber?: string
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
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function buildPayrollInvoiceNumber(
  result: ProfessionalPayrollResult,
  invoiceNumber: string
): string {
  const initials =
    result.professional.fullName
      .split(/\s+/)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'XX'
  const invoiceDigits = invoiceNumber.replace(/\D/g, '').padStart(3, '0')

  return `PEA-${initials}-${invoiceDigits}`
}

export function buildPayrollInvoiceShortNumber(invoiceNumber: string): string {
  const invoiceDigits = invoiceNumber.replace(/\D/g, '').padStart(3, '0')

  return invoiceDigits.slice(-2)
}

export function buildPayrollInvoiceFileName(
  result: ProfessionalPayrollResult,
  period: InvoicePeriod,
  options?: PayrollInvoiceOptions
): string {
  const safeName = result.professional.fullName.replace(/[^a-z0-9]+/gi, '-')
  const invoicePart = options?.invoiceNumber
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
  result: ProfessionalPayrollResult,
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
              paragraph([run(`N° ${buildPayrollInvoiceNumber(result, options?.invoiceNumber ?? '')}`, { color: COLOR_ACCENT })], {
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

function buildPartyTable(result: ProfessionalPayrollResult): Table {
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

function buildRateTable(group: PayrollRateGroup): Table {
  const headerRow = new TableRow({
    children: ['Description du service', 'Qté', 'Prix unitaire (CAD)', 'Total (CAD)'].map(
      (text, index) => headerCell(text, TABLE_COLUMN_WIDTHS[index])
    ),
  })

  const itemRows = group.lineItems.map((item: InvoiceLineItem) => {
    const unitPrice = item.isFlatRate ? item.rate : item.amount * item.rate

    return new TableRow({
      children: [
        bodyCell(item.label, TABLE_COLUMN_WIDTHS[0], { bold: true }),
        bodyCell(formatQuantity(item.totalHours), TABLE_COLUMN_WIDTHS[1], {
          alignment: AlignmentType.CENTER,
        }),
        bodyCell(formatCurrency(unitPrice), TABLE_COLUMN_WIDTHS[2], {
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
      bodyCell(formatCurrency(group.totalPay), TABLE_COLUMN_WIDTHS[3], {
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

function buildRateSection(group: PayrollRateGroup): (Paragraph | Table)[] {
  const wording = group.isFlatRate
    ? `Les rencontres ci-dessous sont rémunérées à ${group.label}.`
    : `Les rencontres ci-dessous sont rémunérées à ${group.label}.`

  return [
    paragraph([run(wording, { bold: true, color: COLOR_MUTED })], {
      spacingBefore: 240,
      spacingAfter: 120,
    }),
    buildRateTable(group),
  ]
}

function buildExtrasTable(result: ProfessionalPayrollResult): Table | null {
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
    const perCancellation = result.cancellationFeesTotal / result.cancellationCount

    rows.push(
      new TableRow({
        children: [
          bodyCell("Frais d'annulation de rencontre", TABLE_COLUMN_WIDTHS[0], { bold: true }),
          bodyCell(String(result.cancellationCount), TABLE_COLUMN_WIDTHS[1], {
            alignment: AlignmentType.CENTER,
          }),
          bodyCell(formatCurrency(perCancellation), TABLE_COLUMN_WIDTHS[2], {
            alignment: AlignmentType.RIGHT,
          }),
          bodyCell(formatCurrency(result.cancellationFeesTotal), TABLE_COLUMN_WIDTHS[3], {
            alignment: AlignmentType.RIGHT,
            bold: true,
          }),
        ],
      })
    )
  }

  if (rows.length === 0) return null

  const totalExtras = result.travelFeesTotal + result.cancellationFeesTotal

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

function buildPaymentSummary(result: ProfessionalPayrollResult, period: InvoicePeriod): Table {
  const totalLines = result.rateGroups.map((group) =>
    paragraph(
      [
        run(`${group.label} : `, { bold: true, color: COLOR_TEXT }),
        run(formatCurrency(group.totalPay), { bold: true, color: COLOR_ACCENT }),
      ],
      { spacingAfter: 40 }
    )
  )

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

function buildSignatureSection(result: ProfessionalPayrollResult, period: InvoicePeriod): Table {
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
  const extrasTable = buildExtrasTable(result)

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
          buildHeaderTable(result, period, logoData, options),
          emptyLine(),
          buildPartyTable(result),
          ...result.rateGroups.flatMap((group) => buildRateSection(group)),
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
          buildPaymentSummary(result, period),
          emptyLine(),
          buildSignatureSection(result, period),
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
  const logoData = await loadLogoImage()
  const doc = generatePayrollInvoiceDocument(result, period, logoData, options)

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
