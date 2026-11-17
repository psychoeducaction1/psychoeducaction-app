# Simplification des détails d'un client

- Le bouton de liste devient « Détails » dans le panneau partagé.
- En Clinique, chaque fiche sélectionnée est directement affichée, sans le
  repli intermédiaire « Prise en charge ». La section « Résultat du contact »
  reste immédiatement après les informations de la fiche, avec ses validations
  et sa sauvegarde existantes.
- L'historique des événements n'est plus rendu dans `AssignmentCase` en contexte
  professionnel. Son affichage, les courriels et les actions administratives
  restent inchangés en Administration. Les traces ne sont pas effacées ; cette
  modification d'interface ne constitue pas une modification des droits API.

Fichiers applicatifs : `ProfessionalClientsPanel.tsx` et `ProfessionalPanel.tsx`.
Tests : `tests/professionalClientDetails.test.ts`, deux tests de rendu hors ligne
réussis couvrant les deux contextes. ESLint ciblé et contrôle du diff exécutés.
Pas de navigateur, nouveau contrôle TypeScript global, build ni accès distant
pour cette retouche. Aucun contenu de capture réelle repris dans les fixtures.
Éditeur de notes et signatures inchangés. Aucune publication.

Commande :
`node --import ./tests/register-office-visibility.mjs --test --experimental-strip-types tests/professionalClientDetails.test.ts`.

Intégrer après les commits précédents de cette branche, particulièrement la
séparation Mes assignations / Mes clients. Les deux panneaux peuvent entrer en
conflit s'ils ont été modifiés parallèlement ; conserver les autres évolutions.
