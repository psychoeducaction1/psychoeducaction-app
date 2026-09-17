import type { ProfessionalPayrollInfo } from '@/lib/payrollCalculator'
import { normalizeEmail } from '@/lib/superAdmin'

type CategoryRates = {
  belowThreshold: number
  atOrAboveThreshold: number
  isFlatRate: boolean
}

const CATEGORY_RATES = {
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
} satisfies Record<NonNullable<ProfessionalPayrollInfo['payrollCategory']>, CategoryRates>

export const WEEKLY_MEETING_THRESHOLD = 10
const PSYCHOTHERAPIST_CLIENT_RATE = 180
const NANCY_AL_KAYAL_EMAIL = 'nancy.alkayal.pea@outlook.com'
const RIM_NAME_KEY = 'rimelbassit'
const NANCY_NAME_KEY = 'nancyalkayal'
const HICHAM_NAME_KEY = 'hichamboukili'
const THINHINANE_NAME_KEY = 'thinhinaneouldyounes'

export type CompensationLineType =
  | 'rencontre'
  | 'annulation'
  | 'ouverture_dossier'
  | 'deplacement'

export type ProfessionalCompensation = {
  professionalPay: number
  nancyPay: number
  clinicRevenue: number
  professionalRate: number
  isFlatRate: boolean
}

function professionalNameKey(professional: ProfessionalPayrollInfo): string {
  return professional.fullName
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

export function isNancyProfessional(
  professional: ProfessionalPayrollInfo
): boolean {
  return (
    normalizeEmail(professional.email) === NANCY_AL_KAYAL_EMAIL ||
    professionalNameKey(professional) === NANCY_NAME_KEY
  )
}

export function isRimProfessional(
  professional: ProfessionalPayrollInfo
): boolean {
  return professionalNameKey(professional) === RIM_NAME_KEY
}

export function isFullClinicRevenueProfessional(
  professional: ProfessionalPayrollInfo
): boolean {
  const nameKey = professionalNameKey(professional)
  return nameKey === HICHAM_NAME_KEY || nameKey === THINHINANE_NAME_KEY
}

export function hasCompensationRule(
  professional: ProfessionalPayrollInfo
): boolean {
  return Boolean(
    professional.payrollCategory ||
      isNancyProfessional(professional) ||
      isRimProfessional(professional) ||
      isFullClinicRevenueProfessional(professional)
  )
}

export function calculateProfessionalCompensation({
  professional,
  lineType,
  clientAmount,
  durationHours,
  weeklyMeetingCount,
}: {
  professional: ProfessionalPayrollInfo
  lineType: CompensationLineType
  clientAmount: number
  durationHours: number
  weeklyMeetingCount: number
}): ProfessionalCompensation {
  const safeClientAmount = Math.max(clientAmount, 0)

  if (lineType === 'ouverture_dossier') {
    return {
      professionalPay: 0,
      nancyPay: 0,
      clinicRevenue: safeClientAmount,
      professionalRate: 0,
      isFlatRate: false,
    }
  }

  if (lineType === 'deplacement') {
    return {
      professionalPay: safeClientAmount,
      nancyPay: 0,
      clinicRevenue: 0,
      professionalRate: 1,
      isFlatRate: false,
    }
  }

  if (isFullClinicRevenueProfessional(professional)) {
    return {
      professionalPay: 0,
      nancyPay: 0,
      clinicRevenue: safeClientAmount,
      professionalRate: 0,
      isFlatRate: false,
    }
  }

  if (isNancyProfessional(professional)) {
    const professionalRate = 0.8
    const professionalPay = safeClientAmount * professionalRate
    return {
      professionalPay,
      nancyPay: 0,
      clinicRevenue: safeClientAmount - professionalPay,
      professionalRate,
      isFlatRate: false,
    }
  }

  if (isRimProfessional(professional)) {
    const professionalRate = 110 / PSYCHOTHERAPIST_CLIENT_RATE
    const nancyRate = 35 / PSYCHOTHERAPIST_CLIENT_RATE
    const professionalPay =
      lineType === 'annulation'
        ? safeClientAmount * professionalRate
        : 110 * Math.max(durationHours, 0)
    const nancyPay =
      lineType === 'annulation'
        ? safeClientAmount * nancyRate
        : 35 * Math.max(durationHours, 0)

    return {
      professionalPay,
      nancyPay,
      clinicRevenue: Math.max(safeClientAmount - professionalPay - nancyPay, 0),
      professionalRate,
      isFlatRate: lineType !== 'annulation',
    }
  }

  if (!professional.payrollCategory) {
    return {
      professionalPay: 0,
      nancyPay: 0,
      clinicRevenue: 0,
      professionalRate: 0,
      isFlatRate: false,
    }
  }

  const rates = CATEGORY_RATES[professional.payrollCategory]
  const rate =
    weeklyMeetingCount >= WEEKLY_MEETING_THRESHOLD
      ? rates.atOrAboveThreshold
      : rates.belowThreshold

  if (rates.isFlatRate) {
    const professionalRate = rate / PSYCHOTHERAPIST_CLIENT_RATE
    const professionalPay =
      lineType === 'annulation'
        ? safeClientAmount * professionalRate
        : rate * Math.max(durationHours, 0)

    return {
      professionalPay,
      nancyPay: 0,
      clinicRevenue: Math.max(safeClientAmount - professionalPay, 0),
      professionalRate,
      isFlatRate: lineType !== 'annulation',
    }
  }

  const professionalPay = safeClientAmount * rate
  return {
    professionalPay,
    nancyPay: 0,
    clinicRevenue: Math.max(safeClientAmount - professionalPay, 0),
    professionalRate: rate,
    isFlatRate: false,
  }
}
