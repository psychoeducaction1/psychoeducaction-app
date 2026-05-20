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
- `/direction`
- `/professionnel`
- `/professionnel/[id]`

## Tables Supabase

- `profiles`
- `assigned_clients`
- `assignment_requests`

## Workflow actuel

1. Le professionnel fait une demande d'assignation.
2. La direction voit les demandes.
3. La direction assigne un client.
4. Le professionnel voit ses clients.
5. Le professionnel indique :
   - contact effectue;
   - service pris oui/non;
   - motif si non;
   - commentaire.
6. La direction voit les statistiques.

## Securite actuelle

- Protection cote client existante.
- RLS non finalise.
- RLS a traiter plus tard avant production.

## Regles importantes

- Ne pas modifier les tables Supabase sans validation.
- Ne pas toucher au login sans raison.
- Travailler en petites etapes.
- Tester puis commit apres chaque fonctionnalite stable.
