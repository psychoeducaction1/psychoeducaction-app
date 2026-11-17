import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'

// Editable transcription of the note outlines supplied for the fictional pilot.
// These prompts are not clinical findings; the professional completes or removes them.
const outlines: Record<ClinicalNoteType, string> = {
  evaluation_1: `Évaluation : (Analyse de la demande + Cadre + Début anamnèse)

Personnes présentes :

Objectif de la rencontre :
Clarifier le motif de référence
Définir le mandat d’évaluation
Présenter le cadre professionnel : Lire la convention de consentement et la faire signer.
Amorcer l’anamnèse

Informations rapportées par le client :
Motif de consultation tel que formulé par le client / parents :
Éléments déclencheurs récents :
Historique sommaire de la problématique :
Impacts actuels (émotionnels, comportementaux, relationnels, scolaires/professionnels) :
Attentes face au suivi :

À ce stade, on veut en savoir le plus possible sur le client, la problématique rapportée et l’interaction entre les deux.

Interventions posées et réactions du client :
Présentation du rôle (professionnel et OPPQ) :
Explication du secret professionnel et limites :
Clarification du mandat et des objectifs :
Reformulation clinique du motif :
Observation de la posture du client (collaboration, résistance, détresse, etc.) :

Observations cliniques :
Affect observé :
Cohérence du discours :
Indices de régulation émotionnelle :
Interaction parent-enfant (si applicable) :
Indices de facteurs de risque immédiats :

Hypothèses cliniques préliminaires :
Fonctions possibles des comportements :
Déclencheurs probables :
Maintien possible de la problématique :
Forces déjà identifiées :

À documenter pour l’évaluation :
Outils d’évaluation prévus (si nécessaire) :
Informations à aller chercher (école, CPE, médecin, etc.) :
Devoir d’auto-observation pour enrichir l’évaluation :`,
  evaluation_2: `Évaluation : (Anamnèse approfondie + Analyse fonctionnelle + Sphères adaptatives + Évaluation normative)

1. Personnes présentes :

2. Objectif de la rencontre :
Poursuivre l’anamnèse
Explorer les sphères de vie
Amorcer l’analyse fonctionnelle

3. Informations rapportées par le client :
Domaine | Éléments rapportés / Observations
Historique développemental :
Grossesse / naissance :
Développement moteur / langagier :
Antécédents médicaux :

Sphère familiale :
Composition familiale :
Dynamiques relationnelles :
Style parental :

Sphère scolaire / professionnelle :
Adaptation (intégration, comportements, autonomie) :
Rendement académique / performance professionnelle :
Relations avec pairs / collègues (intégration sociale, conflits, intimidation) :

Sphère sociale :
Gestion des émotions (régulation, impulsivité) :
Présence d’anxiété, tristesse, irritabilité :
Réactions face aux stress / frustrations :

Habitudes de vie :
Sommeil (qualité, régularité, difficultés) :
Utilisation des écrans :
Alimentation :
Activité physique :

Autre :

4. Analyse fonctionnelle préliminaire :
Antécédents observés :
Comportement problématique :
Conséquences :
Fonction possible (évitement, recherche d’attention, régulation, contrôle, etc.) :

5. Facteurs de protection identifiés :

6. Facteurs de vulnérabilité :

8. Évaluation normative (si nécessaire) :
Nom de l’outil + ce qu’il évalue :
Score :
Résultat + lien avec nos observations :

9. À faire pour la prochaine rencontre :`,
  evaluation_3: `Évaluation : (Intégration clinique + Résultats outils + Jugement professionnel)

1. Personnes présentes :

2. Objectif de la rencontre :
Retour sur outils administrés (si évaluation normative) :
Intégration des données :
Validation des hypothèses :

3. Outils utilisés :
Nom de l’outil :
Résumé des résultats :
Interprétation clinique (sans diagnostic) :

4. Synthèse des données recueillies :
Concordance ou divergence entre discours et observation :
Confirmation ou infirmation des hypothèses :

5. Profil adaptatif (PAD) préliminaire :
Capacités d’autorégulation :
Capacités relationnelles :
Capacités cognitives :
Autonomie :
Résilience :

6. Profil expérientiel (PEX) :
Perception de soi :
Croyances dominantes :
Rapport aux autres :
Rapport à l’échec :

7. Jugement clinique :
Compréhension de la problématique :
Fonction adaptative du comportement :
Interaction personne-environnement :
Pronostic si absence d’intervention :

Plan pour prochaine étape :
Rencontre PI :
Devoir à donner au client (non obligatoire) :`,
  plan_intervention: `Plan d’intervention

Personnes présentes :

Objectif de la rencontre :

Plan d’intervention :
Objectif général | Objectifs spécifiques | Moyens | Commentaires
1. | 1.1 / 1.2 | | 
2. | 2.1 / 2.2 | | 
3. | 3.1 | | 

Interventions posées et réactions du client :

Impressions et observations cliniques :

À faire pour la prochaine rencontre :`,
  evolution: `Intervention

Personnes présentes :

Objectif de la rencontre :
Travail en lien avec les objectifs du plan d’intervention :

Informations rapportées par le client :

Interventions posées et réactions du client :

Impressions et observations cliniques :

À faire pour la prochaine rencontre :`,
  observation: `Note d’observation

Milieu de l’observation :
Date et durée :
Personnes présentes :
Contexte :
Description factuelle :
Interactions observées :
Séquences ABC documentées :
Antécédent | Comportement | Conséquence
Capacités adaptatives observées :
Hypothèses du professionnel :
Pistes à explorer :`,
  fermeture: `NOTE DE FERMETURE DE DOSSIER

Personnes présentes :
Date de la rencontre de fermeture :

1. Motif initial de consultation :

2. Résumé du processus d’intervention :
Cibles d’intervention travaillées :
Implication du client :

3. Évolution observée :
Changements dans le fonctionnement :
Objectifs atteints / partiellement atteints / non atteints :

4. État actuel du fonctionnement :
Présence ou non de manifestations résiduelles :

5. Motif de fermeture :
☐ Objectifs atteints
☐ Stabilisation satisfaisante
☐ Interruption à la demande du client
☐ Non-adhésion / abandon
☐ Réorientation vers un autre service
☐ Autre :

6. Recommandations / Orientation :`,
}

export function clinicalNoteScaffold(type: ClinicalNoteType): string { return outlines[type] }

export function clinicalNoteDraftText(type: ClinicalNoteType): string { return outlines[type] }

export const clinicalScaffoldLines = new Set(Object.values(outlines).flatMap(value => value.split('\n').map(line => line.trim()).filter(Boolean)))
