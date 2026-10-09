import type { ProfessionalAgeRange } from '@/lib/professionalPreferences'

export type MatchingClient = {
  birth_date: string | null
  service_requested: string | null
  meeting_modality: string[] | null
  consultation_reason: string | null
  internal_notes: string | null
}

export type MatchingProfessional = {
  id: string
  full_name: string | null
  pref_age_ranges: ProfessionalAgeRange[] | null
  pref_service_types: string[] | null
  pref_office_locations: string[] | null
  pref_meeting_modes: string[] | null
  pref_motifs: string[] | null
}

export type ProfessionalMatch = {
  professional: MatchingProfessional
  score: number
  isSuggested: boolean
  reasons: string[]
}

const serviceValues: Record<string, string> = {
  'intervention psychosociale': 'psychosocial_intervention',
  psychoeducation: 'psychoeducation',
  psychotherapie: 'psychotherapy',
  'evaluation psychologique': 'psychological_assessment',
  'evaluation psychoeducative': 'psychoeducational_assessment',
}

const motifKeywords: Record<string, string[]> = {
  anxiety: ['anxiete', 'angoisse', 'stress'],
  emotional_regulation: ['emotion', 'colere', 'regulation emotionnelle'],
  behavior: ['comportement', 'crise', 'agressivite'],
  opposition: ['opposition', 'refus', 'defiance'],
  self_esteem: ['estime de soi', 'confiance en soi'],
  social_skills: ['habilete sociale', 'habiletes sociales', 'socialisation'],
  sleep: ['sommeil', 'dormir', 'insomnie'],
  parenting: ['parental', 'parentalite', 'encadrement', 'coaching parental'],
  family_relationships: ['famille', 'familial', 'fratrie'],
  school_adaptation: ['ecole', 'scolaire', 'motivation scolaire'],
  attention: ['attention', 'concentration'],
  tdah: ['tdah', 'hyperactivite'],
  tsa_di: ['tsa', 'autisme', 'deficience intellectuelle'],
  depression_mood: ['depression', 'humeur', 'tristesse'],
  trauma: ['trauma', 'traumatique', 'ptsd'],
  dependence: ['dependance', 'toxicomanie', 'consommation'],
  adaptation: ['adaptation', 'difficulte a s adapter'],
  life_transitions: ['deuil', 'separation', 'transition', 'changement de vie'],
  relational_difficulties: ['relation', 'conflit', 'couple'],
  personality: ['personnalite', 'tpl'],
  screen_use: ['ecran', 'jeu video', 'jeux video'],
  migration: ['immigration', 'migration', 'interculturel'],
  burnout: ['epuisement', 'burnout', 'burn out'],
  autonomy: ['autonomie'],
}

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function calculateAge(birthDate: string | null, now = new Date()): number | null {
  if (!birthDate) return null
  const [year, month, day] = birthDate.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null

  let age = now.getFullYear() - year
  if (
    now.getMonth() < month - 1 ||
    (now.getMonth() === month - 1 && now.getDate() < day)
  ) {
    age -= 1
  }
  return age >= 0 ? age : null
}

function getClientService(service: string | null): string | null {
  return serviceValues[normalize(service)] ?? null
}

function getClientMotifs(client: MatchingClient): string[] {
  const text = normalize(`${client.consultation_reason ?? ''} ${client.internal_notes ?? ''}`)
  return Object.entries(motifKeywords)
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(normalize(keyword))))
    .map(([motif]) => motif)
}

function ageMatches(age: number, ranges: ProfessionalAgeRange[]): boolean {
  return ranges.some((range) => {
    const minimum = Math.max(0, range.min - 2)
    const maximum = range.max === null ? Number.POSITIVE_INFINITY : range.max + 2
    return age >= minimum && age <= maximum
  })
}

function getModalityRequirements(modalities: string[] | null): Array<{
  mode: string
  office?: string
  label: string
}> {
  return (modalities ?? []).map((modality) => {
    const normalized = normalize(modality)
    if (normalized.includes('visioconference')) {
      return { mode: 'video', label: 'téléconsultation' }
    }
    if (normalized.includes('domicile')) {
      return { mode: 'home', label: 'à domicile' }
    }
    if (normalized.includes('montreal')) {
      return { mode: 'in_person', office: 'montreal', label: 'bureau de Montréal' }
    }
    return { mode: 'in_person', office: 'longueuil', label: 'bureau de Longueuil' }
  })
}

export function evaluateProfessionalMatch(
  client: MatchingClient,
  professional: MatchingProfessional,
  now = new Date()
): ProfessionalMatch {
  let score = 0
  const reasons: string[] = []
  let hardMismatch = false

  const service = getClientService(client.service_requested)
  if (!service) {
    score += 30
  } else if (professional.pref_service_types?.includes(service)) {
    score += 30
    reasons.push('service compatible')
  } else {
    hardMismatch = true
  }

  const age = calculateAge(client.birth_date, now)
  if (age === null) {
    score += 20
    reasons.push('âge à confirmer')
  } else if (ageMatches(age, professional.pref_age_ranges ?? [])) {
    score += 20
    reasons.push('groupe d’âge compatible')
  } else {
    hardMismatch = true
  }

  const requirements = getModalityRequirements(client.meeting_modality)
  if (requirements.length === 0) {
    score += 25
    reasons.push('modalité à confirmer')
  } else {
    const modes = professional.pref_meeting_modes ?? []
    const offices = professional.pref_office_locations ?? []
    const matchingRequirement = requirements.find(
      (requirement) =>
        modes.includes(requirement.mode) &&
        (!requirement.office || offices.includes(requirement.office))
    )
    if (matchingRequirement) {
      score += 25
      reasons.push(matchingRequirement.label)
    } else {
      hardMismatch = true
    }
  }

  const clientMotifs = getClientMotifs(client)
  const matchingMotifs = clientMotifs.filter((motif) =>
    professional.pref_motifs?.includes(motif)
  )
  if (clientMotifs.length > 0 && matchingMotifs.length > 0) {
    score += 25
    reasons.push('motif compatible')
  }

  return {
    professional,
    score,
    isSuggested: !hardMismatch && score >= 80,
    reasons,
  }
}

export function getSuggestedProfessionals<T extends MatchingProfessional>(
  client: MatchingClient,
  professionals: T[],
  now = new Date()
): Array<ProfessionalMatch & { professional: T }> {
  return professionals
    .map((professional) => evaluateProfessionalMatch(client, professional, now) as ProfessionalMatch & { professional: T })
    .filter((match) => match.isSuggested)
    .sort((first, second) =>
      second.score - first.score ||
      (first.professional.full_name ?? '').localeCompare(
        second.professional.full_name ?? '',
        'fr'
      )
    )
}
