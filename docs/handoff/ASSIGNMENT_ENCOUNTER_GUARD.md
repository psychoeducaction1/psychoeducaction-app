# Service non pris après démarrage d'un suivi

## Règle demandée

La demande de remplacement n'est pas créée : l'utilisateur a choisi de libérer
la place existante. Les calculs de capacité, reçus idempotents, versions et audits
de la commande existante restent inchangés. Une demande inactive n'est pas
réactivée automatiquement par ce lot.

« Service non pris » est permis uniquement si aucune rencontre n'a eu lieu dans
l'épisode clinique lié à cette assignation. Comme pour la fermeture existante
`no_encounter`, une activité `meeting` compte si elle est `completed`, ou encore
`planned` avec une heure de fin déjà passée. Une rencontre écoulée non corrigée
en absence/annulation impose donc une vérification du calendrier. Les absences,
annulations, activités de rédaction et autres épisodes ne comptent pas.

Les rendez-vous futurs ne bloquent pas ce changement et restent conservés.
Ce lot ne ferme pas automatiquement le dossier clinique, ne révoque aucun accès,
n'annule aucun rendez-vous et ne modifie aucun document, facture ou signature.
Le statut clinique existant et les autres suivis du client restent indépendants.

## Mise en œuvre préparée, NON APPLIQUÉE

`supabase/clinical/assignment-non-service-encounter-guard.sql` ajoute un trigger
avant le changement de `public.assigned_clients.is_active` vers `false`.
Il couvre la commande unifiée et les autres chemins d'écriture de cette table.
Les contrôles d'identité, RLS et d'autorisation existants restent nécessaires et
ne sont ni remplacés ni élargis. La fonction privée effectue seulement la lecture
de contrôle ; aucun droit d'exécution direct n'est accordé aux rôles applicatifs.

Le contrôle lie l'UUID de l'assignation à son épisode via
`clinical.legacy_assignment_links`. Il prend le verrou professionnel du calendrier
puis verrouille l'épisode comme les autres parcours. Les commandes calendrier
existantes prennent un verrou partagé sur cet épisode : la vérification se
sérialise ainsi avec leurs créations et changements de statut. Un refus lève
`40001 / ASSIGNMENT_ENCOUNTER_EXISTS` avant toute écriture du statut, des compteurs,
de l'audit ou du reçu de commande. Aucun contournement RLS n'est ajouté aux mutations.

Le gestionnaire HTTP reconnaît ce code avant le conflit générique et renvoie un
message métier 409. Le formulaire garde sa saisie après refus et affiche un bouton
« Aller à la fermeture du dossier ». Il ouvre la fiche existante, dont la section
« Statut du dossier » permet la fermeture selon les permissions habituelles.
L'action de fermeture n'est jamais lancée par ce bouton. Aucun éditeur de notes
ou affichage de signature n'est modifié.

## Vérifications et intégration

- PostgreSQL PGlite éphémère, données fictives : application et réapplication du
  SQL, zéro rencontre, rendez-vous futur conservé, rencontre effectuée ou écoulée,
  absence, annulation, rédaction, autre épisode, RLS et fonction privée. Les refus
  sont vérifiés pour un rôle professionnel et un rôle direction, sans mutation
  du statut. Six tests (parent inclus) réussis.
- Quatre tests de rendu/HTTP réussis : présentation des deux contextes, refus
  métier, formulaire conservé, message et bouton de fermeture. Les contrôles de
  présentation précédents restent inclus.
- ESLint ciblé, TypeScript sans émission et contrôle du diff réussis.

Les tests SQL utilisent un schéma minimal isolé, pas la base réelle ni toute la
chaîne d'assignation. Ils ne prouvent pas une concurrence de deux connexions, les
RLS de production, la libération effective d'une place dans la base réelle ou le
fonctionnement navigateur du parcours complet. Aucun build complet ni test distant.

Le chat principal doit intégrer le code et, avec autorisation distincte, appliquer
la migration après vérification de ses tables/colonnes et de la définition des
verrous des fonctions calendrier réellement installées. Le code seul n'active pas
la protection SQL. Si un service déjà pris n'a pas de lien clinique, le changement est refusé avec
un message demandant une vérification par la direction. Aucun épisode n'est
déduit par nom ou prénom. Sans service précédemment pris ni lien, la transition
reste permise.
Ne pas importer les schémas de test dans une base existante.

Fichiers partagés pouvant entrer en conflit : `ProfessionalPanel.tsx` et
`lib/clinical-unification/http.ts`. Le helper `outcomeErrors.ts`, le SQL et les
tests sont locaux à cette règle. Aucune migration distante ni publication ici.
