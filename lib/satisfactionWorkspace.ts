import { groupEncountersByClient, normalizeClientName, resolveUniqueSatisfactionRecipients, SATISFACTION_MIN_ENCOUNTERS, SATISFACTION_RECENCY_REASONS, satisfactionRecencyReason, type SatisfactionContactRecord, type SatisfactionEncounter } from './satisfaction.ts'

export type SatisfactionAnalysisRow = {
  clientNom: string
  destinataireNom: string
  professionnel: string | null
  nbRencontres: number
  derniereRencontre: string
  eligible: boolean
  reasons: string[]
  contactIssue: 'ambiguous' | 'missing_client' | 'missing_email' | null
}
export type SatisfactionAnalysis = { version: 1; rows: SatisfactionAnalysisRow[] }

export function analyzeSatisfactionImport(encounters: SatisfactionEncounter[], start: string, end: string,
  solicited: ReadonlySet<string>, unsubscribed: ReadonlySet<string>, contacts: SatisfactionContactRecord[], now = new Date()): SatisfactionAnalysis {
  return { version: 1, rows: groupEncountersByClient(encounters, start, end).map(group => {
    const reasons: string[] = []
    if (group.nbRencontres < SATISFACTION_MIN_ENCOUNTERS) reasons.push(`Moins de ${SATISFACTION_MIN_ENCOUNTERS} rencontres sur la période`)
    if (solicited.has(group.clientNomNormalise)) reasons.push('Déjà sollicité')
    if (unsubscribed.has(group.clientNomNormalise)) reasons.push('Désabonné')
    const recencyReason = satisfactionRecencyReason(group.derniereRencontre, now)
    if (recencyReason) reasons.push(recencyReason)
    const matches = contacts.filter(c => normalizeClientName(c.clientName) === group.clientNomNormalise)
    const contactIssue = matches.length > 1 ? 'ambiguous' : matches.length === 0 ? 'missing_client'
      : resolveUniqueSatisfactionRecipients(group.clientNomNormalise, contacts) ? null : 'missing_email'
    return { clientNom: group.clientNom, destinataireNom: group.destinataireNom, professionnel: group.professionnel,
      nbRencontres: group.nbRencontres, derniereRencontre: group.derniereRencontre,
      eligible: reasons.length === 0, reasons, contactIssue }
  }) }
}

export function refreshSatisfactionAnalysisRecency(analysis: SatisfactionAnalysis | null, now = new Date()): SatisfactionAnalysis | null {
  if (!analysis) return null
  return { ...analysis, rows: analysis.rows.map(row => {
    const reasons = row.reasons.filter(reason => !SATISFACTION_RECENCY_REASONS.some(value => value === reason))
    const recencyReason = satisfactionRecencyReason(row.derniereRencontre, now)
    if (recencyReason) reasons.push(recencyReason)
    // Ne pas créer un nouvel éligible virtuel à partir d'une date future qui est
    // devenue passée : aucun dossier d'invitation n'a été créé pour cette ligne.
    if (!row.eligible && reasons.length === 0) reasons.push('Non retenu lors de l’import : réimportez un export à jour')
    return { ...row, eligible: row.eligible && reasons.length === 0, reasons }
  }) }
}

export function getSatisfactionPage<T>(rows: T[], requestedPage: number, pageSize = 25) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.max(1, Math.min(pageCount, Math.trunc(requestedPage) || 1))
  const offset = (page - 1) * pageSize
  return { rows: rows.slice(offset, offset + pageSize), page, pageCount, total: rows.length,
    from: rows.length ? offset + 1 : 0, to: Math.min(offset + pageSize, rows.length) }
}

export function satisfactionContactIssueLabel(issue: SatisfactionAnalysisRow['contactIssue']) {
  return issue === 'ambiguous' ? 'Plusieurs fiches correspondantes : vérification manuelle requise'
    : issue === 'missing_client' ? 'Aucune fiche client correspondante'
      : issue === 'missing_email' ? 'Courriel absent de la fiche' : ''
}

export function matchesSatisfactionSearch(query: string, values: Array<string | null | undefined>) {
  const words = normalizeClientName(query).split(' ').filter(Boolean)
  const text = normalizeClientName(values.filter(Boolean).join(' '))
  return words.every(word => text.includes(word))
}

export function isSatisfactionDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateSatisfactionEncounters(value: unknown): SatisfactionEncounter[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20000) return null
  const result: SatisfactionEncounter[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object' || typeof row.clientNom !== 'string' || !row.clientNom.trim()
      || typeof row.date !== 'string' || !isSatisfactionDate(row.date)
      || (row.requerantNom != null && typeof row.requerantNom !== 'string')
      || (row.professionnel != null && typeof row.professionnel !== 'string')) return null
    result.push({ clientNom: row.clientNom.trim().slice(0, 500), clientNomNormalise: normalizeClientName(row.clientNom),
      requerantNom: row.requerantNom?.trim().slice(0, 500) || null,
      professionnel: row.professionnel?.trim().slice(0, 500) || null, date: row.date })
  }
  return result
}
