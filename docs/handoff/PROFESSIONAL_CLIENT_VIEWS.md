# Mes assignations / Mes clients

Le panneau partagé des clients propose deux boutons dans l'espace Clinique :

- Mes assignations : assignations actives « À contacter » et « En attente de réponse ».
- Mes clients : services pris et démarches terminées ; les archives restent dans
  leur section et leur filtre existants (services non pris, annulations, clôtures).

Le paramètre URL `clientView` conserve le choix au rechargement. L'entrée
Assignations ouvre la première vue ; l'entrée Clients ouvre la seconde. Le
changement de vue réinitialise le filtre de statut et la sélection de détail.
La recherche et les boutons d'ouverture de fiche ou de prise en charge sont
conservés. L'espace Administration garde sa liste et ses filtres existants.

Les démarches sont séparées avant regroupement par UUID client. Un même client
peut ainsi conserver son suivi dans Mes clients et sa nouvelle démarche dans
Mes assignations. Les dossiers cliniques importés sans assignation opérationnelle
restent dans Mes clients selon les règles de lecture et d'archivage existantes.

Aucune mutation de statut, suppression, nouvelle autorisation ni modification
API/SQL. La projection du professionnel et les dossiers lisibles déjà reçus sont
les seules sources. Aucun éditeur de notes ni affichage de signature modifié.

Fichiers :

- `ProfessionalPanel.tsx` branche la liste professionnelle sur le panneau partagé.
- `ProfessionalClientsPanel.tsx` ajoute le choix des deux vues et leurs filtres.
- `lib/clinical-admission/professionalClients.ts` sépare les démarches avant regroupement.
- `tests/professionalClientViews.test.ts` vérifie les statuts, l'isolation entre
  professionnels, l'absence de mutation, le double suivi et les dossiers importés.

Trois tests Node ciblés réussis, ESLint ciblé réussi. Commande de test :
`node --import ./tests/register-office-visibility.mjs --test --experimental-strip-types tests/professionalClientViews.test.ts`.
TypeScript sans émission réussi. Le contrôle a aussi révélé puis permis de
corriger une annotation de type dans le test du filtre des bureaux (aucun
changement de comportement). Aucun test navigateur,
build, accès distant, envoi ni publication. Conflit possible si les panneaux
d'admission ou le regroupement des clients évoluent dans le chat principal.
Les liens directs vers un détail restent soumis à la vue courante : pour une
démarche terminée, ouvrir Mes clients puis son détail.
