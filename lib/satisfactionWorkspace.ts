import { groupEncountersByClient, normalizeClientName, resolveUniqueSatisfactionRecipients, SATISFACTION_MIN_ENCOUNTERS, type SatisfactionContactRecord, type SatisfactionEncounter } from './satisfaction.ts'

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
  solicited: ReadonlySet<string>, unsubscribed: ReadonlySet<string>, contacts: SatisfactionContactRecord[]): SatisfactionAnalysis {
  return { version: 1, rows: groupEncountersByClient(encounters, start, end).map(group => {
    const reasons: string[] = []
    if (group.nbRencontres < SATISFACTION_MIN_ENCOUNTERS) reasons.push(`Moins de ${SATISFACTION_MIN_ENCOUNTERS} rencontres sur la période`)
    if (solicited.has(group.clientNomNormalise)) reasons.push('Déjà sollicité')
    if (unsubscribed.has(group.clientNomNormalise)) reasons.push('Désabonné')
    const matches = contacts.filter(c => normalizeClientName(c.clientName) === group.clientNomNormalise)
    const contactIssue = matches.length > 1 ? 'ambiguous' : matches.length === 0 ? 'missing_client'
      : resolveUniqueSatisfactionRecipients(group.clientNomNormalise, contacts) ? null : 'missing_email'
    return { clientNom: group.clientNom, destinataireNom: group.destinataireNom, professionnel: group.professionnel,
      nbRencontres: group.nbRencontres, derniereRencontre: group.derniereRencontre,
      eligible: reasons.length === 0, reasons, contactIssue }
  }) }
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
