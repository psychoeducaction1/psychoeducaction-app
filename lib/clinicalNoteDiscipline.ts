export type ClinicalNoteDiscipline = 'psychoeducation' | 'psychology' | 'psychotherapy' | 'unspecified'

export function clinicalNoteDisciplineFromTitle(title: unknown): ClinicalNoteDiscipline {
  if (typeof title !== 'string') return 'unspecified'
  const normalized = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr')
  if (/psychoeducat/.test(normalized)) return 'psychoeducation'
  if (/psycholog/.test(normalized)) return 'psychology'
  if (/psychotherap/.test(normalized)) return 'psychotherapy'
  return 'unspecified'
}

export function clinicalNoteDisciplineGuidance(discipline: ClinicalNoteDiscipline): string {
  switch (discipline) {
    case 'psychoeducation':
      return 'Titre du professionnel confirmé par sa fiche : psychoéducateur. Pour la note d’évolution, privilégie les objectifs travaillés, les observations directes, les interventions réellement effectuées, les réactions et capacités adaptatives observées ou rapportées, l’évolution par rapport aux objectifs et la suite effectivement discutée. Distingue le récit du parent de l’observation en séance. Ne pose aucun diagnostic et ne crée ni objectif, ni intervention, ni conclusion absents des sources.'
    case 'psychology':
      return 'Titre du professionnel confirmé par sa fiche : psychologue. Résume les thèmes abordés, les interventions réellement effectuées, les réactions et l’évolution documentée. Toute interprétation ou hypothèse doit être explicitement attribuée et provisoire. Ne pose aucun diagnostic absent des sources.'
    case 'psychotherapy':
      return 'Titre du professionnel confirmé par sa fiche : psychothérapeute. Résume les thèmes abordés, les interventions réellement effectuées, les réactions et l’évolution documentée. Ne déduis pas l’ordre professionnel ou le champ de compétence du seul titre; toute interprétation doit être soutenue et attribuée.'
    default:
      return 'Le titre professionnel n’est pas confirmé par la fiche. Rédige une proposition factuelle, sans attribuer de champ d’exercice ni de norme propre à une profession; signale au professionnel qu’il doit vérifier l’adéquation du brouillon à son titre.'
  }
}
