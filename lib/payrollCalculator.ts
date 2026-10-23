import {
  calculateProfessionalCompensation,
  hasCompensationRule,
  isNancyProfessional,
} from '@/lib/professionalCompensation'
import {
  classifyPayrollActivity,
  getActivityQuantity,
  getActivityUnitClientAmount,
  isTelephoneInterview,
  type PayrollActivityClassification,
} from '@/lib/payrollActivity'
import { decimalProduct, decimalSum } from '@/lib/payrollDecimal'

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

export const TRAVEL_FEE_RATE_PER_KM = 0.64

export type PayrollPeriod = { startDate: string; endDate: string }

export function isPayrollDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validatePayrollPeriod(period: PayrollPeriod): void {
  if (!isPayrollDate(period.startDate) || !isPayrollDate(period.endDate) || period.startDate > period.endDate) {
    throw new Error('La période de paie doit contenir deux dates valides, dans le bon ordre.')
  }
}

// Toujours exclue du calcul, peu importe ce qui apparaît sous son nom dans le fichier.
// Elle est identifiée par courriel de compte plutôt que par le texte du nom.
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
  kind?: 'rencontre' | 'entretien_telephonique' | 'rapport_evaluation'
  label: string
  amount: number
  rate: number
  isFlatRate: boolean
  totalHours: number
  totalPay: number
  unit?: 'h' | 'élément'
  sourceRows?: number[]
}

export type PayrollRateGroup = {
  label: string
  rate: number
  isFlatRate: boolean
  lineItems: InvoiceLineItem[]
  totalPay: number
}

export type CancellationLineItem = {
  label: string
  clientAmount: number
  rate: number
  count: number
  totalPay: number
}

export type ProfessionalPayrollResult = {
  invoiceIssues?: string[]
  period?: PayrollPeriod
  requiresWeeklyReview?: boolean
  professional: ProfessionalPayrollInfo
  lineItems: InvoiceLineItem[]
  rateGroups: PayrollRateGroup[]
  meetingCount: number
  travelFeesTotal: number
  travelKilometersTotal: number
  cancellationCount: number
  cancellationLineItems: CancellationLineItem[]
  cancellationFeesTotal: number
  grandTotal: number
}

export type PayrollCalculationWarning = {
  type:
    | 'unmatched_professional'
    | 'missing_category'
    | 'unclassified_row'
    | 'unreadable_date'
    | 'missing_amount'
    | 'partial_week'
    | 'out_of_period'
    | 'invalid_duration'
  message: string
}

export type PayrollCalculationResult = {
  period?: PayrollPeriod
  requiresWeeklyReview?: boolean
  professionalResults: ProfessionalPayrollResult[]
  warnings: PayrollCalculationWarning[]
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
  const dateLine = lines.find((line) => /^\d{4}-\d{2}-\d{2}(?:$|\s)/.test(line))

  if (!dateLine) return null

  const timeLine = lines.find((line) => /^\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/.test(line))
  const date = dateLine.slice(0, 10)
  if (!isPayrollDate(date)) return null
  let durationHours = 0

  if (timeLine) {
    const match = timeLine.match(/^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/)

    if (match) {
      const [, startH, startM, endH, endM] = match
      const startMinutes = Number(startH) * 60 + Number(startM)
      const endMinutes = Number(endH) * 60 + Number(endM)
      if (Number(startH) < 24 && Number(endH) < 24 && Number(startM) < 60 && Number(endM) < 60) {
        durationHours = Math.max(endMinutes - startMinutes, 0) / 60
      }
    }
  }

  return { date, durationHours }
}

function getWeekStart(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`)
  const day = date.getUTCDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  date.setUTCDate(date.getUTCDate() + diffToMonday)
  return date.toISOString().slice(0, 10)
}

function getWeekEnd(dateStr: string): string {
  const date = new Date(`${getWeekStart(dateStr)}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 6)
  return date.toISOString().slice(0, 10)
}

type MeetingRow = {
  sourceRow: number
  date: string
  weekStart: string
  durationHours: number
  amount: number
  classification: Extract<
    PayrollActivityClassification,
    'rencontre' | 'rapport_evaluation'
  >
  description: string
  detail: string
}

type CancellationRow = {
  date: string
  weekStart: string
  amount: number
}

type ProfessionalBucket = {
  professional: ProfessionalPayrollInfo
  rencontres: MeetingRow[]
  travelFeesTotal: number
  cancellations: CancellationRow[]
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
  professionals: ProfessionalPayrollInfo[],
  period?: PayrollPeriod
): PayrollCalculationResult {
  if (period) validatePayrollPeriod(period)
  const warnings: PayrollCalculationWarning[] = []
  const supportStart = period ? getWeekStart(period.startDate) : null
  const supportEnd = period ? getWeekEnd(period.endDate) : null
  const requiresWeeklyReview = Boolean(period && (
    period.startDate !== supportStart || period.endDate !== supportEnd
  ))
  const snapshot = period ? { period: { ...period }, requiresWeeklyReview } : {}
  if (requiresWeeklyReview) {
    warnings.push({
      type: 'partial_week',
      message: `La période coupe une semaine. Le seuil hebdomadaire utilise les rencontres présentes dans l’export du ${supportStart} au ${supportEnd}, mais seules les dates de la période sont payées. Vérifiez que l’export contient les semaines complètes avant d’émettre les factures.`,
    })
  }

  const headerRowIndex = rawRows.findIndex(
    (row) => typeof row[0] === 'string' && row[0].trim().toUpperCase() === 'DATE'
  )

  if (headerRowIndex === -1) {
    warnings.push({
      type: 'unclassified_row',
      message:
        'Impossible de trouver la ligne d’en-tête (colonne "DATE") dans le fichier - vérifiez qu’il s’agit bien d’un export "Activités détaillées".',
    })
    return { professionalResults: [], warnings, ...snapshot }
  }

  const dataRows = rawRows.slice(headerRowIndex + 1)

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
  let outsidePeriodCount = 0

  const getOrCreateBucket = (professional: ProfessionalPayrollInfo): ProfessionalBucket => {
    const existing = buckets.get(professional.id)
    if (existing) return existing

    const created: ProfessionalBucket = {
      professional,
      rencontres: [],
      travelFeesTotal: 0,
      cancellations: [],
    }
    buckets.set(professional.id, created)
    return created
  }

  dataRows.forEach((row, index) => {
    const rowNumber = headerRowIndex + index + 2 // +1 for 0-index, +1 for the header row itself
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
          message: `Professionnel "${professionalNameRaw}" du fichier introuvable sur la plateforme (ligne ${rowNumber} et possiblement d’autres) - ignoré du calcul.`,
        })
      }
      return
    }

    if (isNancyProfessional(professional)) {
      return
    }

    const description = typeof row[4] === 'string' ? row[4] : ''
    const detail = typeof row[5] === 'string' ? row[5] : ''
    const classification = classifyPayrollActivity(description, detail)

    if (classification === 'dossier') return

    const parsedDate = parseDateCell(row[0])
    const outsidePeriod = Boolean(period && parsedDate && (
      parsedDate.date < period.startDate || parsedDate.date > period.endDate
    ))
    if (period && !parsedDate) {
      warnings.push({ type: 'unreadable_date', message: `Date illisible ou impossible pour ${professionalNameRaw} (ligne ${rowNumber}) — activité exclue de la période de paie.` })
      return
    }
    if (outsidePeriod) outsidePeriodCount += 1
    // Les rencontres des jours voisins servent uniquement au seuil de leur semaine.
    // Elles ne peuvent ni augmenter la quantité facturée, ni ajouter des frais.
    if (period && parsedDate && (parsedDate.date < supportStart! || parsedDate.date > supportEnd!)) return

    if (classification === 'rencontre' || classification === 'rapport_evaluation') {
      if (!parsedDate) {
        warnings.push({
          type: 'unreadable_date',
          message: `Date illisible pour une rencontre de ${professionalNameRaw} (ligne ${rowNumber}) - ignorée du calcul.`,
        })
        return
      }

      const bucket = getOrCreateBucket(professional)
      bucket.rencontres.push({
        sourceRow: rowNumber,
        date: parsedDate.date,
        weekStart: getWeekStart(parsedDate.date),
        durationHours: parsedDate.durationHours,
        amount: parseAmount(row[8]),
        classification,
        description,
        detail,
      })
      return
    }

    if (classification === 'absence') {
      if (outsidePeriod) return
      const amount = parseAmount(row[8])

      if (!parsedDate) {
        warnings.push({
          type: 'unreadable_date',
          message: `Date illisible pour une annulation de ${professionalNameRaw} (ligne ${rowNumber}) - ignorée du calcul.`,
        })
        return
      }

      if (amount <= 0) {
        warnings.push({
          type: 'missing_amount',
          message: `Montant réclamé manquant pour une annulation de ${professionalNameRaw} (ligne ${rowNumber}) - ignorée du calcul.`,
        })
        return
      }

      getOrCreateBucket(professional).cancellations.push({
        date: parsedDate.date,
        weekStart: getWeekStart(parsedDate.date),
        amount,
      })
      return
    }

    if (classification === 'deplacement') {
      if (outsidePeriod) return
      const bucket = getOrCreateBucket(professional)
      bucket.travelFeesTotal = decimalSum([bucket.travelFeesTotal, parseAmount(row[8])])
      return
    }

    warnings.push({
      type: 'unclassified_row',
      message: `Ligne non reconnue pour ${professionalNameRaw} (description : "${
        description || '-'
      }", détail : "${detail || '-'}"), ligne ${rowNumber} - ignorée du calcul.`,
    })
  })

  if (outsidePeriodCount > 0) {
    warnings.push({ type: 'out_of_period', message: `${outsidePeriodCount} activité(s) hors de la période sélectionnée ne sont pas payées dans ce calcul.` })
  }

  const professionalResults: ProfessionalPayrollResult[] = []

  buckets.forEach((bucket) => {
    const { professional, travelFeesTotal, cancellations } = bucket
    const rencontres = bucket.rencontres.filter((meeting) => !period || (
      meeting.date >= period.startDate && meeting.date <= period.endDate
    ))
    if (rencontres.length === 0 && cancellations.length === 0 && travelFeesTotal === 0) return

    const hasStandardCompensationRule = hasCompensationRule(professional)

    const hasStandardRows =
      rencontres.some((meeting) => meeting.classification === 'rencontre') ||
      cancellations.length > 0

    if (!hasStandardCompensationRule && hasStandardRows) {
      warnings.push({
        type: 'missing_category',
        message: `Catégorie de paie non définie pour ${professional.fullName} - seules les lignes ayant une règle universelle peuvent être calculées. Définissez sa catégorie ci-dessus puis relancez le calcul.`,
      })
    }

    const meetingsByWeek = new Map<string, MeetingRow[]>()
    bucket.rencontres
      .filter((meeting) => meeting.classification === 'rencontre')
      .forEach((meeting) => {
        const list = meetingsByWeek.get(meeting.weekStart) ?? []
        list.push(meeting)
        meetingsByWeek.set(meeting.weekStart, list)
      })

    const lineItemsMap = new Map<string, InvoiceLineItem>()
    const invoiceIssues: string[] = []

    rencontres.forEach((meeting) => {
      if (
        meeting.classification === 'rencontre' &&
        !hasStandardCompensationRule
      ) {
        return
      }

      const weekCount = meetingsByWeek.get(meeting.weekStart)?.length ?? 0
      const countAsItem = isTelephoneInterview(meeting.description, meeting.detail)
      const quantity = getActivityQuantity(meeting.durationHours, countAsItem)
      const unitClientAmount = getActivityUnitClientAmount(meeting.amount, quantity)
      const calculated = calculateProfessionalCompensation({
        professional,
        lineType: meeting.classification,
        clientAmount: meeting.amount,
        durationHours: meeting.durationHours,
        weeklyMeetingCount: weekCount,
      })
      const rate = calculated.professionalRate
      const pay = calculated.professionalPay
      const missingDuration = meeting.durationHours <= 0 && (!countAsItem || calculated.isFlatRate)
      if (missingDuration) {
        const issue = `Ligne ${meeting.sourceRow} (${meeting.date}) : durée absente, nulle ou invalide. Confirmez l’horaire ou la nature réelle de l’activité (annulation, forfait ou entretien). Aucun ajustement de quantité ou de montant automatique.`
        invoiceIssues.push(issue)
        warnings.push({ type: 'invalid_duration', message: `${professional.fullName} — ${issue}` })
      }
      if (meeting.classification === 'rencontre' && normalizeSearchText(meeting.detail).includes('annulation')) {
        const issue = `Ligne ${meeting.sourceRow} (${meeting.date}) : activité classée « Rencontre » avec une mention d’annulation. Confirmez la nature et le statut de cette activité avant émission; le montant et le seuil hebdomadaire ne sont pas modifiés automatiquement.`
        invoiceIssues.push(issue)
        warnings.push({ type: 'invalid_duration', message: `${professional.fullName} — ${issue}` })
      }
      const kind = meeting.classification === 'rapport_evaluation'
        ? 'rapport_evaluation' : countAsItem ? 'entretien_telephonique' : 'rencontre'
      const label =
        meeting.classification === 'rapport_evaluation'
          ? "Rapport d'évaluation psychoéducative"
          : countAsItem
            ? 'Entretien téléphonique'
            : 'Rencontre'
      const key = `${kind}|${unitClientAmount}|${rate}|${calculated.isFlatRate}|${missingDuration}`
      const existing = lineItemsMap.get(key)

      if (existing) {
        existing.totalHours = decimalSum([existing.totalHours, quantity], 10)
        existing.totalPay = decimalSum([existing.totalPay, pay])
        existing.sourceRows!.push(meeting.sourceRow)
        return
      }

      lineItemsMap.set(key, {
        kind,
        label,
        amount: unitClientAmount,
        rate,
        isFlatRate: calculated.isFlatRate,
        totalHours: quantity,
        totalPay: pay,
        unit: countAsItem ? 'élément' : 'h',
        sourceRows: [meeting.sourceRow],
      })
    })

    const cancellationLineItemsMap = new Map<string, CancellationLineItem>()

    cancellations.forEach((cancellation) => {
      if (!hasStandardCompensationRule) return

      const weekCount = meetingsByWeek.get(cancellation.weekStart)?.length ?? 0
      const calculated = calculateProfessionalCompensation({
        professional,
        lineType: 'annulation',
        clientAmount: cancellation.amount,
        durationHours: 0,
        weeklyMeetingCount: weekCount,
      })
      const key = `${cancellation.amount}|${calculated.professionalRate}`
      const existing = cancellationLineItemsMap.get(key)

      if (existing) {
        existing.count += 1
        existing.totalPay = decimalSum([existing.totalPay, calculated.professionalPay])
        return
      }

      cancellationLineItemsMap.set(key, {
        label: 'Honoraires d’annulation',
        clientAmount: cancellation.amount,
        rate: calculated.professionalRate,
        count: 1,
        totalPay: calculated.professionalPay,
      })
    })

    const lineItems = Array.from(lineItemsMap.values())
    const rateGroups = Array.from(
      lineItems.reduce((groups, item) => {
        const key = item.isFlatRate ? `flat-${item.rate}` : `percent-${item.rate}`
        const existing = groups.get(key)
        const label = 'Honoraires professionnels'

        if (existing) {
          existing.lineItems.push(item)
          existing.totalPay = decimalSum([existing.totalPay, item.totalPay])
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
    const cancellationLineItems = Array.from(cancellationLineItemsMap.values())
    const cancellationFeesTotal = decimalSum(cancellationLineItems.map(item => item.totalPay))
    const meetingsPay = decimalSum(lineItems.map(item => item.totalPay))
    const grandTotal = decimalSum([meetingsPay, travelFeesTotal, cancellationFeesTotal])

    professionalResults.push({
      ...snapshot,
      professional,
      invoiceIssues,
      lineItems,
      rateGroups,
      meetingCount: rencontres.filter(
        (meeting) => meeting.classification === 'rencontre'
      ).length,
      travelFeesTotal,
      travelKilometersTotal: decimalProduct(travelFeesTotal, 1, TRAVEL_FEE_RATE_PER_KM, 2),
      cancellationCount: cancellations.length,
      cancellationLineItems,
      cancellationFeesTotal,
      grandTotal,
    })
  })

  professionalResults.sort((a, b) =>
    a.professional.fullName.localeCompare(b.professional.fullName, 'fr')
  )

  return { professionalResults, warnings, ...snapshot }
}
