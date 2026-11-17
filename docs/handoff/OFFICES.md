# Calendrier des bureaux — transmission

Base : `c2e913be6c1f7a250bc8bd620faf7ccb1cd7d233`, copie de la livraison
`production-wording-release-20261116`, déploiement de référence fourni :
`dpl_4A4FAUhtkyGDyE5SVU3G4tw9qors`. Voir `BASE_REFERENCE.json`.

## Modification livrée

Le calendrier réutilise `OfficeSelection` et les helpers existants : cases à cocher
par bureau, bouton « Tous les bureaux », sélection vide possible. Le paramètre URL
`offices` conserve la sélection en navigation jour/semaine et après rechargement.
Les identifiants absents du catalogue autorisé sont ignorés. Aucun droit serveur,
contrat API, détail clinique ou règle de réservation ne change.

Les tests ciblés sont adaptés des tests de calendrier de la copie principale ; leur
lanceur hors ligne est repris sous un nom dédié car l'archive publiée ne le contient pas.
Ils ne proviennent pas d'une ancienne version utilisée comme base applicative.

## Configuration demandée, non appliquée

`OFFICES_REQUEST.json` décrit les six bureaux et la répartition demandée.
Adresses vérifiées sur https://psychoeducaction.com/ et concordantes avec
`lib/serviceAppointmentServer.ts`. Le numéro reste dans son champ dédié et dans
le nom affiché, car le calendrier reçoit actuellement uniquement le nom du bureau.

L'archive de code ne contient pas l'inventaire des bureaux réels ni les identifiants
des comptes. Aucun bureau réel n'a été créé, renommé ni attribué ici.

Après autorisation d'intervenir sur les données, le chat principal doit :

1. Dans Administration > Bureaux, identifier les deux bureaux existants de Longueuil
   avec leurs UUID, adresses et numéros. Les corriger en place si nécessaire ; ne
   pas les recréer, afin de conserver réservations et attributions. Identifier les
   numéros réellement manquants parmi 101, 102, 103, 104 et créer seulement ceux-là.
2. Vérifier Montréal puis créer ou corriger seulement les bureaux 233 et 250.
   Utiliser les champs du JSON ; conserver les couleurs existantes, choisir des
   couleurs distinctes pour les nouveaux bureaux. Aucun ajout automatique au chargement.
3. Identifier les comptes exacts de Hicham et Ève dans le répertoire professionnel.
   Ne pas déduire une identité d'un prénom seul dans un script. Depuis leurs fiches,
   attribuer les six bureaux à Hicham, les quatre de Longueuil à Ève, avec une date
   de début explicite. Vérifier les droits déjà présents, les dates et l'historique.
   Si Ève a déjà un accès Montréal, faire retirer cette attribution via le parcours
   existant pour respecter « Longueuil seulement », en conservant les réservations.
4. Employer les commandes existantes authentifiées :
   `/professionals/offices/commands` avec `expectedVersion` pour une modification,
   puis `office-grants.set` avec la révision relue et la liste complète des
   attributions à conserver. Ne pas écraser les droits d'autres personnes ni
   remplacer ces parcours par du SQL privilégié.

## Intégration et limites

Importer uniquement le commit de retouche, pas le commit initial de snapshot.
Un patch est également livré dans le dossier parent de la copie. Le fichier
`CalendarWorkspace.tsx` peut avoir évolué dans le chat principal : conserver ses
autres changements lors de l'intégration. L'éditeur de notes, les signatures et
`ProfessionalWorkspace.tsx` ne sont pas modifiés.

Contrôles : suite existante des bureaux exécutée une fois (15/15 avec le nouveau
scénario de sélection), puis livraison limitée à une suite dédiée de trois tests
(3/3) pour éviter de dupliquer tous les tests du dépôt principal. ESLint ciblé et
contrôle du diff également exécutés. Aucun changement de dépendance. Les outils
installés dans le node_modules parent sont utilisés en lecture seule.

Commande de la suite livrée :
`node --import ./tests/register-office-visibility.mjs --test --experimental-strip-types tests/officeCalendarVisibility.test.ts`.
Pas de build complet, test navigateur, base locale ou distante, authentification
réelle, courriel ou publication. Les permissions serveur restent celles de la base ;
les tests de filtre ne prouvent pas l'application des accès demandés en production.
