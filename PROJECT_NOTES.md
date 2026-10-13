# PsychoEducAction - etat du projet

Etat verifie dans le code le 12 octobre 2026. Ce fichier decrit le depot,
pas une verification des migrations, variables ou balises presentes en production.

## Reperes
- `AGENTS.md`: regles de travail et demarrage des sessions.
- `docs/business-rules.md`: invariants et limites metier a conserver.
- `docs/development-checks.md`: commandes, tests et validation avant livraison.
- `docs/public-intake-api.md`: contrat public WordPress et configuration des integrations.
- Les fonctionnalites envisagees ne sont pas des fonctionnalites deployees.

## Architecture et outils
- Next.js App Router / React / TypeScript strict, Tailwind CSS et Lucide.
- Supabase fournit Auth, PostgreSQL, RLS, RPC et Storage. Resend envoie les courriels.
- `xlsx` lit les exports d'activites; `docx` genere les factures Word.
- Versions et dependances: `package.json` et `package-lock.json`; Node 24 recommande.
- `app/`: pages par espace et routes `app/api/`. La plupart des pages sont clientes.
- `lib/`: calculateurs, validations, droits et helpers reutilisables.
- `components/AppNav.tsx`: menus selon les droits; `components/ui/index.tsx`: composants UI.
  `components/Ui.tsx` assure encore une compatibilite avec les anciens imports.
- `supabase/`: scripts SQL manuels et corrections successives, pas une chaine complete
  de migrations initiales. Verifier l'ordre et le schema reel avant execution.
- `tests/`: tests Node hors ligne et fixtures; `tests/integration/`: scenario SQL local.
- `scripts/`: synchronisation Google Ads et lanceur des tests SQL locaux.
- `docs/`: contrats et procedures; `backups/`: copies historiques du site, pas sa source live.
- `vercel.json`: crons des rappels professionnels et des depenses publicitaires.
- `.github/workflows/verify.yml`: controles sur PR et push main, sans deploiement.

## Roles et acces
- Roles de navigation: `direction`, `professionnel`, `marketing`.
- Super administrateur = privilege associe a un compte configure et au role direction,
  pas un quatrieme role; voir `lib/superAdmin.ts` et `lib/superAdminServer.ts`.
- Les adjointes sont identifiees par des listes d'acces et leur fiche de personnel.
  Les droits de paie, de taches et de demandes ne sont pas identiques entre modules.
- Les routes direction utilisent `getDirectionContext` ou un controle equivalent;
  certaines actions ajoutent un controle super administrateur ou une liste d'acces.
- Acquisition et gestion Satisfaction: super administrateur uniquement, menu et API compris.
  Les liens publics de reponse/desabonnement au sondage restent accessibles par jeton.
  Pour une base existante, appliquer avec autorisation `supabase/satisfaction-super-admin-access.sql`;
  le depot prepare les nouvelles RLS, sans les installer automatiquement.
- `lib/supabaseClient.ts`: configuration publique et session utilisateur.
  `lib/supabaseAdmin.ts`: cle de service exclusivement cote serveur.
- Les scripts RLS existent; leur presence ne prouve pas leur application a la base distante.
- Marketing accessible au compte marketing et au super administrateur. L'apercu
  direction est en lecture seule, sans connexion sous l'identite de l'employee.
- Les adjointes voient leur propre paie; la direction autorisee a une vue globale.
  La separation effective des donnees doit aussi etre verifiee en base.

## Fonctionnalites presentes
| Domaine | Entrees et responsabilites |
| --- | --- |
| Connexion | `/login`, invitation, mot de passe oublie et reinitialisation via Supabase Auth. |
| Direction | Tableau de bord, indicateurs et journal d'audit. |
| Professionnels | Profils, activite, invitations et renvoi d'acces. |
| Preferences | Ages structures, services, bureaux, modalites, motifs, exclusions et notes. |
| Liste d'attente | Creation/modification, contacts multiples, priorite, recherche et filtres. |
| Suggestions | Comparaison deterministe des preferences; filtre par pro et actions dans une fenetre. |
| Assignations | Demandes professionnelles, attribution, statut du service et historique. |
| Demarches | `/direction/assignations-en-cours`: contacts, texto declare manuellement, courriel et relance. |
| Prospects et appels | `/direction/prospects`: onglets Calendrier, A traiter et Historique, fiche commune, qualification et transfert volontaire. |
| Ancien calendrier | `/direction/calendrier` redirige vers l'onglet Calendrier en conservant les parametres. |
| Taches admin | Affectation aux adjointes, statuts, notes et notification a la boite partagee configuree. |
| Marketing | Taches, notes, pieces jointes privees, notifications et calendrier de travail modifiable. |
| Paie pro | Import Excel, categories, calculs, factures DOCX et courriel avec CC comptable configuree. |
| Paie adjointes | Heures pre-remplies/modifiables, feries marocains, conges, MAD/CAD et montants mensuels. |
| Budget | Import multimois, repartition pro/clinique, historique, frais et paie des adjointes. |
| Acquisition | Attribution des demandes, evenements techniques, depenses Google Ads/Meta selon configuration. |
| Satisfaction | Import d'activites, seuil de rencontres, courriels individuels, reponse et desabonnement. |

Satisfaction: ameliorations validees et publication autorisee le 13 octobre 2026:
periode automatique, detail visible meme sans eligible, analyse des exclusions,
recherche/filtres, suivi des reponses et aperçu du modele HTML. Envoi test distinct,
reserve au super administrateur, sans liens actifs ni statistiques metier.
`supabase/satisfaction-import-analysis.sql` applique avec autorisation en production;
les anciens imports n'ont pas de detail retroactif des exclusions.
Controles locaux termines: `npm run check:full` (154 tests), apercu bureau/mobile
sur fixtures et migration testee en memoire. Nouvelle colonne JSONB verifiee apres
commit SQL, empreintes des donnees et des dix politiques RLS inchangees.
La cle Resend protegee dans Vercel doit rester sur le serveur; l'API de test distincte
permet un envoi autorise sans importer de faux clients ni fausser les statistiques.

## Parcours d'assignation
1. Un professionnel, ou un gestionnaire autorise dans sa fiche, cree/augmente une demande.
2. Un client en attente est assigne directement, marque hors plateforme, ou place dans une
   demarche administrative avec un professionnel envisage. Les actions restent distinctes.
3. Une assignation en attente reserve une place; un service confirme compte comme pris;
   un service refuse ou une assignation annulee ne reserve plus cette place.
4. Completion quand les services pris atteignent le nombre demande. Zero place disponible
   ne signifie pas toujours demande completee: des clients attendent une confirmation.
   Une demande inactive reste inactive a l'affichage, meme si ses clients de test ont
   ete supprimes. Les compteurs seuls ne rouvrent pas une demande historique.
5. Confirmer le service pris dans une demarche cree l'assignation avec service deja pris.
   Notifications client/professionnel et historique restent des actions a verifier.
6. Les demarches historiques peuvent etre rouvertes ou retournees en attente;
   les liens, compteurs et traces doivent suivre ces transitions.
7. Les dossiers assignes ou classes depuis une demarche restent consultables dans
   Historique clients de la liste d'attente, avec leur motif et leurs notes.
   La section Clients assignes separee est retiree pour eviter le double affichage.

Sources: `app/professionnel/shared.ts`, `lib/waitingListAssignment.ts`,
`lib/assignmentRequestsServer.ts`, pages de liste d'attente/fiche pro et leurs routes.
Les ecritures clientes d'assignation ne sont pas toutes transactionnelles.

## Admission WordPress et rendez-vous
- Le site public appelle `/api/public/intake/{availability,holds,bookings,callbacks}`.
  Origines, Turnstile, frequence et cles d'idempotence sont controles cote serveur.
- Une demande publique cree un prospect, pas automatiquement un client en liste d'attente.
- Confirmer le service dans l'interface prospects passe par le transfert avec motif
  et priorite; le RPC cree la fiche et classe le prospect de facon atomique.
- Rendez-vous dans `intake_appointments`, avec historique; calendrier en heure de Toronto,
  stockage des instants en UTC.
- La fiche commune et la liste distinguent rendez-vous et reception. Un rappel sans
  rendez-vous affiche « Rappel des que possible »; les anciens liens `?prospect=...` restent valides.
- A traiter: rendez-vous du jour choisi (Aujourd'hui/Demain, Toronto) et rappels rapides
  sans rendez-vous actif. Rappels rapides en premier, puis prochain appel futur;
  les appels du jour dont l'heure est passee restent visibles. Rafraichissement chaque
  minute quand aucune fiche n'est ouverte; l'heure de classement avance aux 30 secondes.
- Un clic ouvre une seule fiche. Service pris, Service non pris et Autre sont visibles
  directement. La fiche ne propose plus de modifier le rendez-vous ni de gerer les tests.
- Autre exige une precision; un bouton cree un nouveau rendez-vous sur le meme prospect.
  `supabase/prospect-call-workflow.sql` doit etre installe manuellement avant utilisation:
  resultat/refus et completion de l'appel sont atomiques; nouveau rendez-vous idempotent
  avec verification des conflits. Aucun courriel automatique pour ce suivi interne.
- Nettoyage des tests: marquage explicite puis confirmation, direction seulement.
  RPC transactionnels prepares dans `supabase/prospects-and-calls.sql`, non appliques
  par le code. Dossiers transferes proteges; audit minimal conserve. Les API de nettoyage
  restent disponibles pour un nettoyage ponctuel, mais aucune commande n'apparait dans la fiche.
- Le formulaire utilise un `conversionEventId` distinct de l'identifiant interne du
  rendez-vous. Le suivi technique ne transmet pas les informations du dossier.
- Une notification en echec n'annule pas une reservation deja creee.
- Le transfert confirme les anciens appels passes dans le calendrier et la fiche.
  La version corrigee de `supabase/prospect-direct-waiting-list-transfer.sql` cloture
  ces rendez-vous atomiquement et refuse les doublons; application manuelle autorisee requise.
- La creation manuelle compare les renseignements complets de la demande, dont naissance,
  motif, tous les contacts, requerants, adresse, modalites, disponibilites et notes.
  Un nom seul ne bloque jamais; les homonymes ou demandes differentes sont autorises.
  Une demande identique ouvre la fiche existante. Les dates/status/priorite sont exclus
  de la comparaison. Le transfert API utilise aussi le motif saisi et les champs inseres.
  Le RPC de `prospect-direct-waiting-list-transfer.sql` utilise cette meme regle.
  Revision appliquee avec autorisation explicite dans Supabase le 13 octobre 2026:
  version precedente sauvegardee, 20 scenarios SQL isoles passes et relecture de la
  fonction/privileges apres commit. La migration verifie les empreintes des donnees
  dans sa transaction; aucun dossier existant n'est modifie. API RPC serveur accessible
  et acces anonyme refuse; aucun vrai transfert n'a ete effectue pour la verification.
- Formulaire live, Complianz, GTM et comptes publicitaires sont hors du depot;
  les fichiers de reference ne prouvent pas leur configuration effective.
- Reservation mobile: WPCode 7681 actif (HTML dans l'en-tete), reference
  `docs/wordpress-booking-layout.html`. Limite a `body.page-id-2129`: sept libelles
  de jours distincts, boutons du calendrier sans padding/arrondi herites du theme,
  banniere flottante masquee uniquement sur la page de reservation. Formulaire,
  horaires et conversions inchanges; rendu et selection date/heure verifies.
- Suivi reservations/rappels: helpers WordPress et balises Meta testes hors ligne,
  provenance conservee entre pages avec consentement et conservation de 30 jours.
  `docs/conversion-tracking-release.md` decrit le branchement du formulaire, GTM
  et les parametres publicitaires publies avec autorisation le 12 octobre 2026
  (WPCode 7674, GTM version 17, puis version 18 pour la suspension Meta).
  Meta classe le site en sante avec `Core setup: On`: le blocage de `Lead` par Meta
  est confirme. Les balises Meta 46/47 sont en pause dans GTM version 18;
  ne pas les reactiver ni renommer l'evenement pour contourner cette restriction.
  Les demandes et leur provenance restent mesurees dans Acquisition.
  Campagne Meta Leads mise en pause et remplacee, avec autorisation, par Trafic
  `120247859031510766`, optimisee pour les visites de page, 20 CAD/jour,
  Quebec 25-60 et meme creation/provenance. Annonce en examen lors de la relecture;
  voir le document de livraison pour les identifiants et l'etat des brouillons.
  Aucune provenance
  retroactive inventee pour les anciennes demandes; Acquisition affiche la couverture.

## Paie, facturation et budget
- `lib/payrollCalculator.ts` et `lib/budgetCalculator.ts` partagent
  `lib/professionalCompensation.ts` et `lib/payrollActivity.ts`.
- Montant reclame = total client; ne pas multiplier encore par la duree.
- Rapport/redaction facturable: 80 % professionnel / 20 % clinique.
  Autres taux, seuils, forfaits et exceptions: voir les regles metier.
- Annulations: montant effectivement facture; deplacements rembourses au professionnel,
  hors revenu clinique. Factures Word generees puis envoyables avec CC comptable.
- Le budget detecte dates/mois et remplace le calcul enregistre du mois concerne.
  Les frais fixes restent mensuels, meme pour une periode d'activites partielle.
- Paie administrative: taux issu du salaire mensuel et des heures prevues du mois;
  les heures payables modifient le montant. La sauvegarde alimente le budget.
- Vacances: solde en heures progressant selon le planning annuel jusqu'a la fin du mois
  consulte; pas directement selon chaque heure reelle declaree.
- Depenses publicitaires: lignes quotidiennes puis remplacement du total mensuel,
  sans cumuler a chaque synchronisation.

## Limites et sujets envisages
- Fusion calendrier/prospects implementee dans le depot; nettoyage des tests soumis
  a l'installation manuelle de `supabase/prospects-and-calls.sql` et aux validations locales.
- Synchronisation Meta: code present; connexion externe non attestee par ce document.
- Messages/Parametres masques dans les menus, mais leurs routes existent encore.
- La page direction d'assignations distincte n'existe plus; l'espace pro reste present.
- Tests unitaires/build ne valident pas seuls RLS, concurrence SQL, envois reels,
  pieces jointes ou WordPress. Voir la matrice de verification.
