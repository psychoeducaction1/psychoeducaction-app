import { normalizeEmail } from '@/lib/superAdmin'
import type {
  PayrollCategory,
  ProfessionalPayrollInfo,
} from '@/lib/payrollCalculator'

type CategoryRates = {
  belowThreshold: number
  atOrAboveThreshold: number
  isFlatRate: boolean
}

const BUDGET_CATEGORY_RATES: Record<PayrollCategory, CategoryRates> = {
  intervenant_psychoeducation: {
    belowThreshold: 0.5,
    atOrAboveThreshold: 0.6,
    isFlatRate: false,
  },
  psychoeducateur_membre_ordre: {
    belowThreshold: 0.6,
    atOrAboveThreshold: 0.7,
    isFlatRate: false,
  },
  psychotherapeute: {
    belowThreshold: 110,
    atOrAboveThreshold: 110,
    isFlatRate: true,
  },
}

const WEEKLY_THRESHOLD = 10
const NANCY_AL_KAYAL_EMAIL = 'nancy.alkayal.pea@outlook.com'
const RIM_NAME_KEY = 'rim el bassit'
const NANCY_NAME_KEY = 'nancy al kayal'
const HICHAM_NAME_KEY = 'hicham boukili'
const THINHINANE_NAME_KEY = 'thinhinane ould younes'

export type BudgetPeriod = {
  startDate: string
  endDate: string
}

export type BudgetLineType =
  | 'rencontre'
  | 'annulation'
  | 'ouverture_dossier'
  | 'deplacement_exclu'

export type BudgetLineItem = {
  professionalId: string
  professionalName: string
  date: string | null
  monthKey: string
  type: BudgetLineType
  description: string
  clientAmount: number
  professionalPay: number
  nancyPay: number
  clinicRevenue: number
}

export type ProfessionalBudgetResult = {
  professional: ProfessionalPayrollInfo
  grossRevenue: number
  professionalPay: number
  nancyPay: number
  clinicRevenue: number
  travelExcluded: number
  dossierRevenue: number
  cancellationRevenue: number
  meetingCount: number
  lineItems: BudgetLineItem[]
}

export type MonthlyBudgetResult = {
  monthKey: string
  grossRevenue: number
  professionalPay: number
  nancyPay: number
  clinicRevenue: number
  travelExcluded: number
  dossierRevenue: number
  cancellationRevenue: number
}

export type BudgetCalculationWarning = {
  type:
    | 'unmatched_professional'
    | 'missing_category'
    | 'unclassified_row'
    | 'unreadable_date'
    | 'missing_amount'
  message: string
}

export type BudgetCalculationResult = {
  professionalResults: ProfessionalBudgetResult[]
  monthlyResults: MonthlyBudgetResult[]
  totals: Omit<MonthlyBudgetResult, 'monthKey'> & {
    meetingCount: number
  }
  warnings: BudgetCalculationWarning[]
}

type RowClassification = 'rencontre' | 'absence' | 'deplacement' | 'dossier' | 'inconnu'

type ParsedActivityRow = {
  rowNumber: number
  professional: ProfessionalPayrollInfo
  professionalNameRaw: string
  date: string | null
  weekStart: string | null
  durationHours: number
  amount: number
  classification: RowClassification
  description: string
  detail: string
}

type ProfessionalBucket = {
  professional: ProfessionalPayrollInfo
  rows: ParsedActivityRow[]
}

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function normalizeSearchText(value: string): string {
  return normalizeName(value).replace(/[-_]+/g, ' ')
}

function normalizeProfessionalName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

function getProfessionalNameTokens(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function namesLikelyReferToSameProfessional(
  fileName: string,
  profileName: string
): boolean {
  const fileTokens = getProfessionalNameTokens(fileName)
  const profileTokens = getProfessionalNameTokens(profileName)

  if (fileTokens.length === 0 || profileTokens.length === 0) return false
  if (fileTokens[0] !== profileTokens[0]) return false

  const fileSurnameTokens = fileTokens.slice(1).filter((token) => token.length >= 3)
  const profileSurnameTokens = profileTokens.slice(1).filter((token) => token.length >= 3)

  if (fileSurnameTokens.length === 0 || profileSurnameTokens.length === 0) {
    return false
  }

  return fileSurnameTokens.every((fileToken) =>
    profileSurnameTokens.some(
      (profileToken) =>
        profileToken === fileToken ||
        profileToken.includes(fileToken) ||
        fileToken.includes(profileToken)
    )
  )
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

  const timeLine = lines.find((line) =>
    /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(line)
  )
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

function classifyRow(description: string, detail: string): RowClassification {
  const normalizedDescription = normalizeSearchText(description)
  const normalizedDetail = normalizeSearchText(detail)

  if (normalizedDescription === 'absence') return 'absence'
  if (normalizedDescription.includes('rencontre')) return 'rencontre'
  if (normalizedDetail.includes('ouverture de dossier')) return 'dossier'
  if (normalizedDetail.includes('deplacement')) return 'deplacement'

  return 'inconnu'
}

function isDateInPeriod(date: string | null, period?: BudgetPeriod): boolean {
  if (!date || !period?.startDate || !period.endDate) return true
  return date >= period.startDate && date <= period.endDate
}

function getMonthKey(date: string | null, period?: BudgetPeriod): string {
  const sourceDate = date ?? period?.startDate ?? new Date().toISOString().slice(0, 10)
  return sourceDate.slice(0, 7)
}

function getProfessionalNameKey(professional: ProfessionalPayrollInfo): string {
  return normalizeProfessionalName(professional.fullName)
}

function isNancy(professional: ProfessionalPayrollInfo): boolean {
  return (
    normalizeEmail(professional.email) === NANCY_AL_KAYAL_EMAIL ||
    getProfessionalNameKey(professional) === NANCY_NAME_KEY
  )
}

function isRim(professional: ProfessionalPayrollInfo): boolean {
  return getProfessionalNameKey(professional) === RIM_NAME_KEY
}

function isFullClinicRevenueProfessional(
  professional: ProfessionalPayrollInfo
): boolean {
  const nameKey = getProfessionalNameKey(professional)
  return nameKey === HICHAM_NAME_KEY || nameKey === THINHINANE_NAME_KEY
}

function getLineDescription(row: ParsedActivityRow): string {
  if (row.classification === 'dossier') return 'Frais d’ouverture de dossier'
  if (row.classification === 'absence') return 'Frais d’annulation'
  if (row.classification === 'deplacement') return 'Frais de déplacement'
  return row.detail || row.description || 'Rencontre'
}

function calculateProfessionalPay({
  row,
  weekCount,
}: {
  row: ParsedActivityRow
  weekCount: number
}): {
  professionalPay: number
  nancyPay: number
  clinicRevenue: number
} {
  const { professional, amount, durationHours, classification } = row

  if (classification === 'dossier') {
    return { professionalPay: 0, nancyPay: 0, clinicRevenue: amount }
  }

  if (classification === 'deplacement') {
    return { professionalPay: amount, nancyPay: 0, clinicRevenue: 0 }
  }

  if (classification === 'absence' && amount <= 0) {
    return { professionalPay: 0, nancyPay: 0, clinicRevenue: 0 }
  }

  const billableAmount =
    classification === 'absence' ? amount : amount * Math.max(durationHours, 0)

  if (isFullClinicRevenueProfessional(professional)) {
    return { professionalPay: 0, nancyPay: 0, clinicRevenue: billableAmount }
  }

  if (isNancy(professional)) {
    const professionalPay = billableAmount * 0.8
    return {
      professionalPay,
      nancyPay: 0,
      clinicRevenue: billableAmount - professionalPay,
    }
  }

  if (isRim(professional)) {
    const professionalPay =
      classification === 'absence' ? billableAmount * (110 / 180) : 110 * durationHours
    const nancyPay =
      classification === 'absence' ? billableAmount * (35 / 180) : 35 * durationHours
    return {
      professionalPay,
      nancyPay,
      clinicRevenue: Math.max(billableAmount - professionalPay - nancyPay, 0),
    }
  }

  if (!professional.payrollCategory) {
    return { professionalPay: 0, nancyPay: 0, clinicRevenue: 0 }
  }

  const rates = BUDGET_CATEGORY_RATES[professional.payrollCategory]
  const rate =
    weekCount >= WEEKLY_THRESHOLD ? rates.atOrAboveThreshold : rates.belowThreshold
  const professionalPay = rates.isFlatRate
    ? rate * Math.max(durationHours, classification === 'absence' ? 1 : 0)
    : billableAmount * rate

  return {
    professionalPay,
    nancyPay: 0,
    clinicRevenue: Math.max(billableAmount - professionalPay, 0),
  }
}

function addToMonthly(
  monthlyMap: Map<string, MonthlyBudgetResult>,
  line: BudgetLineItem
) {
  const current =
    monthlyMap.get(line.monthKey) ??
    ({
      monthKey: line.monthKey,
      grossRevenue: 0,
      professionalPay: 0,
      nancyPay: 0,
      clinicRevenue: 0,
      travelExcluded: 0,
      dossierRevenue: 0,
      cancellationRevenue: 0,
    } satisfies MonthlyBudgetResult)

  if (line.type === 'deplacement_exclu') {
    current.travelExcluded += line.clientAmount
  } else {
    current.grossRevenue += line.clientAmount
    current.professionalPay += line.professionalPay
    current.nancyPay += line.nancyPay
    current.clinicRevenue += line.clinicRevenue
  }

  if (line.type === 'ouverture_dossier') {
    current.dossierRevenue += line.clinicRevenue
  }

  if (line.type === 'annulation') {
    current.cancellationRevenue += line.clinicRevenue
  }

  monthlyMap.set(line.monthKey, current)
}

export function calculateBudget(
  rawRows: unknown[][],
  professionals: ProfessionalPayrollInfo[],
  period?: BudgetPeriod
): BudgetCalculationResult {
  const warnings: BudgetCalculationWarning[] = []
  const headerRowIndex = rawRows.findIndex(
    (row) => typeof row[0] === 'string' && row[0].trim().toUpperCase() === 'DATE'
  )

  if (headerRowIndex === -1) {
    warnings.push({
      type: 'unclassified_row',
      message:
        'Impossible de trouver la ligne d’en-tête (colonne "DATE") dans le fichier.',
    })
    return {
      professionalResults: [],
      monthlyResults: [],
      totals: {
        grossRevenue: 0,
        professionalPay: 0,
        nancyPay: 0,
        clinicRevenue: 0,
        travelExcluded: 0,
        dossierRevenue: 0,
        cancellationRevenue: 0,
        meetingCount: 0,
      },
      warnings,
    }
  }

  const professionalsByName = new Map<string, ProfessionalPayrollInfo>()
  professionals.forEach((professional) => {
    professionalsByName.set(
      normalizeProfessionalName(professional.fullName),
      professional
    )
  })

  const findProfessional = (professionalNameRaw: string) => {
    const exactMatch = professionalsByName.get(
      normalizeProfessionalName(professionalNameRaw)
    )

    if (exactMatch) return exactMatch

    const fuzzyMatches = professionals.filter((professional) =>
      namesLikelyReferToSameProfessional(
        professionalNameRaw,
        professional.fullName
      )
    )

    return fuzzyMatches.length === 1 ? fuzzyMatches[0] : null
  }

  const buckets = new Map<string, ProfessionalBucket>()
  const unmatchedNamesWarned = new Set<string>()

  const getOrCreateBucket = (professional: ProfessionalPayrollInfo) => {
    const existing = buckets.get(professional.id)
    if (existing) return existing

    const created = { professional, rows: [] }
    buckets.set(professional.id, created)
    return created
  }

  rawRows.slice(headerRowIndex + 1).forEach((row, index) => {
    const rowNumber = headerRowIndex + index + 2
    const professionalNameRaw = typeof row[1] === 'string' ? row[1].trim() : ''

    if (!professionalNameRaw) return
    if (rowHasNonBillableMention(row)) return

    const professional = findProfessional(professionalNameRaw)

    if (!professional) {
      const key = normalizeProfessionalName(professionalNameRaw)
      if (!unmatchedNamesWarned.has(key)) {
        unmatchedNamesWarned.add(key)
        warnings.push({
          type: 'unmatched_professional',
          message: `Professionnel "${professionalNameRaw}" introuvable sur la plateforme (ligne ${rowNumber}) - ignoré du budget.`,
        })
      }
      return
    }

    const description = typeof row[4] === 'string' ? row[4] : ''
    const detail = typeof row[5] === 'string' ? row[5] : ''
    const classification = classifyRow(description, detail)
    const parsedDate = parseDateCell(row[0])
    const date = parsedDate?.date ?? null

    if (!isDateInPeriod(date, period)) return

    if (
      (classification === 'rencontre' || classification === 'absence') &&
      !parsedDate
    ) {
      warnings.push({
        type: 'unreadable_date',
        message: `Date illisible pour ${professionalNameRaw} (ligne ${rowNumber}) - ignoré du budget.`,
      })
      return
    }

    if (classification === 'inconnu') {
      warnings.push({
        type: 'unclassified_row',
        message: `Ligne non reconnue pour ${professionalNameRaw} (description : "${
          description || '-'
        }", détail : "${detail || '-'}"), ligne ${rowNumber} - ignorée du budget.`,
      })
      return
    }

    const amount = parseAmount(row[8])

    if (classification !== 'deplacement' && amount <= 0) {
      warnings.push({
        type: 'missing_amount',
        message: `Montant réclamé manquant pour ${professionalNameRaw} (ligne ${rowNumber}) - ignoré du budget.`,
      })
      return
    }

    getOrCreateBucket(professional).rows.push({
      rowNumber,
      professional,
      professionalNameRaw,
      date,
      weekStart: date ? getWeekStart(date) : null,
      durationHours: parsedDate?.durationHours ?? 0,
      amount,
      classification,
      description,
      detail,
    })
  })

  const monthlyMap = new Map<string, MonthlyBudgetResult>()
  const professionalResults: ProfessionalBudgetResult[] = []
  const totals = {
    grossRevenue: 0,
    professionalPay: 0,
    nancyPay: 0,
    clinicRevenue: 0,
    travelExcluded: 0,
    dossierRevenue: 0,
    cancellationRevenue: 0,
    meetingCount: 0,
  }

  buckets.forEach((bucket) => {
    const meetingsByWeek = new Map<string, ParsedActivityRow[]>()

    bucket.rows
      .filter((row) => row.classification === 'rencontre' && row.weekStart)
      .forEach((row) => {
        const key = row.weekStart as string
        const current = meetingsByWeek.get(key) ?? []
        current.push(row)
        meetingsByWeek.set(key, current)
      })

    if (
      !bucket.professional.payrollCategory &&
      !isNancy(bucket.professional) &&
      !isRim(bucket.professional) &&
      !isFullClinicRevenueProfessional(bucket.professional)
    ) {
      warnings.push({
        type: 'missing_category',
        message: `Catégorie de paie non définie pour ${bucket.professional.fullName} - certaines lignes peuvent être ignorées du budget.`,
      })
    }

    const lineItems = bucket.rows.flatMap((row): BudgetLineItem[] => {
      const weekCount = row.weekStart
        ? meetingsByWeek.get(row.weekStart)?.length ?? 0
        : 0

      if (
        !bucket.professional.payrollCategory &&
        !isNancy(bucket.professional) &&
        !isRim(bucket.professional) &&
        !isFullClinicRevenueProfessional(bucket.professional) &&
        row.classification !== 'dossier' &&
        row.classification !== 'deplacement'
      ) {
        return []
      }

      const calculated = calculateProfessionalPay({ row, weekCount })
      const clientAmount =
        row.classification === 'rencontre'
          ? row.amount * Math.max(row.durationHours, 0)
          : row.amount
      const type: BudgetLineType =
        row.classification === 'absence'
          ? 'annulation'
          : row.classification === 'dossier'
            ? 'ouverture_dossier'
            : row.classification === 'deplacement'
              ? 'deplacement_exclu'
              : 'rencontre'

      return [
        {
          professionalId: bucket.professional.id,
          professionalName: bucket.professional.fullName,
          date: row.date,
          monthKey: getMonthKey(row.date, period),
          type,
          description: getLineDescription(row),
          clientAmount,
          professionalPay: calculated.professionalPay,
          nancyPay: calculated.nancyPay,
          clinicRevenue: calculated.clinicRevenue,
        },
      ]
    })

    const result: ProfessionalBudgetResult = {
      professional: bucket.professional,
      grossRevenue: 0,
      professionalPay: 0,
      nancyPay: 0,
      clinicRevenue: 0,
      travelExcluded: 0,
      dossierRevenue: 0,
      cancellationRevenue: 0,
      meetingCount: bucket.rows.filter((row) => row.classification === 'rencontre')
        .length,
      lineItems,
    }

    lineItems.forEach((line) => {
      addToMonthly(monthlyMap, line)

      if (line.type === 'deplacement_exclu') {
        result.travelExcluded += line.clientAmount
        totals.travelExcluded += line.clientAmount
      } else {
        result.grossRevenue += line.clientAmount
        result.professionalPay += line.professionalPay
        result.nancyPay += line.nancyPay
        result.clinicRevenue += line.clinicRevenue
        totals.grossRevenue += line.clientAmount
        totals.professionalPay += line.professionalPay
        totals.nancyPay += line.nancyPay
        totals.clinicRevenue += line.clinicRevenue
      }

      if (line.type === 'ouverture_dossier') {
        result.dossierRevenue += line.clinicRevenue
        totals.dossierRevenue += line.clinicRevenue
      }

      if (line.type === 'annulation') {
        result.cancellationRevenue += line.clinicRevenue
        totals.cancellationRevenue += line.clinicRevenue
      }
    })

    totals.meetingCount += result.meetingCount

    if (
      result.grossRevenue > 0 ||
      result.travelExcluded > 0 ||
      result.lineItems.length > 0
    ) {
      professionalResults.push(result)
    }
  })

  professionalResults.sort((a, b) =>
    a.professional.fullName.localeCompare(b.professional.fullName, 'fr')
  )

  return {
    professionalResults,
    monthlyResults: Array.from(monthlyMap.values()).sort((a, b) =>
      a.monthKey.localeCompare(b.monthKey)
    ),
    totals,
    warnings,
  }
}
