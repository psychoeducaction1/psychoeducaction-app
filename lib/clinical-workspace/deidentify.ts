import type { ClinicalSources } from '@/lib/clinicalNoteEngine'

export const MAX_CLINICAL_IDENTIFIERS = 60
const MAX_IDENTIFIER_LENGTH = 160
type SourceName = keyof ClinicalSources
export type ClinicalTransformation = { source: SourceName; original: string; replacement: string; reason: string }
export type KnownClinicalPerson = { name?: string; role: 'parent' | 'guardian' | 'other' | 'père' | 'mère' }
type DossierPeople = {
  contacts?: readonly { fullName: string; relationship: string }[]
  representatives?: readonly { fullName: string; relationship: string }[]
  payers?: readonly { fullName: string; payerType: string }[]
}
export type DeidentifiedClinicalSources = {
  sources: ClinicalSources
  replacementCount: number
  transformations: ClinicalTransformation[]
  /** Pattern detection is a safety net, not proof that text is anonymous. */
  residualDirectIdentifiers: boolean
}

const roles: Record<string, [string, string]> = {
  client: ['le client', 'Nom remplacé par le rôle clinique du client.'],
  cliente: ['la cliente', 'Nom remplacé par le rôle clinique de la cliente.'],
  personne: ['la personne concernée', 'Nom de personne proposé par le moteur local; rôle clinique à vérifier.'],
  parent: ['le parent', 'Lien parental conservé sans le nom.'],
  responsable: ['le responsable légal', 'Lien avec le responsable légal conservé sans le nom.'],
  père: ['le père', 'Lien familial conservé sans le nom.'],
  mère: ['la mère', 'Lien familial conservé sans le nom.'],
  conjoint: ['le conjoint', 'Lien familial conservé sans le nom.'],
  conjointe: ['la conjointe', 'Lien familial conservé sans le nom.'],
  enfant: ['l’enfant', 'Lien familial conservé sans le nom.'],
  école: ['l’école fréquentée', 'Établissement scolaire généralisé.'],
  établissement: ['l’établissement concerné', 'Nom d’établissement généralisé.'],
  employeur: ['l’employeur', 'Nom de l’employeur généralisé.'],
  lieu: ['le lieu concerné', 'Lieu identifiant généralisé.'],
}

const directPatterns: readonly [RegExp, string, string][] = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[COURRIEL]', 'Adresse électronique directe.'],
  [/\b(?:https?:\/\/|www\.)[^\s<>]+/giu, '[LIEN]', 'Lien potentiellement identifiant.'],
  [/(?<!\d)(?:\+?1[\s.()-]*)?(?:\(?\d{3}\)?[\s.()-]*)\d{3}[\s.-]*\d{4}(?!\d)/gu, '[TÉLÉPHONE]', 'Numéro de téléphone direct.'],
  [/\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/giu, '[CODE_POSTAL]', 'Code postal direct.'],
  [/\b[A-Z]{4}\d{8}\b/giu, '[NUMÉRO]', 'Numéro de dossier reconnaissable.'],
  [/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b/gu, '[DATE]', 'Date civile exacte; durée et fréquence conservées.'],
  [/\b\d{1,5}\s+(?:rue|avenue|av\.|boulevard|boul\.|chemin|ch\.|route)\s+[\p{L}'’.-]+(?:\s+[\p{L}'’.-]+){0,3}/giu, '[ADRESSE]', 'Adresse postale directe.'],
  [/\b(?:Mme|Mlle|M\.|Monsieur|Madame|Dr\.|Docteur)\s+[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?/gu, '[PERSONNE]', 'Nom de personne avec titre.'],
]

function escapeExpression(value: string) {
  return value.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')
}

type IdentifierRule = { term: string; replacement: string; reason: string }
function identifierRule(value: string, index: number): IdentifierRule | null {
  const parts = value.split('|').map(part => part.trim())
  if (parts.length === 1) return { term: value, replacement: `[IDENTIFIANT_${index + 1}]`, reason: 'Identifiant indiqué par le professionnel.' }
  const role = parts[0].toLocaleLowerCase('fr-CA')
  if (role === 'événement') {
    if (parts.length !== 3 || !parts[2] || parts[2].length > 120 || /[\[\]<>]/.test(parts[2])) return null
    return { term: parts[1], replacement: parts[2], reason: 'Événement distinctif reformulé par le professionnel; signification clinique à confirmer.' }
  }
  if (parts.length !== 2 || !roles[role]) return null
  return { term: parts[1], replacement: roles[role][0], reason: roles[role][1] }
}

export function parseClinicalIdentifiers(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CLINICAL_IDENTIFIERS) return null
  const identifiers: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || /[\r\n<>]/.test(item)) return null
    const entry = item.trim().replace(/\s+/g, ' ')
    if (entry.length < 2 || entry.length > MAX_IDENTIFIER_LENGTH) return null
    const rule = identifierRule(entry, identifiers.length)
    if (!rule || rule.term.length < 2 || rule.term.length > (entry.startsWith('événement|') ? 120 : 80) || /[\[\]<>|]/.test(rule.term)) return null
    if (!identifiers.some(existing => identifierRule(existing, 0)?.term.toLocaleLowerCase('fr-CA') === rule.term.toLocaleLowerCase('fr-CA'))) identifiers.push(entry)
  }
  return identifiers.sort((left, right) => (identifierRule(right, 0)?.term.length ?? 0) - (identifierRule(left, 0)?.term.length ?? 0))
}

/** Names already present in the authorized dossier are removed locally before any drafting request. */
export function knownClinicalIdentifiers(clientName: string, people: readonly KnownClinicalPerson[]): string[] | null {
  const entries: string[] = []
  const genericParts = new Set(['client', 'cliente', 'parent', 'papa', 'maman', 'père', 'mère', 'responsable', 'fictif', 'fictive', 'essai', 'test', 'exemple'])
  const add = (name: string, role: string) => {
    const clean = name.trim().replace(/\s+/g, ' ')
    if (!clean || clean.length > 80 || /[\[\]<>|\r\n]/u.test(clean)) return
    entries.push(`${role}|${clean}`)
    for (const part of clean.split(/\s+/)) if (part.length > 2 && !genericParts.has(part.toLocaleLowerCase('fr-CA'))) entries.push(`${role}|${part}`)
  }
  add(clientName, 'client')
  for (const person of people) add(person.name ?? '', person.role === 'parent' ? 'parent'
    : person.role === 'guardian' ? 'responsable' : person.role === 'père' || person.role === 'mère' ? person.role : 'personne')
  return parseClinicalIdentifiers(entries)
}

/** Use only names already available in this authorized client dossier, never the entire patient directory. */
export function dossierClinicalPeople(client: DossierPeople): KnownClinicalPerson[] {
  const relationshipRole = (relationship: string, fallback: KnownClinicalPerson['role']): KnownClinicalPerson['role'] => {
    if (/\b(père|papa)\b/iu.test(relationship)) return 'père'
    if (/\b(mère|maman)\b/iu.test(relationship)) return 'mère'
    if (/\b(parent)\b/iu.test(relationship)) return 'parent'
    return fallback
  }
  return [
    ...(client.representatives ?? []).map(person => ({ name: person.fullName, role: relationshipRole(person.relationship, 'guardian') })),
    ...(client.contacts ?? []).map(person => ({ name: person.fullName, role: relationshipRole(person.relationship, 'other') })),
    ...(client.payers ?? []).filter(person => person.payerType === 'parent').map(person => ({ name: person.fullName, role: 'parent' as const })),
  ]
}

// Conservative local fallback for names the French NER model misses in conversational speech.
// It is deliberately limited to name-like words in identifying contexts; it is not proof of anonymity.
const contextualNameStopwords = new Set(['alors', 'après', 'aujourd’hui', 'bonjour', 'bon', 'cette', 'comment', 'dans', 'donc', 'elle', 'enfin', 'est-ce', 'il', 'je', 'la', 'le', 'les', 'mais', 'moi', 'non', 'nous', 'ok', 'oui', 'parce', 'puis', 'quand', 'que', 'qui', 'si', 'tu', 'vous',
  'aucun', 'aucune', 'personne', 'personnes', 'notre', 'nos', 'votre', 'vos', 'ce', 'cet', 'ces', 'chaque', 'certains', 'certaines', 'tous', 'tout', 'toute', 'toutes', 'son', 'sa', 'ses', 'un', 'une', 'des'])
const namedPersonContext = /(?:^|[^\p{L}])(?:s’appelle|s'appelle|appelé|appelée|nommé|nommée|prénom|monsieur|madame|mme|m\.|dr\.|docteur|client|cliente|enfant|fils|fille|mère|père|parent|conjoint|conjointe)\s+([\p{Lu}][\p{L}’'-]{2,})(?:\s+([\p{Lu}][\p{L}’'-]{2,}))?/gmu
// Whole verbs only: "a" must not match "amélioration"/"adresse", nor
// "présente" match the heading "Personnes présentes". Keep elisions separate.
const namedPersonSubject = /(?:^|[\s\[\](:,;])([\p{Lu}][\p{L}’'-]{2,})(?=\s+(?:(?:fait|dit|rapporte|explique|raconte|demande|répond|décrit|présente|est|était|a|avait|veut|souhaite|se)(?![\p{L}\p{N}’'-])|s[’']))/gmu

export function contextualClinicalIdentifiers(sources: ClinicalSources): string[] | null {
  const found = new Set<string>()
  for (const source of Object.values(sources)) {
    for (const match of source.matchAll(namedPersonContext)) {
      for (const word of [match[1], match[2]]) {
        if (word && !contextualNameStopwords.has(word.toLocaleLowerCase('fr-CA'))) found.add(`personne|${word}`)
      }
    }
    for (const match of source.matchAll(namedPersonSubject)) {
      const word = match[1]
      if (!contextualNameStopwords.has(word.toLocaleLowerCase('fr-CA'))) found.add(`personne|${word}`)
    }
  }
  return parseClinicalIdentifiers([...found])
}

function scrubText(text: string, identifiers: readonly string[], source: SourceName, changes: ClinicalTransformation[]) {
  let value = text
  const replaceDirect = (patterns: typeof directPatterns) => {
    for (const [expression, replacement, reason] of patterns) {
      value = value.replace(expression, original => {
        changes.push({ source, original, replacement, reason })
        return replacement
      })
    }
  }
  // Mask complete addresses and emails before a name/NER replacement can split
  // them into fragments that the direct-identifier patterns no longer recognize.
  replaceDirect(directPatterns.slice(0, -1))
  identifiers.forEach((entry, index) => {
    const rule = identifierRule(entry, index)
    if (!rule) return
    const expression = new RegExp('(?<![\\p{L}\\p{N}])' + escapeExpression(rule.term) + '(?![\\p{L}\\p{N}])', 'giu')
    value = value.replace(expression, (original, offset: number, input: string) => {
      const before = input.slice(0, offset).trimEnd()
      const replacement = !before || /[.!?]\s*$/u.test(before)
        ? rule.replacement.charAt(0).toLocaleUpperCase('fr-CA') + rule.replacement.slice(1)
        : rule.replacement
      changes.push({ source, original, replacement, reason: rule.reason })
      return replacement
    })
  })
  // Known dossier roles take precedence over the generic titled-person fallback.
  replaceDirect(directPatterns.slice(-1))
  return value
}

export function deidentifyClinicalSources(sources: ClinicalSources, identifiers: readonly string[]): DeidentifiedClinicalSources {
  const changes: ClinicalTransformation[] = []
  const prepared: ClinicalSources = {
    transcript: scrubText(sources.transcript, identifiers, 'transcript', changes),
    history: scrubText(sources.history, identifiers, 'history', changes),
    metadata: scrubText(sources.metadata, identifiers, 'metadata', changes),
  }
  const combined = Object.values(prepared).join('\n')
  return {
    sources: prepared,
    replacementCount: changes.length,
    transformations: changes,
    residualDirectIdentifiers: directPatterns.some(([expression]) => {
      expression.lastIndex = 0
      return expression.test(combined)
    }),
  }
}

/** A manual correction cannot restore any identifier already identified in the original sources. */
export function reviewedClinicalSources(value: unknown, identifiers: readonly string[], original: ClinicalSources): ClinicalSources | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).sort().join(',') !== 'history,metadata,transcript'
    || typeof candidate.transcript !== 'string' || !candidate.transcript.trim() || candidate.transcript.length > original.transcript.length + 4_000
    || typeof candidate.history !== 'string' || candidate.history.length > original.history.length + 2_000
    || typeof candidate.metadata !== 'string' || candidate.metadata.length > original.metadata.length + 1_000) return null
  const sources = candidate as ClinicalSources
  const check = deidentifyClinicalSources(sources, identifiers)
  return check.replacementCount === 0 && !check.residualDirectIdentifiers ? sources : null
}
