# Guide Codex - PsychoEducAction

## Demarrer une session
1. Lire ce guide, puis seulement les sections utiles de `PROJECT_NOTES.md`.
2. Examiner `git status --short --branch`; conserver tout travail existant.
3. Identifier les fichiers, leurs appelants et les regles de `docs/business-rules.md`.
4. Verifier le comportement dans le code; les souvenirs du chat ne font pas autorite.
5. Implementer une modification ciblee, puis verifier les effets indirects.
6. Executer les controles adaptes de `docs/development-checks.md` et lire le diff.
7. Resumer les fichiers touches, resultats, limites et interventions manuelles.

## Developper
- Reutiliser les composants UI, helpers TypeScript et API deja presents.
- Respecter Next.js App Router, TypeScript strict et les conventions locales.
- Garder la compatibilite; eviter duplication, nouvelle dependance et refonte inutile.
- Ne pas supprimer ni modifier une fonctionnalite metier hors du perimetre demande.
- Lire ensemble UI, route API, helper et SQL lorsque leur contrat est concerne.
- Surveiller particulierement assignations, dossiers, reservations, droits et remuneration.
- Mettre a jour la documentation seulement si le comportement ou la procedure change.

## Securite et donnees
- Ne jamais publier de secret, cle privee, jeton ou renseignement client dans un log,
  une reponse, un test ou un document; utiliser des fixtures fictives.
- Les mutations serveur doivent verifier identite et autorisations avant tout acces
  privilegie. Un menu masque ou une verification client ne remplace pas cette protection.
- Respecter les RLS et les restrictions Storage; ne pas les contourner pour corriger un bug.
- Garder les secrets dans l'environnement serveur; seuls les parametres publics utilisent
  le prefixe `NEXT_PUBLIC_`. Ne pas afficher ni versionner `.env.local`.
- Aucune mutation de production, migration distante ou mise en ligne sans autorisation
  explicite. L'autorisation de modifier le depot ne vaut pas autorisation de deployer.
- Ne pas envoyer de vrai courriel ni reserver un vrai rendez-vous pendant les tests
  sans autorisation. Les tests unitaires restent hors ligne.
- Conserver les modifications preexistantes; aucun reset, nettoyage destructif ou retour
  de fichier non autorise. Un repere Git local permet de retrouver le commit de depart.

## Verifier et proportionner
- Pour une demande simple: lectures limitees, correction ciblee et controle pertinent.
- Pour une demande complexe: approfondir dependances, erreurs, transitions et concurrence.
- Ajouter des tests de comportement pour les regles a risque; reutiliser `node:test`.
- `npm run check` = types + lint + tests; `npm run check:full` ajoute le build.
- `npm run test:db` est distinct et exige une base locale isolee; voir la procedure.
- Un controle vert ne prouve pas que l'interface, les RLS ou la production sont correctes.
- Distinguer echecs preexistants, regressions introduites et controles non executes.
- Ne pas relire tout le depot, repeter un audit ou creer des sous-agents sans besoin reel.
- Preferences: GPT-6.1 Sol Moyen au quotidien; Eleve pour les changements sensibles;
  GPT-6 Luna pour le simple; Astra pour les problemes tres complexes.
- Ultra seulement pour un chantier divisible justifiant plusieurs sous-agents.
- Adapter l'effort sans sacrifier la fiabilite; ne pas pretendre changer le modele actif
  ou controler le quota. Ces choix sont des preferences, pas des mesures de performance.
