export type ProfessionalAgeRange = {
  min: number
  max: number | null
}

export type ProfessionalStructuredPreferences = {
  pref_languages: string[]
  pref_age_ranges: ProfessionalAgeRange[]
  pref_client_groups: string[]
  pref_service_types: string[]
  pref_office_locations: string[]
  pref_meeting_modes: string[]
  pref_motifs: string[]
  pref_exclusions: string
  pref_matching_notes: string
}

export type ProfessionalStructuredPreferencesRow = {
  pref_languages: string[] | null
  pref_age_ranges: ProfessionalAgeRange[] | null
  pref_client_groups: string[] | null
  pref_service_types: string[] | null
  pref_office_locations: string[] | null
  pref_meeting_modes: string[] | null
  pref_motifs: string[] | null
  pref_exclusions: string | null
  pref_matching_notes: string | null
}

export type PreferenceOption = {
  value: string
  label: string
}

export const languageOptions: PreferenceOption[] = [
  { value: 'Français', label: 'Français' },
  { value: 'Anglais', label: 'Anglais' },
]

export const clientGroupOptions: PreferenceOption[] = [
  { value: 'children', label: 'Enfants' },
  { value: 'adolescents', label: 'Adolescents' },
  { value: 'adults', label: 'Adultes' },
  { value: 'seniors', label: 'Personnes âgées' },
  { value: 'parents', label: 'Parents' },
  { value: 'families', label: 'Familles' },
  { value: 'couples', label: 'Couples' },
  { value: 'siblings', label: 'Fratries' },
]

export const serviceTypeOptions: PreferenceOption[] = [
  { value: 'psychoeducation', label: 'Psychoéducation' },
  { value: 'psychosocial_intervention', label: 'Intervention psychosociale' },
  { value: 'psychotherapy', label: 'Psychothérapie' },
  { value: 'psychological_assessment', label: 'Évaluation psychologique' },
  { value: 'psychoeducational_assessment', label: 'Évaluation psychoéducative' },
]

export const officeLocationOptions: PreferenceOption[] = [
  { value: 'longueuil', label: 'Bureau de Longueuil' },
  { value: 'montreal', label: 'Bureau de Montréal' },
]

export const meetingModeOptions: PreferenceOption[] = [
  { value: 'in_person', label: 'En présentiel' },
  { value: 'video', label: 'Téléconsultation' },
  { value: 'home', label: 'À domicile' },
]

export const motifOptions: PreferenceOption[] = [
  { value: 'anxiety', label: 'Anxiété et stress' },
  { value: 'emotional_regulation', label: 'Gestion des émotions' },
  { value: 'behavior', label: 'Difficultés comportementales' },
  { value: 'opposition', label: 'Opposition et refus' },
  { value: 'self_esteem', label: 'Estime et confiance en soi' },
  { value: 'social_skills', label: 'Habiletés sociales' },
  { value: 'sleep', label: 'Sommeil' },
  { value: 'parenting', label: 'Parentalité' },
  { value: 'family_relationships', label: 'Relations familiales' },
  { value: 'school_adaptation', label: 'Adaptation et motivation scolaires' },
  { value: 'attention', label: 'Difficultés attentionnelles' },
  { value: 'tdah', label: 'TDAH' },
  { value: 'tsa_di', label: 'TSA et déficience intellectuelle' },
  { value: 'depression_mood', label: 'Dépression et troubles de l’humeur' },
  { value: 'trauma', label: 'Trauma et stress post-traumatique' },
  { value: 'dependence', label: 'Dépendance' },
  { value: 'adaptation', label: 'Difficultés d’adaptation' },
  { value: 'life_transitions', label: 'Transitions de vie et deuil' },
  { value: 'relational_difficulties', label: 'Difficultés relationnelles' },
  { value: 'personality', label: 'Troubles de la personnalité' },
  { value: 'screen_use', label: 'Utilisation des écrans' },
  { value: 'migration', label: 'Migration et réalités interculturelles' },
  { value: 'burnout', label: 'Épuisement' },
  { value: 'autonomy', label: 'Autonomie' },
]

export const emptyStructuredPreferences: ProfessionalStructuredPreferences = {
  pref_languages: ['Français'],
  pref_age_ranges: [],
  pref_client_groups: [],
  pref_service_types: [],
  pref_office_locations: [],
  pref_meeting_modes: [],
  pref_motifs: [],
  pref_exclusions: '',
  pref_matching_notes: '',
}

export function normalizeStructuredPreferences(
  row: Partial<ProfessionalStructuredPreferencesRow> | null | undefined
): ProfessionalStructuredPreferences {
  return {
    pref_languages: row?.pref_languages?.length ? row.pref_languages : ['Français'],
    pref_age_ranges: Array.isArray(row?.pref_age_ranges) ? row.pref_age_ranges : [],
    pref_client_groups: row?.pref_client_groups ?? [],
    pref_service_types: row?.pref_service_types ?? [],
    pref_office_locations: row?.pref_office_locations ?? [],
    pref_meeting_modes: row?.pref_meeting_modes ?? [],
    pref_motifs: row?.pref_motifs ?? [],
    pref_exclusions: row?.pref_exclusions ?? '',
    pref_matching_notes: row?.pref_matching_notes ?? '',
  }
}

export function getOptionLabels(
  values: string[] | null | undefined,
  options: PreferenceOption[]
): string[] {
  const labels = new Map(options.map((option) => [option.value, option.label]))
  return (values ?? []).map((value) => labels.get(value) ?? value)
}

export function formatAgeRanges(ranges: ProfessionalAgeRange[] | null | undefined): string {
  if (!ranges?.length) return '-'

  return ranges
    .map((range) =>
      range.max === null
        ? `${range.min} ans et plus`
        : range.min === range.max
          ? `${range.min} ans`
          : `${range.min} à ${range.max} ans`
    )
    .join(', ')
}
