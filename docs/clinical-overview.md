# Consultation clinique — activation du 26 octobre 2026

Ève conserve son rôle professionnel et son accès existant de coordination.
Le nouveau périmètre permet uniquement de consulter les données de coordination :

- `/coordination-clinique/tableau-de-bord` : demandes des professionnels actifs,
  commentaires de demande, capacités, services pris/à confirmer/non pris et
  compteurs de liste d'attente. Les noms ne sont pas des liens.
- `/coordination-clinique/liste-attente` : dossiers courants en attente, recherche
  et pagination; aucun ajout, assignation, édition, suppression ou envoi. Les
  démarches non terminées sont masquées comme dans la liste existante. Les
  coordonnées, requérants, notes internes et historiques ne sont pas transmis.
- `/preferences-professionnels` : nouvelle page pour la direction et la
  coordinatrice, avec toutes les préférences structurées des professionnels
  actifs, y compris exclusions et précisions. Recherche par nom/motif/précision
  et filtres service, modalité, bureau. Les valeurs absentes sont indiquées
  explicitement, sans déduire une langue ou une préférence par défaut.

Les pages direction de gestion et les fiches professionnelles restent réservées
au rôle direction; aucun droit d'invitation ou de gestion n'est attribué à Ève.
Les fonctions professionnelles habituelles d'Ève et ses tâches de coordination
restent inchangées. Les adjointes conservent leur consultation direction habituelle,
sans obtenir l'accès à l'espace privé des tâches d'Ève.

## Contrat et activation

GET `/api/clinical-overview?view=dashboard|waiting-list|preferences` vérifie le
compte actif, le rôle direction ou l'appartenance UUID active de coordination,
puis appelle `read_clinical_overview` avec le JWT de l'appelant et une clé publique.
Aucun client privilégié, chemin de mutation ni destinataire de courriel.
Les réponses et les erreurs sont privées et non mises en cache.

`supabase/clinical-coordination-readonly-overview.sql` ajoute une seule RPC
SELECT, protégée par une seconde vérification en base. Elle projette les seuls
champs nécessaires, sans ouvrir les tables à une lecture générale, sans données
de rémunération et sans nouveaux droits INSERT/UPDATE/DELETE. Elle ne modifie
ni compte, ni rôle, ni dossier, ni demande existante. Les refus et annulations
n'occupent pas de place dans les demandes; seuls les services confirmés
comptent comme pris, selon le helper partagé avec le dashboard actuel.

La migration distante a été activée le 26 octobre après autorisation explicite
de cette extension. Le compte professionnel et l'appartenance existante d'Ève
ont été conservés. Aucune donnée de dossier modifiée ni notification réelle.

## Vérifications

- `tests/clinicalOverview.test.ts` : règles de demande/capacité et vraies routes
  hors ligne; sessions, révocation, UUID, direction, vues invalides, pannes,
  absence de RPC avant autorisation et absence de route de mutation.
- `scripts/test-clinical-overview.mjs` avec `PGLITE_MODULE_PATH` : vraie migration
  en mémoire; projections sans coordonnées/paie/notes internes, accès direction
  et coordinatrice, refus tiers/anonyme/révoqué, pas de nouveaux droits d'écriture,
  annulations/refus exclus de l'occupation, démarches actives masquées et retour visible.
- Types et lint ciblé réussis. 252 tests réussis dans le dépôt de travail.
- Les 243 tests de la copie isolée, sans les autres changements locaux, réussissent.
- Build Webpack complet de la copie isolée réussi (sortie 0), après une première
  interruption d'avertissement Next.js. Les trois pages et l'API sont présentes.
- Vérification visuelle réussie avec un compte de coordination fictif : menu,
  résumé complet des préférences et filtre vide, demandes sans liens vers les
  fiches professionnelles, liste d'attente sans lien ni bouton métier, recherche
  sans résultat. Le menu long revient à la ligne au lieu de déborder.

La vérification visuelle utilise une copie isolée de HEAD et ces seuls fichiers,
avec un serveur Supabase fictif local.

## Validation de production

La création de la fonction et ses contrôles ont été exécutés dans une transaction
unique. Les trois vues ont été appelées avec les rôles et claims des 28 comptes
existants : direction et coordinatrice active autorisées, autres comptes refusés.
Les projections excluent les champs de paie, coordonnées et notes internes; la
fonction est STABLE et l'exécution anonyme est refusée. Les tests ne créent ni
session utilisateur, ni donnée métier, ni courriel. Aucun rôle de compte ou
droit de mutation sur les tables n'a été ajouté.

La publication des trois pages et de l'API suit par le commit ciblé sur main;
le statut Vercel et les routes publiques sont vérifiés séparément après le push.
