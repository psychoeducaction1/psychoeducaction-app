/** A financial default never establishes consent, representation or document rights. */
export function mandateAgeAt(birthDate: string | null | undefined, day: string): number | null {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value + 'T12:00:00Z'))
    && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value
  if (!birthDate || !valid(birthDate) || !valid(day) || birthDate > day) return null
  const [year, month, date] = birthDate.split('-').map(Number)
  const [currentYear, currentMonth, currentDate] = day.split('-').map(Number)
  return currentYear - year - (currentMonth < month || currentMonth === month && currentDate < date ? 1 : 0)
}

export function isMandateParent(relationship: string): boolean {
  return ['pere', 'mere', 'parent'].includes(relationship.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())
}

export type MandatePayerCandidate = {
  id: string; relationship: string; source?: string;
  payerShareBasisPoints?: number | null; payerResponsibility?: string | null;
}
export type MandatePayerShare = { personId: string; basisPoints: number }
export const currentMandateBillingDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Toronto' })

/** Recorded financial shares take precedence over the age-based fallback.
 * A non-paying requester remains a participant; no clinical authority is inferred.
 * An explicit split uses the age when edited, independently of the service's original date.
 * Incomplete/invalid saved allocations are left visible for validation, never normalized. */
export function defaultMandatePayers(clientId: string, birthDate: string | null | undefined, day: string, people: MandatePayerCandidate[], financialDay = day): MandatePayerShare[] {
  const age = mandateAgeAt(birthDate, day)
  const financial = people.filter(person => person.source !== 'mandate' && (person.payerShareBasisPoints ?? 0) > 0)
  const shares = financial.map(person => ({ personId: person.relationship === 'Lui-même' ? clientId : person.id, basisPoints: person.payerShareBasisPoints! }))
  if (shares.length) {
    const total = shares.reduce((sum, share) => sum + share.basisPoints, 0)
    if ((mandateAgeAt(birthDate, financialDay) ?? -1) >= 14 && total < 10000 && !shares.some(share => share.personId === clientId)) shares.push({ personId: clientId, basisPoints: 10000 - total })
    return shares
  }
  // Older administrative projections did not expose shares. Keep their explicit
  // billing identity ahead of an unrelated requester, without guessing a split.
  const legacyPayer = [...people].filter(person => person.source === 'payer' && person.payerShareBasisPoints == null && person.relationship !== 'Lui-même')
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0]
  if (legacyPayer) return [{ personId: legacyPayer.id, basisPoints: 10000 }]
  if (age === null) return []
  if (age >= 14) return [{ personId: clientId, basisPoints: 10000 }]
  const parent = [...people].filter(person => person.source !== 'payer' && person.source !== 'mandate' && person.relationship !== 'Lui-même')
    .sort((a, b) => Number(isMandateParent(b.relationship)) - Number(isMandateParent(a.relationship)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
  return parent ? [{ personId: parent.id, basisPoints: 10000 }] : []
}

/** Compatibility for callers needing a single suggested identity. */
export function defaultMandatePayer(clientId: string, birthDate: string | null | undefined, day: string, people: MandatePayerCandidate[]): string | null {
  return defaultMandatePayers(clientId, birthDate, day, people)[0]?.personId ?? null
}
