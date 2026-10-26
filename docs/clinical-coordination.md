# Espace privé de coordination clinique

Préparé en développement le 25 octobre 2026 à partir de l'espace de Camille
conservé dans Git avant son retrait (`dd37fbf^`). Le marketing retiré n'est pas
réactivé. Migration et accès d'Ève activés en production le 25 octobre après
autorisation explicite. Aucun nouveau compte ni notification réelle de test.

## Fonctions reprises

- `/coordination-clinique` : création de tâches par la direction et la coordinatrice,
  priorités, échéances, suivi à faire/en cours/terminé, annulation par la direction,
  commentaires, pièces jointes privées et historique.
- `/coordination-clinique/calendrier` : disponibilités en vues semaine et mois,
  création, modification et retrait des créneaux.
- Aperçu de l'espace d'Ève en lecture seule pour la direction. Il ne change
  jamais l'identité de session et n'écrit pas au nom de la coordinatrice.
- Notifications de création : destinataire relu dans le profil lié; la direction
  reçoit une copie lorsque la coordinatrice crée une tâche. Le courriel ne
  contient ni titre, description, note clinique ni pièce jointe. Aucune adresse
  fournie par le navigateur n'est utilisée. Clé fournisseur stable par tâche.

## Accès

Comme dans l'ancien module de Camille, « direction » désigne le compte de
direction configuré dans `isSuperAdmin`, avec le rôle direction et un accès
plateforme actif. Le rôle technique `direction` seul ne suffit pas : les
adjointes, dont Fatima Zahra et Hajar, restent refusées.

Ève conserve son compte professionnel et ses droits professionnels habituels.
Le nouveau poste est un accès supplémentaire, attribué via son UUID Auth dans
`clinical_coordination_staff`. Ni un prénom, ni un courriel semblable, ni un rôle
envoyé par le navigateur ne donne accès. Aucun rôle, contrat, titre de facture ou
taux de rémunération n'est modifié. Le compte existant a été retrouvé et son
lien Auth vérifié en lecture seule; son UUID n'est pas publié dans le dépôt.

Le menu, les deux pages et les notifications vérifient le contexte authentifié
via `/api/coordination-clinique/context`. Les requêtes utilisent la session de
l'appelant, jamais une clé privilégiée. Les tables, le RPC de statut et le bucket
Storage ont aussi leurs protections serveur. Les fichiers sont privés et les
liens de téléchargement de l'interface expirent après 60 secondes. Un accès
révoqué ne permet plus de lire les tables ni de signer un nouveau lien.

Les membres ne sont pas modifiables depuis le navigateur. La coordinatrice
change le statut d'une tâche via un RPC qui ne peut modifier ni propriétaire,
ni auteur, ni contenu de la tâche. L'auteur des notes est relu en base. Les
fichiers doivent appartenir au couple membre/tâche existant; une policy Storage
restrictive empêche une ancienne policy permissive globale d'ouvrir ce bucket.

## Procédure d'activation

1. Après autorisation explicite, appliquer `supabase/clinical-coordination-workspace.sql`
   une seule fois. Il crée cinq tables, leurs index, les fonctions, les RLS et
   le bucket privé. Il ne remplace aucune table marketing ou administrative.
2. Vérifier l'UUID Auth existant d'Ève. Dans le script
   `supabase/clinical-coordination-activate.sql`, définir
   `app.clinical_coordinator_profile_id` avec `set_config(..., true)` après
   `BEGIN`, dans la même transaction. Une préparation locale ignorée par Git
   contient la liaison vérifiée. Le script refuse un profil absent, désactivé,
   différent d'Ève ou un second membre distinct. Il ne crée aucun utilisateur.
3. Publier les deux pages, les API, helpers, composant calendrier et le menu
   ensemble, puis vérifier direction, Ève et refus des deux adjointes. Sans
   migration, le module refuse l'accès aux données et reste absent du menu.

## Vérifications

`tests/clinicalCoordination.test.ts` couvre la direction autorisée, les adjointes
même avec un rôle direction, les comptes tiers, l'UUID, les comptes désactivés,
les vraies routes hors ligne et l'absence de détails cliniques dans la notification.

`scripts/test-clinical-coordination.mjs` nécessite `PGLITE_MODULE_PATH` vers un
module PGlite installé séparément. Il exécute la vraie migration dans une base
jetable en mémoire avec des identités et tâches fictives, puis vérifie les RLS,
les changements de statut, l'interdiction d'auto-attribution, l'auteur des notes,
la révocation et le Storage malgré une policy permissive préexistante.

Les tests SQL ne remplacent pas une vérification du catalogue Supabase réel avant
activation, notamment pour les politiques et les droits Storage déjà présents.

## Résultats locaux du 25 octobre

- Types TypeScript validés et 250 tests unitaires/hors ligne réussis dans le dépôt.
- La copie isolée publiée, sans les changements préexistants hors périmètre, réussit ses 241 tests; les routes de coordination et le scénario SQL PGlite ont aussi été revérifiés avant le commit.
- Lint ciblé réussi sans avertissement. Le lint global réussit en excluant les dossiers privés `.env*` de travail, avec un avertissement préexistant sur la navigation de la page login. Le `npm run check` brut est arrêté par ces artefacts privés (copies locales, sources générées et scripts de travail), pas par les sources de coordination; aucune règle de lint désactivée dans le dépôt.
- Migration testée dans PGlite en mémoire : refus des comptes tiers et adjointes, droits de la direction et de la coordinatrice, notes, fichiers, statuts et révocation vérifiés.
- Vérification visuelle sur données fictives : tâches, changement de statut, création de tâche, aperçu en lecture seule, calendrier semaine/mois et ajout d’un créneau. Les heures planifiées proviennent des créneaux saisis, sans reprendre le quota de l’ancien poste de Camille.
- Aucun changement de rôle ou de rémunération, aucune notification réelle envoyée pendant les tests.

Build de la copie isolée : Webpack réussi (code de sortie 0) après relance de l’arrêt initial d’avertissement Next.js. Routes de coordination et API présentes dans le build.

## Activation en production du 25 octobre

Les deux scripts ont été appliqués dans une transaction unique après vérification
de l'absence des nouvelles tables et du bucket. Un seul membre actif est lié au
compte Auth existant d'Ève. Les cinq tables ont leurs RLS actives, le bucket est
privé et les deux politiques Storage restrictives sont présentes. Aucun droit
INSERT/UPDATE/DELETE sur les membres n'est accordé au navigateur.

Une transaction en lecture seule avec les rôles et claims des comptes existants
a vérifié le helper d'accès et la visibilité RLS des membres : Ève et le compte
direction autorisés; Hajar, Fatima Zahra et un autre professionnel refusés.
Aucune tâche, disponibilité, note ou pièce jointe de test créée en production.
La publication de l'application se fait par le commit ciblé sur main; le résultat
du déploiement est vérifié séparément après le push.
