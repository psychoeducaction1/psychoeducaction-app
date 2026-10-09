export type MatchingClient = {
  birthDate: string | null
  serviceRequested: string | null
  meetingModalities: string[] | null
  city: string | null
  consultationReason: string | null
}

export type MatchingProfessional = {
  id: string
  name: string
  professionalTitle: string | null
  preferredClientTypes: string[] | null
  preferredModalities: string[] | null
  preferredFollowupTypes: string[] | null
  preferenceNotes: string | null
  remainingPlaces: number
}

export type ProfessionalMatch = {
  professionalId: string
  professionalName: string
  score: number
  remainingPlaces: number
  reasons: string[]
  cautions: string[]
}

export const MINIMUM_SUGGESTION_SCORE = 55

export function isProfessionalSuggested(match: ProfessionalMatch) {
  return match.score >= MINIMUM_SUGGESTION_SCORE
}

const agePreferences = {
  enfant: ['enfant', 'enfants', 'jeunesse'],
  adolescent: ['adolescent', 'adolescents', 'ado', 'ados'],
  adulte: ['adulte', 'adultes'],
} as const

const modalityPreferences = {
  video: ['visioconference', 'telepratique', 'virtuel', 'virtuelle', 'distance', 'en ligne'],
  home: ['domicile'],
  inPerson: ['presentiel', 'en personne', 'bureau'],
  longueuil: ['longueuil'],
  montreal: ['montreal'],
} as const

const servicePreferences: Array<{
  clientTerms: string[]
  professionalTerms: string[]
}> = [
  {
    clientTerms: ['psychoeducation'],
    professionalTerms: ['psychoeduc'],
  },
  {
    clientTerms: ['psychotherapie'],
    professionalTerms: ['psychotherap'],
  },
  {
    clientTerms: ['evaluation psychologique'],
    professionalTerms: ['evaluation', 'psycholog'],
  },
  {
    clientTerms: ['intervention psychosociale'],
    professionalTerms: ['psychosocial', 'intervention', 'suivi individuel'],
  },
]

const ignoredWords = new Set([
  'avec', 'avoir', 'besoin', 'client', 'cliente', 'dans', 'depuis', 'difficulte',
  'difficultes', 'elle', 'entre', 'faire', 'pour', 'prise', 'service', 'suivi',
  'leurs', 'leur', 'plus', 'question', 'rencontre', 'situation', 'souhaite',
  'tout', 'une', 'des', 'les', 'aux', 'est', 'sont', 'qui', 'que', 'sur',
])

function normalize(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function combine(values: Array<string | null | undefined>) {
  return normalize(values.filter(Boolean).join(' '))
}

function includesAny(text: string, terms: readonly string[]) {
  return terms.some((term) => text.includes(normalize(term)))
}

function calculateAge(birthDate: string | null, referenceDate: Date) {
  if (!birthDate) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!year || !month || !day) return null

  let age = referenceDate.getFullYear() - year
  if (
    referenceDate.getMonth() + 1 < month ||
    (referenceDate.getMonth() + 1 === month && referenceDate.getDate() < day)
  ) {
    age -= 1
  }
  return age >= 0 && age <= 120 ? age : null
}

function getAgeGroup(age: number) {
  if (age < 12) return 'enfant' as const
  if (age < 18) return 'adolescent' as const
  return 'adulte' as const
}

function getMeaningfulTokens(value: string) {
  return Array.from(
    new Set(
      normalize(value)
        .split(' ')
        .filter((word) => word.length >= 5 && !ignoredWords.has(word))
    )
  )
}

function modalityMatch(
  clientModalities: string[] | null,
  professionalPreferences: string
) {
  const modalities = clientModalities?.map(normalize).filter(Boolean) ?? []
  if (modalities.length === 0) return { points: 5, reason: '', caution: 'Modalité du client non précisée' }
  if (!professionalPreferences) return { points: 7, reason: '', caution: 'Modalités du professionnel non précisées' }

  for (const modality of modalities) {
    if (modality.includes('visioconference')) {
      if (includesAny(professionalPreferences, modalityPreferences.video)) {
        return { points: 25, reason: 'Visioconférence compatible', caution: '' }
      }
      continue
    }
    if (modality.includes('domicile')) {
      if (includesAny(professionalPreferences, modalityPreferences.home)) {
        return { points: 25, reason: 'Intervention à domicile compatible', caution: '' }
      }
      continue
    }
    if (modality.includes('longueuil')) {
      if (includesAny(professionalPreferences, modalityPreferences.longueuil)) {
        return { points: 25, reason: 'Bureau de Longueuil compatible', caution: '' }
      }
      if (includesAny(professionalPreferences, modalityPreferences.inPerson)) {
        return { points: 17, reason: 'Présentiel souhaité', caution: 'Bureau de Longueuil à confirmer' }
      }
      continue
    }
    if (modality.includes('montreal')) {
      if (includesAny(professionalPreferences, modalityPreferences.montreal)) {
        return { points: 25, reason: 'Bureau de Montréal compatible', caution: '' }
      }
      if (includesAny(professionalPreferences, modalityPreferences.inPerson)) {
        return { points: 17, reason: 'Présentiel souhaité', caution: 'Bureau de Montréal à confirmer' }
      }
    }
  }

  return { points: 0, reason: '', caution: 'Modalité à vérifier' }
}

export function rankProfessionalMatches(
  client: MatchingClient,
  professionals: MatchingProfessional[],
  referenceDate = new Date()
): ProfessionalMatch[] {
  return professionals
    .filter((professional) => professional.remainingPlaces > 0)
    .map((professional) => {
      let score = 25
      const reasons = [`${professional.remainingPlaces} place${professional.remainingPlaces > 1 ? 's' : ''} restante${professional.remainingPlaces > 1 ? 's' : ''}`]
      const cautions: string[] = []

      const clientTypes = combine(professional.preferredClientTypes ?? [])
      const age = calculateAge(client.birthDate, referenceDate)
      if (age === null) {
        score += 5
        cautions.push('Âge du client non précisé')
      } else {
        const ageGroup = getAgeGroup(age)
        const recognizedAgePreference = Object.values(agePreferences).some((terms) =>
          includesAny(clientTypes, terms)
        )
        if (includesAny(clientTypes, agePreferences[ageGroup])) {
          score += 25
          reasons.push(`Clientèle ${ageGroup}${ageGroup === 'adolescent' ? 'e' : ''} compatible`)
        } else if (!recognizedAgePreference) {
          score += 7
          cautions.push('Groupe d’âge non précisé dans les préférences')
        } else {
          cautions.push('Groupe d’âge différent des préférences inscrites')
        }
      }

      const modality = modalityMatch(
        client.meetingModalities,
        combine(professional.preferredModalities ?? [])
      )
      score += modality.points
      if (modality.reason) reasons.push(modality.reason)
      if (modality.caution) cautions.push(modality.caution)

      const service = normalize(client.serviceRequested)
      const professionalServices = combine([
        professional.professionalTitle,
        ...(professional.preferredFollowupTypes ?? []),
      ])
      const serviceRule = servicePreferences.find((rule) =>
        includesAny(service, rule.clientTerms)
      )
      if (serviceRule && includesAny(professionalServices, serviceRule.professionalTerms)) {
        score += 15
        reasons.push('Service ou type de suivi compatible')
      } else if (!professionalServices) {
        score += 5
        cautions.push('Types de suivis non précisés')
      } else {
        cautions.push('Service à confirmer')
      }

      const reasonTokens = getMeaningfulTokens(client.consultationReason ?? '')
      const preferenceTokens = new Set(
        getMeaningfulTokens((professional.preferredFollowupTypes ?? []).join(' '))
      )
      const sharedTokens = reasonTokens.filter((token) => preferenceTokens.has(token))
      if (sharedTokens.length > 0) {
        score += Math.min(10, sharedTokens.length * 5)
        reasons.push(`Motif associé à ${sharedTokens.slice(0, 2).join(', ')}`)
      } else if (!client.consultationReason?.trim()) {
        cautions.push('Motif de consultation non précisé')
      }

      if (client.meetingModalities?.some((value) => normalize(value).includes('domicile')) && client.city) {
        cautions.push(`Secteur ${client.city.trim()} à confirmer`)
      }

      return {
        professionalId: professional.id,
        professionalName: professional.name,
        score: Math.max(0, Math.min(100, score)),
        remainingPlaces: professional.remainingPlaces,
        reasons,
        cautions: Array.from(new Set(cautions)),
      }
    })
    .sort((first, second) =>
      second.score - first.score ||
      second.remainingPlaces - first.remainingPlaces ||
      first.professionalName.localeCompare(second.professionalName, 'fr')
    )
}
