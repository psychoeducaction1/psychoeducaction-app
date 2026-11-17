# Bibliothèque privée des procédures — transmission au chat principal

## Base et copie

Copie indépendante : `C:\Users\thinh\Documents\assignations-app\output\procedures-isolated-20261117`.
Branche : `codex/procedures-20261117`.
Commit de référence : `73f360d4b5c8def9cdc249f48a9335c7c3c8588d`.

La base est l'archive `transcript-retention-release-20261117`, désignée par
`output/unification-pilot/docs/migration/TRANSCRIPT_RETENTION_RELEASE.json`.
Les empreintes de tous ses fichiers ont été vérifiées avant copie ; 566 fichiers
applicatifs sont repris, sans `.vercel`, configuration de déploiement, `.env`,
secrets, node_modules ou compilation. `PROCEDURES_BASE.json` conserve le manifeste.
Le chat principal a confirmé la publication des transcriptions ; il travaille
ensuite sur le retrait du motif de correction des rencontres. Ne pas écraser ses
changements plus récents lors de l'intégration. Aucun départ depuis main.

## Fonction livrée

- Nouvelle destination `/procedures`, accessible depuis les menus existants de
  l'administration, de la clinique et de la coordination via leur navigation.
- Recherche par mots-clés dans le titre, le contenu, les mots-clés et le nom de
  section ; accents/apostrophes normalisés ; filtre de section cumulable.
- Lecture des fiches, statut En vigueur / À relire / À compléter et date/version.
- Ajout et modification de fiches, ajout et renommage des sections. Texte simple
  échappé, sans HTML exécuté. Les changements non enregistrés sont protégés par
  les gardes de formulaire existantes.
- Sauvegarde durable et versions conservées en base, auteur dérivé de la session.
  Une version périmée est refusée avec conservation du texte dans le formulaire.
  Pas de suppression de fiche, de révision ou de membre dans l'interface.
- Une création conserve son UUID pendant la saisie : une réponse perdue ne conduit
  pas à recréer automatiquement une seconde fiche. Il faut relire la liste si la
  confirmation d'enregistrement est incertaine ; aucun rejeu automatique.

## Source documentaire consultée

Bloc-notes OneNote « Gestion Administrative », consulté le 17 novembre 2026 :
15 pages dans quatre sections, reprises en contenu structuré relisible dans
`supabase/procedure-library/onenote-content.json`. Ce n'est pas une synchronisation
avec OneNote ni une reproduction typographique mot pour mot. Les tableaux sont
reformulés en listes avec leurs colonnes attribuées, les modèles restent vierges.

- Répartition des tâches : deux pages, dont le tableau de répartition vide et
  l'ordre des priorités.
- Procédures en vigueur : ouverture de dossier, liste d'attente, assignations,
  annulations/absences, facturation PAE, facturation clients, impayés, facturation IVAC.
- Plaintes et insatisfactions : procédure et modèle vierge de réception/suivi.
- Nouveauté et décisions : trois rubriques réellement vides dans la source,
  conservées à compléter, sans contenu inventé.

Les 12 fiches avec contenu sont importées « À relire » ; les trois pages vides
« À compléter ». Les personnes autorisées peuvent les modifier puis les passer
« En vigueur ». L'import n'affirme pas qu'une règle a été validée juridiquement.
Les réserves de la source sont conservées. À examiner particulièrement : frais
d'ouverture de 60 $, utilisation du bureau administratif 100 pour le PAE,
articulation relances/suspension des suivis et valeurs de remboursement citées.
Ces textes ne pilotent aucun tarif, débit, remboursement ou annulation.

L'annexe « Guide_pairage_PAE_PsychoEducAction (1) » est mentionnée dans le bloc-notes
mais son fichier n'a pas été récupéré ; il reste à fournir/ajouter. Aucun lien de
partage OneNote donnant accès au document ni identifiant temporaire de session
IVAC n'est enregistré dans le contenu applicatif. Aucune plainte réelle ni donnée
de client n'est importée. La bibliothèque n'est pas un registre de plaintes.

## Accès à activer uniquement par le chat principal

L'utilisateur a corrigé « Richard Boukli » en **Hicham Boukili**. Liste retenue :

1. Ève Deveault-Harvey, coordination clinique.
2. Thinhinane Ould Younes.
3. Hicham Boukili.
4. Hajar, adjointe administrative.
5. Fatima Zahra, adjointe administrative.

Ces cinq personnes sont prévues en lecture et modification. Aucun accès réel n'a
été activé ici. Il faut identifier et vérifier leurs UUID Auth/profiles exacts
dans le répertoire existant ; ne pas créer de compte ni attribuer selon un prénom
seul, une correspondance partielle ou une valeur fournie par le navigateur.

La table `procedure_library_members` est vide à l'installation. Le rôle direction,
un accès à la coordination ou la possession de l'URL ne donnent aucun accès
implicite. L'appartenance est distincte des droits de dossiers cliniques et de paie.
Ne pas réutiliser la liste de coordination, qui exclut précisément les adjointes.

Après autorisation d'appliquer la migration, le chat principal pourra inscrire
les cinq UUID vérifiés avec `active=true, can_edit=true` dans cette seule table.
Le navigateur ne peut ni créer ni modifier les membres. Toute révocation par
`active=false`, retrait de can_edit ou désactivation plateforme prend effet côté
RPC/RLS sur les prochaines lectures et sauvegardes. L'interface revalide à son
retour au premier plan hors édition et sur changement de session ; elle n'est
pas un mécanisme d'effacement rétroactif des données déjà consultées.

## Migration et import préparés, NON APPLIQUÉS

1. Relire puis appliquer une fois `supabase/procedure-library/001-library.sql`.
   Ce nouveau schéma ajoute quatre tables privées, leurs RLS et quatre RPC.
   Toute erreur doit annuler la transaction. Le script n'est pas un outil de
   réconciliation d'un schéma partiellement créé ; ne pas ignorer une erreur.
2. Relire le contenu et appliquer `002-onenote-content.sql` pour les 15 fiches et
   quatre sections. Cet import est réexécutable sans écraser les fiches éditées.
3. Inscrire les cinq comptes vérifiés dans procedure_library_members.
4. Vérifier le rafraîchissement du schéma PostgREST, puis la page et le menu pour
   chaque compte dans le cadre des autorisations du chat principal.

Le code seul ne crée ni tables, ni contenu, ni droits. Si la migration ou la liste
de membres manque, l'API refuse l'accès et le menu reste masqué. Ne pas injecter
les fixtures SQL des tests dans une base existante.

Le script `node scripts/prepare-procedure-library.mjs` ne fait que régénérer le
fichier SQL à partir du JSON dans le dépôt : aucun réseau, .env ou accès base.

## Contrat et sécurité

`/api/procedures` vérifie le Bearer JWT via getUser, le profil actif sur la
plateforme, puis l'appartenance avant lecture ou mutation. Le client Supabase
utilise exclusivement la session de l'appelant et la clé publique ; aucune clé
de service. Les RLS restent actives pour les accès directs aux tables. Seuls les
RPC de sauvegarde, avec contrôle d'appartenance et verrouillage, peuvent écrire.
Les versions empêchent les écrasements concurrents ; les révisions sont privées
et non modifiables depuis les rôles applicatifs. Les réponses sont private/no-store.
Les identités/auteurs/droits envoyés dans le corps d'une commande sont refusés.
Une origine étrangère est refusée ; le corps JSON et les champs sont bornés.
Les textes privés de OneNote ne sont pas importés dans un composant client ni
placés sous public ; ils sont servis seulement après contrôle d'accès en base.

## Fichiers et risques d'intégration

- `app/procedures/page.tsx`, `components/procedures/*` : écran, édition et lien
  conditionnel ; composants UI et gardes existants réutilisés.
- `app/api/procedures/route.ts`, `lib/procedures/{server,http,client,model}.ts` :
  authentification, API, validation, recherche et transport.
- `supabase/procedure-library/*`, script de génération : schéma privé et import.
- `components/AppNav.tsx` et `components/clinical-workspace/ClinicalWorkspace.tsx` :
  uniquement le lien de navigation. Reporter ces petits ajouts sans remplacer les
  fichiers complets si le chat principal les a modifiés depuis la base.
- `tests/procedureLibrary*` et lanceur dédié : données fictives, tests hors ligne.

Pas de modification de l'éditeur de notes, des signatures, des tarifs, de la paie,
des assignations, d'une configuration de production ou d'une dépendance.

## Vérifications

Tests ciblés de recherche, validation, HTTP, rendu de la page et du formulaire,
schéma PostgreSQL PGlite éphémère, cinq membres fictifs, utilisateur non membre,
lecture seule, révocation, désactivation, conflits de versions, auteur de session,
création, révisions immuables, refus des écritures directes et import sans écrasement.

```powershell
node --import ./tests/register-procedures.mjs --test --experimental-strip-types tests/procedureLibrary.test.ts tests/procedureLibraryUi.test.ts tests/procedureLibrarySql.test.mjs
```

Résultats définitifs : 11 tests ciblés réussis, aucun échec ; TypeScript global
sans émission réussi ; ESLint ciblé sans erreur ni avertissement ; diff vérifié. Pas de navigateur
authentifié sur l'application, build complet, concurrence de deux connexions,
vérification RLS distante, envoi, droits réels ou publication. Les tests en mémoire
ne prouvent pas la configuration de production. Le schéma fictif des tests reste
strictement distinct du bloc-notes source et des vrais comptes.
