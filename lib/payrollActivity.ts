export type PayrollActivityClassification =
  | 'rencontre'
  | 'rapport_evaluation'
  | 'absence'
  | 'deplacement'
  | 'dossier'
  | 'inconnu'

function normalizeActivityText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function combinedActivityText(description: string, detail: string): string {
  return normalizeActivityText(`${description} ${detail}`)
}

export function isPsychoeducationalEvaluationReport(
  description: string,
  detail: string
): boolean {
  const text = combinedActivityText(description, detail)
  return text.includes('rapport') || text.includes('redaction')
}

export function isTelephoneInterview(description: string, detail: string): boolean {
  return combinedActivityText(description, detail).includes('entretien telephonique')
}

export function classifyPayrollActivity(
  description: string,
  detail: string
): PayrollActivityClassification {
  const normalizedDescription = normalizeActivityText(description)
  const normalizedDetail = normalizeActivityText(detail)

  if (normalizedDescription === 'absence') return 'absence'
  if (isPsychoeducationalEvaluationReport(description, detail)) {
    return 'rapport_evaluation'
  }
  if (
    normalizedDescription.includes('rencontre') ||
    isTelephoneInterview(description, detail)
  ) {
    return 'rencontre'
  }
  if (normalizedDetail.includes('ouverture de dossier')) return 'dossier'
  if (normalizedDetail.includes('deplacement')) return 'deplacement'

  return 'inconnu'
}

export function getActivityQuantity(
  durationHours: number,
  countAsItem: boolean
): number {
  return countAsItem ? 1 : Math.max(durationHours, 0)
}

export function getActivityUnitClientAmount(
  billedAmount: number,
  quantity: number
): number {
  return quantity > 0 ? billedAmount / quantity : billedAmount
}
