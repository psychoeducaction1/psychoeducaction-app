# Transmission au chat principal — améliorations de l'interface

## Origine et périmètre

- Copie indépendante : `C:\Users\thinh\Documents\assignations-app\output\ui-notifications-isolated-20261116`.
- Branche : `codex/ui-notifications-20261116`.
- Commit de référence : `c2e913be6c1f7a250bc8bd620faf7ccb1cd7d233`.
- Base fournie et validée par le chat principal :
  `C:\Users\thinh\Documents\assignations-app\output\unification-pilot\output\production-wording-release-20261116`.
- Déploiement de référence communiqué : `dpl_4A4FAUhtkyGDyE5SVU3G4tw9qors`.
- Les 559 empreintes du manifeste `PRODUCTION_WORDING_RELEASE.json` correspondaient
  avant copie. 556 fichiers copiés ; `.vercel/project.json`, `.vercelignore` et
  `vercel.json` exclus. Aucun `.env`, secret ou artefact de compilation importé.
- Le champ `baseDeployment` du manifeste décrit son propre ancêtre et ne remplace
  pas le déploiement de référence ci-dessus. Voir `BASE_REFERENCE.json`.

La copie partagée et la référence n'ont pas été modifiées. Aucun éditeur de notes,
affichage de signature, configuration de production ou dépendance n'a été modifié.
Aucune publication, migration distante, donnée réelle, réservation ou courriel.

## Commits à intégrer dans cet ordre

1. `6da5a254a7592fecaea161c5f32e687e51903fc8` — cases à cocher pour les bureaux.
2. `85794ac000d539be6048f282adda59c10d5d441e` — exclusions à cocher et commentaire.
3. `3bba08f2768707221e2802fb0e2581f6b35fe006` — séparation assignations / clients.
4. `93e0d9789bf49171cfa0ddd5a7985c3a6822f3c1` — simplification des détails.
5. `27a3c25850f24c9328c4f1bbfe5f0a33b4ec50d4` — garde-fou après une rencontre.
6. Le commit de cette synthèse, indiqué dans le manifeste du paquet.

Ne pas intégrer le commit initial de snapshot : il sert uniquement de référence.
Le paquet contient un patch cumulatif et les patches individuels numérotés. Choisir
une seule méthode d'import, pas les deux. L'archive de code publiée n'avait pas
d'historique Git ; les patches évitent d'importer le snapshot entier dans main.
Pour préserver les fins de ligne de cette base lors d'un import Git am, utiliser
`git -c am.keepcr=true am --3way <chemin-du-patch-cumulatif>` dans une copie
d'intégration isolée contenant les dernières évolutions du chat principal.
Ne pas écraser les fichiers complets si des conflits apparaissent.

## Changements applicatifs et rôle des fichiers

| Domaine | Fichiers | Comportement |
| --- | --- | --- |
| Calendrier des bureaux | `components/clinical-calendar/CalendarWorkspace.tsx` | Raccorde le sélecteur existant, choix multiple ou vide, bouton Tous, conservation en URL. |
| Préférences | `components/ProfessionalPreferencesEditor.tsx`, `lib/professionalExclusions.ts` | Même liste de motifs à cocher pour les exclusions ; commentaire d'exclusions et Notes et précisions restent séparés. Les textes historiques restent conservés. |
| Clients et assignations | `components/clinical-admission/ProfessionalClientsPanel.tsx`, `ProfessionalPanel.tsx`, `lib/clinical-admission/professionalClients.ts` | Deux vues professionnelles : à contacter/en attente, puis suivis actifs/archives. Séparation avant regroupement pour conserver un suivi et une nouvelle assignation du même client. Administration conservée. |
| Détails | Les deux panneaux ci-dessus | Bouton Détails, fiche professionnelle directement visible sans repli Prise en charge, résultat du contact dessous. Historique des événements affiché uniquement côté administration ; aucune trace supprimée. |
| Service non pris | `ProfessionalPanel.tsx`, `lib/clinical-admission/outcomeErrors.ts`, `lib/clinical-unification/http.ts`, SQL ci-dessous | Refus métier 409 après rencontre et bouton ouvrant la fiche pour accéder à Statut du dossier. Contrôle SQL pour tous les chemins d'écriture du statut. |

Les tests, leur lanceur hors ligne et les notices détaillées se trouvent dans le
diff et dans ce dossier. Aucun nouveau composant parallèle, package ou champ API.

## Interventions restant au chat principal

### Bureaux et attributions — uniquement préparés

Voir `OFFICES_REQUEST.json` et `OFFICES.md`. Aucune création ni attribution réelle
n'a été faite. Réutiliser les UUID des bureaux existants, identifier les numéros
manquants et ne créer aucun doublon. Titres simples et numéros explicites :

- Longueuil : bureaux 101, 102, 103, 104, au 401, chemin du Coteau-Rouge, J4J 1X5.
- Montréal : bureaux 233 et 250, au 1600, boulevard Henri-Bourassa Ouest, H3M 3E3.
- Hicham : les six bureaux. Ève : les quatre de Longueuil seulement.

Adresses vérifiées sur https://psychoeducaction.com/. Vérifier les comptes exacts,
UUID, attributions antérieures et dates avec les parcours authentifiés existants.
Ne pas attribuer par un prénom ambigu ni importer les fixtures de test.

### Protection serveur — migration préparée, NON APPLIQUÉE

`supabase/clinical/assignment-non-service-encounter-guard.sql` doit être relu et
appliqué avec autorisation distincte. Le code d'interface seul n'active pas le
blocage. Voir `ASSIGNMENT_ENCOUNTER_GUARD.md` pour prérequis et verrouillage.

- Aucune rencontre : Service non pris permis avec motif ; libère la place existante
  via le calcul déjà présent, sans créer une demande ni réactiver une demande inactive.
- Rencontre effectuée, ou planifiée dont la fin est passée : changement refusé,
  renvoi à la fermeture du dossier. Les absences/annulations ne comptent pas.
- Ancien service pris sans lien clinique vérifiable : refus demandant une
  vérification par la direction, sans supposer qu'il n'y a eu aucune rencontre.
- Rendez-vous futurs, dossiers, accès et documents restent conservés. Aucun
  rendez-vous n'est annulé et aucun dossier clinique n'est fermé par ce changement.
  Une fiche clinique encore ouverte peut donc rester visible parmi les suivis.
- Fermer un dossier après des rencontres ne libère pas de place dans la demande
  d'origine : le service pris reste une demande satisfaite. Règle confirmée par
  l'utilisateur ; aucune modification de ce mécanisme dans ce lot.

## Résultats et limites

La suite cumulée ciblée a été exécutée : **19 tests réussis, 0 échec**.

```powershell
node --import ./tests/register-office-visibility.mjs --test --experimental-strip-types tests/officeCalendarVisibility.test.ts tests/professionalExclusionChoices.test.ts tests/professionalClientViews.test.ts tests/professionalClientDetails.test.ts tests/assignmentEncounterGuard.test.mjs
```

TypeScript global sans émission réussi sur le dernier code applicatif, ESLint
ciblé réussi sur les fichiers touchés, contrôle du diff réussi. Node émet un
avertissement sur le type de module des tests TypeScript, sans échec. Les outils
déjà installés dans `node_modules` parent ont été utilisés en lecture seule.
Le lanceur livré bloque les appels réseau des tests.

Pas de build complet, navigateur, connexion réelle, test RLS distant, concurrence
de deux connexions ou migration de production. Les tests SQL utilisent PGlite et
un schéma fictif minimal ; ils ne remplacent pas la recette du schéma réellement
installé. La réunion et la publication restent entièrement au chat principal.

Conflits possibles : les deux panneaux d'admission, le calendrier, l'éditeur
partagé des préférences et le gestionnaire HTTP. Conserver les évolutions récentes
du chat principal, particulièrement celles de l'éditeur de notes et des signatures.
Les anciens liens de détail doivent viser la vue contenant la démarche ; voir la
limite décrite dans `PROFESSIONAL_CLIENT_VIEWS.md`.
