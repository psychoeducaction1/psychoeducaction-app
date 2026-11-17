import { mandateAgeAt } from '../clinical-mandates/defaultPayer.ts'
import type { ClientPerson, ClientProfile } from './clientDetails.ts'

export type BillingShare = { personId: string; name: string; basisPoints: number; expectedVersion?: number }
export function billingParticipants(clientId: string, profile: Pick<ClientProfile, 'firstName' | 'lastName' | 'birthDate'>, people: ClientPerson[], day: string): BillingShare[] {
  const canPay = (mandateAgeAt(profile.birthDate, day) ?? -1) >= 14
  const rows = new Map<string, BillingShare>()
  for (const person of people) {
    if (person.source === 'mandate' || !(person.payerResponsibility || person.source === 'payer')) continue
    const self = person.relationship === 'Lui-même'
    if (self && !canPay) continue
    const personId = self ? clientId : person.id
    rows.set(personId, { personId, name: self ? `${profile.firstName} ${profile.lastName}` : person.fullName,
      basisPoints: person.payerShareBasisPoints ?? 0, ...(!self ? { expectedVersion: person.version } : {}) })
  }
  if (canPay) {
    const nonClientTotal = [...rows.values()].filter(row => row.personId !== clientId).reduce((sum, row) => sum + row.basisPoints, 0)
    rows.set(clientId, { personId: clientId, name: `${profile.firstName} ${profile.lastName}`, basisPoints: Math.max(0, 10000 - nonClientTotal) })
  }
  return [...rows.values()]
}
export function initialBillingShares(clientId: string, rows: BillingShare[], personId?: string, currentShare?: number): { share: number; others: BillingShare[] } {
  const others = rows.filter(row => row.personId !== personId)
  const externalTotal = others.filter(row => row.personId !== clientId).reduce((sum, row) => sum + row.basisPoints, 0)
  const share = currentShare ?? Math.max(0, 10000 - externalTotal)
  return { share, others: rebalanceClientShare(clientId, others, share) }
}
export function rebalanceClientShare(clientId: string, others: BillingShare[], primaryShare: number): BillingShare[] {
  const externalTotal = others.filter(row => row.personId !== clientId).reduce((sum, row) => sum + row.basisPoints, 0)
  return others.map(row => row.personId === clientId ? { ...row, basisPoints: Math.max(0, 10000 - externalTotal - primaryShare) } : row)
}
export function billingAllocations(others: BillingShare[], primaryShare: number) {
  if (!Number.isSafeInteger(primaryShare) || primaryShare < 0 || primaryShare > 10000
    || others.some(row => !Number.isSafeInteger(row.basisPoints) || row.basisPoints < 0 || row.basisPoints > 10000)
    || primaryShare + others.reduce((sum, row) => sum + row.basisPoints, 0) !== 10000) {
    throw new Error('Répartissez exactement 100 % des honoraires entre les payeurs.')
  }
  return others.map(({ personId, basisPoints, expectedVersion }) => ({ personId, basisPoints, ...(expectedVersion !== undefined ? { expectedVersion } : {}) }))
}
