import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'

export type ClinicalSectionConfig = { id: string; title: string; guidance: string; columns?: readonly string[] }
const section = (id: string, title: string, guidance = ''): ClinicalSectionConfig => ({ id, title, guidance })
const persons = section('personnes', 'Personnes présentes', 'Présence effectivement documentée. Ne pas confondre personne mentionnée et présente.')
const objective = section('objectif', 'Objectif de la rencontre')
const reports = section('informations', 'Informations rapportées', 'Attribuer les propos au client, parent ou tiers. Ne pas transformer leurs qualificatifs en diagnostic.')
const actions = section('interventions', 'Interventions posées et réactions', 'Relier le problème abordé, l’action réellement posée, son objectif si explicite et la réaction si connue. Une question simple reste une question, sans technique spécialisée inventée.')
const observations = section('observations', 'Impressions et observations', 'Distinguer observation directe documentée, impression du professionnel et propos rapportés.')
const next = section('suite', 'Suite convenue', 'Uniquement les décisions effectivement convenues; aucune proposition IA présentée comme un engagement.')

// Configuration éditable dans le dépôt; aucune consigne fournie par le navigateur n'est exécutée.
export const CLINICAL_NOTE_BLUEPRINTS: Record<ClinicalNoteType, readonly ClinicalSectionConfig[]> = {
  evaluation_1: [persons, objective, reports, actions, observations,
    section('hypotheses', 'Hypothèses préliminaires', 'Seulement les hypothèses explicitement formulées par le professionnel, attribuées et provisoires.'),
    section('a_documenter', 'Éléments à documenter', 'Seulement ce que le professionnel prévoit explicitement explorer. Les lacunes repérées par l’IA vont dans les alertes séparées.')],
  evaluation_2: [persons, objective,
    ...[['developpement', 'Développement'], ['famille', 'Vie familiale'], ['ecole_travail', 'École et travail'], ['social_affectif', 'Vie sociale et affective'], ['habitudes', 'Habitudes de vie'], ['autres', 'Autres informations pertinentes']].map(([id, title]) => section(id, title)),
    section('fonctionnelle', 'Analyse fonctionnelle préliminaire', 'Reprendre uniquement l’analyse formulée, sans causalité déduite.'),
    section('protection', 'Facteurs de protection documentés'), section('vulnerabilite', 'Facteurs de vulnérabilité documentés'),
    section('normative', 'Évaluation normative', 'Nom exact de l’instrument, score et interprétation seulement s’ils sont fournis et valides; ne calculer aucun score ni norme.'), next],
  evaluation_3: [persons, objective,
    section('outils', 'Outils, résultats et limites', 'Aucun instrument, score, norme ni interprétation inventés.'),
    section('synthese', 'Synthèse des informations', 'Convergences et divergences des seules sources disponibles. Distinguer le contexte antérieur de la rencontre actuelle.'),
    section('pad', 'Potentiel adaptatif (PAD)', 'Éléments explicitement documentés; aucune inférence normative.'),
    section('pex', 'Potentiel expérientiel (PEX)', 'Éléments du milieu explicitement documentés.'),
    section('jugement', 'Jugement clinique proposé — à valider', 'Reformuler seulement le jugement explicitement formulé par le professionnel, comme provisoire à valider, sans diagnostic ajouté.'), next],
  plan_intervention: [persons, objective,
    { id: 'plan', title: 'Plan d’intervention convenu', guidance: 'Objectifs et moyens explicitement convenus uniquement. Ne pas inventer indicateur chiffré, délai, fréquence, responsable ou cible. Une proposition non convenue reste dans les alertes.', columns: ['Objectif général', 'Objectifs spécifiques', 'Moyens', 'Commentaires'] },
    actions, observations, next],
  evolution: [persons, objective, reports, actions, observations, next],
  observation: [section('milieu', 'Milieu de l’observation'), section('date_duree', 'Date et durée', 'Seulement les informations explicitement confirmées; jamais la date système.'), persons,
    section('contexte', 'Contexte'), section('description', 'Description factuelle', 'Décrire les comportements observables, sans interprétation ajoutée.'),
    section('interactions', 'Interactions observées'),
    { id: 'abc', title: 'Séquences ABC documentées', guidance: 'Chaque ligne exige antécédent, comportement et conséquence explicitement reliés dans la source. Sinon laisser vide.', columns: ['Antécédent', 'Comportement', 'Conséquence'] },
    section('capacites', 'Capacités adaptatives observées'), section('hypotheses', 'Hypothèses du professionnel', 'Provisoires et explicitement formulées; ne pas les confondre avec les faits.'),
    section('pistes', 'Pistes à explorer', 'Uniquement les pistes formulées par le professionnel. Toute suggestion IA reste dans les alertes.')],
  fermeture: [section('rencontre', 'Rencontre de fermeture', 'Personnes et date uniquement si une rencontre a réellement eu lieu.'),
    section('demande', 'Demande initiale'), section('demarche', 'Résumé de la démarche'),
    section('objectifs', 'Évolution des objectifs', 'Bilan documenté uniquement; fermeture ne signifie pas objectifs atteints.'),
    section('fonctionnement', 'Fonctionnement actuel'), section('motif', 'Motif de fermeture', 'Le choix du modèle ne prouve ni fermeture, ni abandon, ni accord du client.'),
    section('recommandations', 'Recommandations et références', 'Seulement les recommandations et références réellement formulées.')],
}
