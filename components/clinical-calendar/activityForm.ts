import type { CalendarAcceptedConditions, CalendarAbsenceDecision, CalendarFeePercent, CalendarFinancialOptions, CalendarFinancialOverride } from '@/lib/clinical-calendar/durableTypes'

export type ActivityFinancialDraft = {
  hourlyRate: string; reason: string; shares: Record<string, string>
  acceptConditions: boolean; evidenceId: string; allowHalf: boolean; allowFull: boolean; allowHomeTravel: boolean; conditionsReason: string; attested: boolean
}
const inputAmount = (cents: number) => (cents / 100).toFixed(2)
export function initialActivityFinancialDraft(options: CalendarFinancialOptions | null): ActivityFinancialDraft {
  const rate = options?.hourlyOverrideCents ?? options?.hourlyRateCents
  return { hourlyRate: rate == null ? '' : inputAmount(rate), reason: options?.reason ?? '',
    shares: Object.fromEntries(options?.payers.map(payer => [payer.personId, String(payer.basisPoints / 100)]) ?? []),
    acceptConditions: false, evidenceId: '', allowHalf: false, allowFull: false, allowHomeTravel: false, conditionsReason: '', attested: false }
}
export function shareBasisPoints(value: string): number {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Indiquez des pourcentages avec au plus deux décimales.')
  const [whole, decimal = ''] = normalized.split('.'), result = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  if (!Number.isSafeInteger(result) || result < 1 || result > 10000) throw new Error('Chaque pourcentage doit être strictement positifs et ne pas dépasser 100.')
  return result
}
export function changeActivityShare(shares: Record<string, string>, people: readonly { personId: string }[], personId: string, value: string) {
  const next = { ...shares, [personId]: value }
  if (people.length === 2) {
    try { const entered = shareBasisPoints(value); if (entered > 9999) return next; const complement = 10000 - entered, other = people.find(person => person.personId !== personId); if (other) next[other.personId] = String(complement / 100) } catch { /* Keep an incomplete input editable; submit validates it. */ }
  }
  return next
}
function hourlyCents(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Indiquez un tarif horaire avec au plus deux décimales.')
  const [whole, decimal = ''] = normalized.split('.'), cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 10000000) throw new Error('Le tarif horaire doit être strictement positif. Pour une activité gratuite, décochez Activité facturable.')
  return cents
}
export function activityFinancialOverride(draft: ActivityFinancialDraft, options: CalendarFinancialOptions): CalendarFinancialOverride {
  const reason = draft.reason.trim()
  if (!reason) throw new Error('Justifiez l’exception tarifaire ou la répartition de cette activité.')
  const amount = draft.hourlyRate.trim() ? hourlyCents(draft.hourlyRate) : null
  const payers = options.payers.map(person => ({ personId: person.personId, basisPoints: shareBasisPoints(draft.shares[person.personId] ?? '') }))
  if (payers.length && payers.reduce((total, payer) => total + payer.basisPoints, 0) !== 10000) throw new Error('Les parts des payeurs doivent totaliser exactement 100 %.')
  return { hourlyRateCents: amount === options.hourlyRateCents ? null : amount, reason, payers: payers.length ? payers : null }
}
export function activityAcceptedConditions(draft: ActivityFinancialDraft, options: CalendarFinancialOptions): CalendarAcceptedConditions | undefined {
  if (!draft.acceptConditions) return undefined
  const evidence = options.acceptanceEvidence.find(item => item.signatureId === draft.evidenceId)
  if (!evidence || !draft.attested || !draft.conditionsReason.trim()) throw new Error('Sélectionnez l’accord signé, précisez les conditions et confirmez leur vérification pour cet essai.')
  return { reviewed: true, mandateRevisionId: evidence.mandateRevisionId, documentId: evidence.documentId, documentHash: evidence.documentHash,
    signatureId: evidence.signatureId, allowedFeePercents: [0, ...(draft.allowHalf ? [50 as const] : []), ...(draft.allowFull ? [100 as const] : [])],
    homeTravelPerformedAllowed: draft.allowHomeTravel, reason: draft.conditionsReason.trim() }
}

export function hasActivityFinancialChanges(draft: ActivityFinancialDraft, options: CalendarFinancialOptions): boolean {
  try {
    const effective = draft.hourlyRate.trim() ? hourlyCents(draft.hourlyRate) : options.hourlyRateCents
    return effective !== (options.hourlyOverrideCents ?? options.hourlyRateCents) || draft.reason.trim() !== options.reason.trim() || options.payers.some(payer => shareBasisPoints(draft.shares[payer.personId] ?? '') !== payer.basisPoints)
  } catch { return true }
}

/** Fail closed while the review is incomplete; the server remains authoritative at commit. */
export function effectiveAbsencePercents(current: CalendarAbsenceDecision | undefined, accepted: CalendarAcceptedConditions | undefined,
  options: { billable: boolean; timelyCancellation: boolean; homeTravelPerformed: boolean }): CalendarFeePercent[] {
  if (!options.billable || options.timelyCancellation) return [0]
  const homeAllowed = accepted ? accepted.homeTravelPerformedAllowed : current?.homeTravelPerformedAllowed ?? false
  if (options.homeTravelPerformed && !homeAllowed) return [0]
  const allowed = accepted?.allowedFeePercents ?? current?.allowedFeePercents ?? [0]
  return ([0, 50, 100] as const).filter(percent => percent === 0 || allowed.includes(percent))
}

export function isTimelyActivityCancellation(startAt: string, noticeAt: string): boolean {
  const difference = Date.parse(startAt) - Date.parse(noticeAt)
  return Number.isFinite(difference) && difference >= 86400000
}
