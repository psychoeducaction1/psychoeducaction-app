import type { ClinicalNoteDraft } from '@/lib/clinicalNotesAi'

// Modeles de travail du pilote fictif, a ajuster avec le professionnel.
export const CLINICAL_NOTE_TEMPLATES = [
  {
    id: 'evaluation_1', label: 'Évaluation — rencontre 1',
    description: 'Demande initiale, contexte et premières informations recueillies.',
    instructions: 'Organise une premiere rencontre d’evaluation. Rapporte la demande, le contexte et les informations recueillies. Ne presente pas l’evaluation comme terminee.',
    headings: { objectif: 'Motif et objectif de l’évaluation', informations: 'Contexte et informations recueillies', interventions: 'Démarches d’évaluation réalisées', observations: 'Observations documentées', plan: 'Suite de l’évaluation', aVerifier: 'À vérifier ou à compléter' },
  },
  {
    id: 'evaluation_2', label: 'Évaluation — rencontre 2',
    description: 'Poursuite de la collecte et éléments complémentaires documentés.',
    instructions: 'Organise une rencontre de poursuite d’evaluation. Distingue les informations complementaires, les demarches realisees et les constats explicitement documentes. Aucune note de rencontre 1 n’est fournie: n’en invente pas le contenu et ne deduis aucun changement.',
    headings: { objectif: 'Objectif de la poursuite de l’évaluation', informations: 'Informations complémentaires recueillies', interventions: 'Démarches et outils utilisés', observations: 'Constats documentés et limites', plan: 'Prochaines étapes de l’évaluation', aVerifier: 'À vérifier ou à compléter' },
  },
  {
    id: 'evaluation_3', label: 'Évaluation — rencontre 3',
    description: 'Synthèse et restitution, uniquement selon les éléments présents dans la source.',
    instructions: 'Organise une troisieme rencontre d’evaluation. Presente uniquement les syntheses, conclusions ou restitutions explicitement formulees dans la source. Les rencontres precedentes ne sont pas fournies. Le numero 3 ne signifie pas que l’evaluation est terminee; n’invente aucune conclusion clinique.',
    headings: { objectif: 'Objectif de la rencontre d’évaluation', informations: 'Synthèse des informations disponibles', interventions: 'Démarches et restitution réalisées', observations: 'Synthèse clinique explicitement formulée', plan: 'Orientations et suites convenues', aVerifier: 'À vérifier ou à compléter' },
  },
  {
    id: 'plan_intervention', label: 'Plan d’intervention',
    description: 'Besoins, objectifs convenus, moyens et modalités de suivi.',
    instructions: 'Organise un plan d’intervention a partir des seuls besoins, objectifs et moyens explicitement convenus. Ne propose aucun objectif, indicateur, responsable, frequence, echeance ou intervention supplementaire. Un objectif n’est mesure ou quantifie que si la source le precise.',
    headings: { objectif: 'Objectifs convenus', informations: 'Besoins, priorités et forces rapportés', interventions: 'Moyens, actions et responsabilités convenus', observations: 'Indicateurs de suivi convenus', plan: 'Modalités de suivi et échéances convenues', aVerifier: 'À vérifier ou à compléter' },
  },
  {
    id: 'evolution', label: 'Note d’évolution',
    description: 'Objectif de la rencontre, interventions, observations et suite du suivi.',
    instructions: 'Organise une note d’evolution pour la rencontre. Separe les informations rapportees, les interventions realisees et les observations du professionnel. Ne deduis aucune amelioration ni comparaison avec une seance precedente non fournie.',
    headings: { objectif: 'Objectif de la rencontre', informations: 'Informations rapportées', interventions: 'Interventions réalisées', observations: 'Observations documentées', plan: 'Plan de suivi', aVerifier: 'À vérifier ou à compléter' },
  },
  {
    id: 'fermeture', label: 'Fermeture de dossier',
    description: 'Motif de fermeture, bilan documenté et relais ou suites convenus.',
    instructions: 'Organise une note de fermeture. Le choix de ce modele ne prouve pas qu’une fermeture est decidee: motif, date, bilan, accord du client et relais restent non documentes s’ils sont absents. Ne deduis ni abandon, ni atteinte des objectifs, ni resolution des difficultes. Signale une fermeture non confirmee dans aVerifier.',
    headings: { objectif: 'Motif de fermeture documenté', informations: 'Bilan rapporté du suivi', interventions: 'Démarches de fin de suivi réalisées', observations: 'Évolution et limites documentées', plan: 'Orientations, relais et suites convenus', aVerifier: 'À vérifier avant fermeture' },
  },
] as const satisfies readonly { id: string; label: string; description: string; instructions: string; headings: Record<keyof ClinicalNoteDraft, string> }[]

export type ClinicalNoteType = typeof CLINICAL_NOTE_TEMPLATES[number]['id']
export const DEFAULT_CLINICAL_NOTE_TYPE: ClinicalNoteType = 'evolution'

export function isClinicalNoteType(value: unknown): value is ClinicalNoteType {
  return typeof value === 'string' && CLINICAL_NOTE_TEMPLATES.some(template => template.id === value)
}

// Compatibilite des onglets ouverts avant l'ajout du choix. Valeur fournie invalide refusee.
export function resolveClinicalNoteType(value: unknown): ClinicalNoteType | null {
  return value === undefined ? DEFAULT_CLINICAL_NOTE_TYPE : isClinicalNoteType(value) ? value : null
}

export function getClinicalNoteTemplate(type: ClinicalNoteType) {
  return CLINICAL_NOTE_TEMPLATES.find(template => template.id === type)!
}
