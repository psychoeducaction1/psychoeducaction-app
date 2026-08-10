import { normalizeEmail } from '@/lib/superAdmin'

export type PayrollCategory =
  | 'intervenant_psychoeducation'
  | 'psychoeducateur_membre_ordre'
  | 'psychotherapeute'

export const PAYROLL_CATEGORY_OPTIONS: PayrollCategory[] = [
  'intervenant_psychoeducation',
  'psychoeducateur_membre_ordre',
  'psychotherapeute',
]

export const PAYROLL_CATEGORY_LABELS: Record<PayrollCategory, string> = {
  intervenant_psychoeducation: 'Intervenant en psychoéducation',
  psychoeducateur_membre_ordre: "Psychoéducateur (membre d'un ordre)",
  psychotherapeute: 'Psychothérapeute',
}

type CategoryRates = {
  belowThreshold: number
  atOrAboveThreshold: number
  cancellationFee: number
  isFlatRate: boolean
}

const PAYROLL_CATEGORY_RATES: Record<PayrollCategory, CategoryRates> = {
  intervenant_psychoeducation: {
    belowThreshold: 0.5,
    atOrAboveThreshold: 0.6,
    cancellationFee: 36,
    isFlatRate: false,
  },
  psychoeducateur_membre_ordre: {
    belowThreshold: 0.6,
    atOrAboveThreshold: 0.7,
    cancellationFee: 42,
    isFlatRate: false,
  },
  psychotherapeute: {
    belowThreshold: 110,
    atOrAboveThreshold: 110,
    cancellationFee: 55,
    isFlatRate: true,
  },
}

const WEEKLY_THRESHOLD = 10

// Confirmé avec l'utilisateur : le montant réclamé au client indique lui-même le type de
// suivi, puisque le fichier Excel source n'a pas de colonne dédiée pour ça.
const RATE_TO_SERVICE_TYPE: Record<number, string> = {
  110: 'Suivi individuel',
  120: 'Suivi individuel',
  125: 'Suivi dyade',
  130: 'Suivi dyade',
  145: 'Suivi familial',
}

function getServiceTypeLabel(amount: number): string {
  return RATE_TO_SERVICE_TYPE[amount] ?? 'Rencontre'
}

function formatRateAmount(value: number): string {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(value)
}

// Toujours exclue du calcul, peu importe ce qui apparaît sous son nom dans le fichier.
// Elle est identifiée par courriel de compte plutôt que par le texte du nom.
const NANCY_AL_KAYAL_EMAIL = 'nancy.alkayal.pea@outlook.com'

export type ProfessionalPayrollInfo = {
  id: string
  fullName: string
  email: string | null
  payrollCategory: PayrollCategory | null
  professionalAddress: string | null
  professionalPhone: string | null
  professionalTitle: string | null
}

export type InvoiceLineItem = {
  label: string
  amount: number
  rate: number
  isFlatRate: boolean
  totalHours: number
  totalPay: number
}

export type PayrollRateGroup = {
  label: string
  rate: number
  isFlatRate: boolean
  lineItems: InvoiceLineItem[]
  totalPay: number
}

export type ProfessionalPayrollResult = {
  professional: ProfessionalPayrollInfo
  lineItems: InvoiceLineItem[]
  rateGroups: PayrollRateGroup[]
  meetingCount: number
  travelFeesTotal: number
  cancellationCount: number
  cancellationFeesTotal: number
  grandTotal: number
}

export type PayrollCalculationWarning = {
  type: 'unmatched_professional' | 'missing_category' | 'unclassified_row' | 'unreadable_date'
  message: string
}

export type PayrollCalculationResult = {
  professionalResults: ProfessionalPayrollResult[]
  warnings: PayrollCalculationWarning[]
}

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalizeSearchText(value: string): string {
  return normalizeName(value).replace(/[-_]+/g, ' ')
}

function rowHasNonBillableMention(row: unknown[]): boolean {
  return row.some(
    (cell) =>
      typeof cell === 'string' &&
      normalizeSearchText(cell).includes('non facturable')
  )
}

function parseAmount(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw !== 'string') return 0

  const cleaned = raw.replace(/[^0-9.,-]/g, '').replace(',', '.')
  const value = parseFloat(cleaned)
  return Number.isFinite(value) ? value : 0
}

function parseDateCell(raw: unknown): { date: string; durationHours: number } | null {
  if (typeof raw !== 'string') return null

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const dateLine = lines.find((line) => /^\d{4}-\d{2}-\d{2}/.test(line))

  if (!dateLine) return null

  const timeLine = lines.find((line) => /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(line))
  const date = dateLine.slice(0, 10)
  let durationHours = 0

  if (timeLine) {
    const match = timeLine.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/)

    if (match) {
      const [, startH, startM, endH, endM] = match
      const startMinutes = Number(startH) * 60 + Number(startM)
      const endMinutes = Number(endH) * 60 + Number(endM)
      durationHours = Math.max(endMinutes - startMinutes, 0) / 60
    }
  }

  return { date, durationHours }
}

function getWeekStart(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`)
  const day = date.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diffToMonday)
  return date.toISOString().slice(0, 10)
}

type RowClassification = 'rencontre' | 'absence' | 'deplacement' | 'dossier' | 'inconnu'

function classifyRow(description: string, detail: string): RowClassification {
  const normalizedDescription = description.trim().toLowerCase()
  const normalizedDetail = detail.trim().toLowerCase()

  if (normalizedDescription === 'absence') return 'absence'
  if (normalizedDescription.includes('rencontre')) return 'rencontre'
  if (normalizedDetail.includes('ouverture de dossier')) return 'dossier'
  if (normalizedDetail.includes('déplacement') || normalizedDetail.includes('deplacement')) {
    return 'deplacement'
  }

  return 'inconnu'
}

type MeetingRow = {
  date: string
  weekStart: string
  durationHours: number
  amount: number
}

type ProfessionalBucket = {
  professional: ProfessionalPayrollInfo
  rencontres: MeetingRow[]
  travelFeesTotal: number
  cancellationCount: number
}

/**
 * Calcule la paie de chaque professionnel à partir des lignes brutes du fichier Excel
 * "Activités détaillées" (lues via xlsx avec `header: 1`, donc rawRows est un tableau de
 * lignes, chaque ligne un tableau de cellules dans l'ordre :
 * DATE, PROFESSIONNEL, CLIENT, REQUÉRANT, DESCRIPTION, DÉTAIL, EMPLACEMENT, PAYÉ,
 * MONTANT RÉCLAMÉ, MANDAT).
 */
export function calculatePayroll(
  rawRows: unknown[][],
  professionals: ProfessionalPayrollInfo[]
): PayrollCalculationResult {
  const warnings: PayrollCalculationWarning[] = []

  const headerRowIndex = rawRows.findIndex(
    (row) => typeof row[0] === 'string' && row[0].trim().toUpperCase() === 'DATE'
  )

  if (headerRowIndex === -1) {
    warnings.push({
      type: 'unclassified_row',
      message:
        'Impossible de trouver la ligne d’en-tête (colonne "DATE") dans le fichier - vérifiez qu’il s’agit bien d’un export "Activités détaillées".',
    })
    return { professionalResults: [], warnings }
  }

  const dataRows = rawRows.slice(headerRowIndex + 1)

  const professionalsByName = new Map<string, ProfessionalPayrollInfo>()
  professionals.forEach((professional) => {
    professionalsByName.set(normalizeName(professional.fullName), professional)
  })

  const buckets = new Map<string, ProfessionalBucket>()
  const unmatchedNamesWarned = new Set<string>()

  const getOrCreateBucket = (professional: ProfessionalPayrollInfo): ProfessionalBucket => {
    const existing = buckets.get(professional.id)
    if (existing) return existing

    const created: ProfessionalBucket = {
      professional,
      rencontres: [],
      travelFeesTotal: 0,
      cancellationCount: 0,
    }
    buckets.set(professional.id, created)
    return created
  }

  dataRows.forEach((row, index) => {
    const rowNumber = headerRowIndex + index + 2 // +1 for 0-index, +1 for the header row itself
    const professionalNameRaw = typeof row[1] === 'string' ? row[1].trim() : ''

    if (!professionalNameRaw) return
    if (rowHasNonBillableMention(row)) return

    const professional = professionalsByName.get(normalizeName(professionalNameRaw))

    if (!professional) {
      const key = normalizeName(professionalNameRaw)
      if (!unmatchedNamesWarned.has(key)) {
        unmatchedNamesWarned.add(key)
        warnings.push({
          type: 'unmatched_professional',
          message: `Professionnel "${professionalNameRaw}" du fichier introuvable sur la plateforme (ligne ${rowNumber} et possiblement d’autres) - ignoré du calcul.`,
        })
      }
      return
    }

    if (professional.email && normalizeEmail(professional.email) === NANCY_AL_KAYAL_EMAIL) {
      return
    }

    const description = typeof row[4] === 'string' ? row[4] : ''
    const detail = typeof row[5] === 'string' ? row[5] : ''
    const classification = classifyRow(description, detail)

    if (classification === 'dossier') return

    if (classification === 'rencontre') {
      const parsedDate = parseDateCell(row[0])

      if (!parsedDate) {
        warnings.push({
          type: 'unreadable_date',
          message: `Date illisible pour une rencontre de ${professionalNameRaw} (ligne ${rowNumber}) - ignorée du calcul.`,
        })
        return
      }

      const bucket = getOrCreateBucket(professional)
      bucket.rencontres.push({
        date: parsedDate.date,
        weekStart: getWeekStart(parsedDate.date),
        durationHours: parsedDate.durationHours,
        amount: parseAmount(row[8]),
      })
      return
    }

    if (classification === 'absence') {
      getOrCreateBucket(professional).cancellationCount += 1
      return
    }

    if (classification === 'deplacement') {
      getOrCreateBucket(professional).travelFeesTotal += parseAmount(row[8])
      return
    }

    warnings.push({
      type: 'unclassified_row',
      message: `Ligne non reconnue pour ${professionalNameRaw} (description : "${
        description || '-'
      }", détail : "${detail || '-'}"), ligne ${rowNumber} - ignorée du calcul.`,
    })
  })

  const professionalResults: ProfessionalPayrollResult[] = []

  buckets.forEach((bucket) => {
    const { professional, rencontres, travelFeesTotal, cancellationCount } = bucket

    if (!professional.payrollCategory) {
      warnings.push({
        type: 'missing_category',
        message: `Catégorie de paie non définie pour ${professional.fullName} - ce professionnel a été ignoré du calcul. Définissez sa catégorie ci-dessus puis relancez le calcul.`,
      })
      return
    }

    const rates = PAYROLL_CATEGORY_RATES[professional.payrollCategory]

    const meetingsByWeek = new Map<string, MeetingRow[]>()
    rencontres.forEach((meeting) => {
      const list = meetingsByWeek.get(meeting.weekStart) ?? []
      list.push(meeting)
      meetingsByWeek.set(meeting.weekStart, list)
    })

    const lineItemsMap = new Map<string, InvoiceLineItem>()

    rencontres.forEach((meeting) => {
      const weekCount = meetingsByWeek.get(meeting.weekStart)?.length ?? 0
      const rate = weekCount >= WEEKLY_THRESHOLD ? rates.atOrAboveThreshold : rates.belowThreshold
      const pay = rates.isFlatRate
        ? rate * meeting.durationHours
        : meeting.amount * rate * meeting.durationHours
      const key = rates.isFlatRate ? `flat-${rate}` : `${meeting.amount}|${rate}`
      const existing = lineItemsMap.get(key)

      if (existing) {
        existing.totalHours += meeting.durationHours
        existing.totalPay += pay
        return
      }

      lineItemsMap.set(key, {
        label: rates.isFlatRate
          ? 'Rencontre'
          : `${getServiceTypeLabel(meeting.amount)} - Rencontre (${meeting.amount} $)`,
        amount: meeting.amount,
        rate,
        isFlatRate: rates.isFlatRate,
        totalHours: meeting.durationHours,
        totalPay: pay,
      })
    })

    const lineItems = Array.from(lineItemsMap.values())
    const rateGroups = Array.from(
      lineItems.reduce((groups, item) => {
        const key = item.isFlatRate ? `flat-${item.rate}` : `percent-${item.rate}`
        const existing = groups.get(key)
        const label = item.isFlatRate
          ? `${formatRateAmount(item.rate)} / h`
          : `${Math.round(item.rate * 100)} %`

        if (existing) {
          existing.lineItems.push(item)
          existing.totalPay += item.totalPay
        } else {
          groups.set(key, {
            label,
            rate: item.rate,
            isFlatRate: item.isFlatRate,
            lineItems: [item],
            totalPay: item.totalPay,
          })
        }

        return groups
      }, new Map<string, PayrollRateGroup>())
    )
      .map(([, group]) => group)
      .sort((a, b) => a.rate - b.rate)
    const cancellationFeesTotal = cancellationCount * rates.cancellationFee
    const meetingsPay = lineItems.reduce((sum, item) => sum + item.totalPay, 0)
    const grandTotal = meetingsPay + travelFeesTotal + cancellationFeesTotal

    professionalResults.push({
      professional,
      lineItems,
      rateGroups,
      meetingCount: rencontres.length,
      travelFeesTotal,
      cancellationCount,
      cancellationFeesTotal,
      grandTotal,
    })
  })

  professionalResults.sort((a, b) =>
    a.professional.fullName.localeCompare(b.professional.fullName, 'fr')
  )

  return { professionalResults, warnings }
}
