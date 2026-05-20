# Notes projet - assignations-app

## Objectif de l'application

Plateforme interne de gestion des demandes d'assignation et de suivi des clients pour une clinique.

## Stack technique

- Next.js
- TypeScript
- Supabase
- Tailwind

## Roles

- direction
- professionnel

## Pages principales

- `/login`
- `/`
- `/direction` : dashboard resume pour la direction
- `/direction/professionnels` : gestion detaillee des professionnels
- `/direction/assignations` : suivi des demandes d'assignation
- `/direction/parametres` : parametres et informations administratives
- `/professionnel`
- `/professionnel/[id]`

## Tables Supabase

- `profiles`
- `assigned_clients`
- `assignment_requests`

## Workflow actuel

1. Le professionnel fait une demande d'assignation.
2. La direction voit les demandes dans un dashboard avec recherche, filtres et tri.
3. La direction assigne un client.
4. Le professionnel voit ses clients.
5. Le professionnel indique :
   - contact effectue;
   - service pris oui/non;
   - motif si non;
   - commentaire.
6. Le professionnel peut voir et modifier ses preferences d'assignation :
   - clienteles souhaitees;
   - modalites souhaitees;
   - types de suivis souhaites;
   - notes / precisions.
7. La direction voit les statistiques et les preferences d'assignation.
8. Une demande peut avoir les statuts visuels suivants :
   - demande inactive;
   - demande en cours;
   - demande completee.
9. Une demande completee reste visible et n'est pas supprimee automatiquement.

## Interface actuelle

- Design global clinique moderne, doux et professionnel.
- Navigation laterale sur desktop et navigation compacte sur mobile.
- Navigation conditionnelle selon le role connecte.
- Navigation cote direction :
  - Dashboard direction : `/direction`;
  - Assignations : `/direction/assignations`;
  - Professionnels : `/direction/professionnels`;
  - Parametres : `/direction/parametres`;
  - Deconnexion.
- Navigation cote professionnel :
  - Espace professionnel : `/professionnel`;
  - Deconnexion.
- Tableaux modernises avec badges, etats vides, meilleur espacement et scroll horizontal.
- Couleurs inspirees du branding PsychoEducAction : brun chaud, cuivre, beige pale et gris chauds.

## Securite actuelle

- Protection cote client existante.
- RLS non finalise.
- RLS a traiter plus tard avant production.

## Regles importantes

- Ne pas modifier les tables Supabase sans validation.
- Ne pas toucher au login sans raison.
- Travailler en petites etapes.
- Tester puis commit apres chaque fonctionnalite stable.
