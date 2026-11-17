export type LegacyCandidate = {
  id: string
  kind: 'assignment' | 'case'
  firstName: string
  lastName: string
  birthDate: string | null
  caseId?: string
  caseStatus?: 'open' | 'closed'
  requesterNames?: string[]
}

export type LegacyIdentity = { firstName: string; lastName: string; birthDate: string | null }

export function isBillingStatement(pages: string[]): boolean {
  const header = pages.slice(0, 2).join(' ').replace(/\s+/g, ' ')
  return /relev[ée] des interventions et paiements des honoraires/iu.test(header)
    || (/\bno\.? facture\b/iu.test(header) && /\btotal des paiements re[çc]us\b/iu.test(header))
}

export type LegacyResolution =
  | { kind: 'matched'; candidate: LegacyCandidate }
  | { kind: 'new' }
  | { kind: 'suggested'; candidate: LegacyCandidate }
  | { kind: 'unresolved'; reason: 'no_identity' | 'ambiguous' | 'archived' }

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr-CA').replace(/[^a-z0-9]/g, '')

export function identityFromPdf(filename: string, pages: string[]): LegacyIdentity | null {
  const text = pages.slice(0, 3).join('\n').replace(/[ \t]+/g, ' ')
  const labelled = text.match(/(?:^|\n)\s*(?:nom du client|client|patient|usager|dossier|actes effectu[ée]s dans le dossier)\s*[:：]\s*([\p{L}][\p{L}'’ -]{1,90})(?:\n|$)/iu)
  const header = labelled?.[1]?.trim()
  const stem = filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  const name = header || (/\b(?:interventions?|notes?|dossier|psylog)\b/i.test(stem) ? '' : stem)
  const pieces = name.split(/\s+/).filter(Boolean)
  if (pieces.length < 2 || pieces.length > 6 || pieces.some(part => !/^[\p{L}'’-]+$/u.test(part))) return null
  const birthDate = text.match(/(?:date de naissance|né(?:e)? le)\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/iu)?.[1] ?? null
  return { firstName: pieces[0], lastName: pieces.slice(1).join(' '), birthDate }
}

export function requesterNamesFromPdf(pages: string[]): string[] {
  const text = pages.slice(0, 3).join('\n')
  const names = new Set<string>()
  for (const match of text.matchAll(/(?:^|\n)\s*(?:requ[ée]rant(?:s)?|parent(?:s)?|responsable(?:s)?)\s*[:：]\s*([^\n]{2,180})/giu)) {
    for (const name of match[1].split(/\s*(?:;|\/|\bet\b)\s*/iu)) {
      const parts = name.trim().split(/\s+/)
      if (parts.length >= 2 && parts.length <= 6 && parts.every(part => /^[\p{L}'’-]+$/u.test(part)))
        names.add(name.trim())
    }
  }
  return [...names]
}

export function resolveLegacyIdentity(identity: LegacyIdentity | null,
  candidates: LegacyCandidate[], pdfRequesters: string[] = []): LegacyResolution {
  const matches = identity ? matchLegacyIdentity(identity, candidates) : []
  const active = matches.filter(candidate => candidate.caseStatus !== 'closed')
  if (active.length === 1) return { kind: 'matched', candidate: active[0] }
  if (active.length > 1) return { kind: 'unresolved', reason: 'ambiguous' }
  if (matches.some(candidate => candidate.caseStatus === 'closed'))
    return { kind: 'unresolved', reason: 'archived' }
  const requesterKeys = new Set(pdfRequesters.map(fold).filter(Boolean))
  const suggestions = candidates.filter(candidate => candidate.caseStatus !== 'closed' && (
    (identity && fold(candidate.lastName) === fold(identity.lastName))
    || (requesterKeys.size > 0 && candidate.requesterNames?.some(name => requesterKeys.has(fold(name))))
  ))
  if (suggestions.length === 1) return { kind: 'suggested', candidate: suggestions[0] }
  if (suggestions.length > 1) return { kind: 'unresolved', reason: 'ambiguous' }
  if (!identity) return { kind: 'unresolved', reason: 'no_identity' }
  return { kind: 'new' }
}

export function serviceFromPdf(pages: string[]): string {
  const text = pages.slice(0, 3).join(' ').replace(/\s+/g, ' ')
  const match = text.match(/(?:service(?: demand[ée])?|type de service)\s*[:：]\s*(intervention psycho[ée]ducative|psycho[ée]ducation|psychoth[ée]rapie|[ée]valuation psychologique)\b/iu)
  if (!match) return 'À préciser'
  const normalized = match[1].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return ({ 'intervention psychoeducative': 'Intervention psychoéducative',
    psychoeducation: 'Psychoéducation', psychotherapie: 'Psychothérapie',
    'evaluation psychologique': 'Évaluation psychologique' } as Record<string, string>)[normalized] ?? 'À préciser'
}

export function matchLegacyIdentity(identity: LegacyIdentity | null, candidates: LegacyCandidate[]): LegacyCandidate[] {
  if (!identity) return []
  const first = fold(identity.firstName), last = fold(identity.lastName)
  const matches = candidates.filter(candidate => fold(candidate.firstName) === first && fold(candidate.lastName) === last
    && (!identity.birthDate || !candidate.birthDate || candidate.birthDate === identity.birthDate))
  const caseIds = new Set(matches.filter(item => item.kind === 'case' && item.caseId).map(item => item.caseId))
  return matches.filter(item => item.kind === 'case' || !caseIds.has(item.caseId))
}

export function encounterDatesFromPdf(pages: string[]): string[] {
  const dates = new Set<string>()
  for (const page of pages) {
    for (const match of page.matchAll(/(?:date (?:de la rencontre|d[’']intervention|de l[’']intervention)|rencontre du|intervention du|(?:^|\n)\s*date\s*:)\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/gimu)) {
      const date = match[1]
      const parsed = new Date(`${date}T12:00:00Z`)
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) dates.add(date)
    }
  }
  return [...dates].sort()
}
