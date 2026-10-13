# Regles metier critiques

Reference du code au 12 octobre 2026. Conserver ces regles lors d'une correction;
si la demande les change, mettre a jour implementation, tests et cette reference.
Ne pas recopier d'identites, de courriels prives ou de donnees de dossiers ici.

## Assignations et transitions
- `assigned_clients.is_active`: `null` = service a confirmer, `true` = service pris,
  `false` = service non pris. `contacted` distingue non contacte et attente de reponse.
- Dans les compteurs, exclure les assignations avec `canceled_at` renseigne.
- Places occupees = services pris + services a confirmer; places restantes =
  `max(nombre demande - places occupees, 0)`. Les refus ne prennent pas de place.
- Services pris = uniquement `is_active === true`. Une demande peut etre active et
  avoir zero place restante quand tous les clients attendent une confirmation.
- Completion = services pris >= nombre demande, si le nombre demande est positif.
- Une demande enregistree inactive ne redevient pas active a la lecture lorsque ses
  clients sont retires ou que ses compteurs sont recalcules. Seul `is_active=true`
  permet de l'afficher comme active; une completion confirmee reste historique.
- Une demande active avec place restante est requise avant creation de l'assignation;
  les actions de suggestion ne creent pas silencieusement une demande en plus.
- Un refus exige un motif; `Autre` exige une precision. Utiliser les helpers de
  `app/professionnel/shared.ts` pour traduire et valider les statuts.
- Confirmer directement un service cree `contacted=true`, `is_active=true` et recalcule.
- Reouvrir une demarche historique ou retourner un client en attente doit annuler
  l'assignation liee si necessaire, recalculer et conserver les traces historiques.
- Les demarches terminees (`assigned`, `classified`, `returned`) ne masquent plus
  le dossier source dans la liste des clients. Seules les demarches encore actives le masquent.
- Historique clients inclut les statuts `assigned`, `active`, `closed`, `blacklisted`;
  les assignes apparaissent une seule fois, dans Historique clients. Motif et notes sont conserves.
- Texto: saisie manuelle de l'envoi, pas d'envoi Twilio. Les contacts complementaires
  sont disponibles apres un statut sans reponse. Une relance a 48 heures cree une tache
  interne, pas un second texto/courriel client automatique.

Sources: `app/professionnel/shared.ts`, `lib/waitingListAssignment.ts`,
`lib/assignmentRequestsServer.ts`, `app/direction/assignations-en-cours/page.tsx`,
`app/api/direction/assignment-processes/[id]/history-action/route.ts`.

## Preferences et filtre de compatibilite
- Services: psychoeducation, intervention psychosociale, psychotherapie,
  evaluation psychologique. Une evaluation psychoeducative correspond a psychoeducation.
- Suggestions deterministes: service (30), age (20), modalite/bureau (25), motifs (25).
  Suggestion a partir de 80 avec exclusion des incompatibilites de service, d'age
  ou de modalite. La capacite restante n'entre pas dans le score.
- Ages: tolerance de deux ans autour des plages; pas de maximum pour une plage ouverte.
- Age, service ou modalite inconnus ne sont pas toujours exclus: le code leur attribue
  des points. Motifs compares par mots-cles, pas par une analyse clinique IA.
- Les dossiers d'age inconnu restent inclus dans les filtres d'age de la liste d'attente.
- Le filtre IVAC/PAE/CNESST recherche les termes dans les renseignements du dossier.
  Conserver les notes, precisions et exclusions des professionnels.

Sources: `lib/professionalPreferences.ts`, `lib/professionalMatching.ts`,
`lib/waitingListFilters.ts`, `app/direction/liste-attente/page.tsx`.

## Prospects et reservations
- Formulaire public: motif et naissance facultatifs. Transfert en liste d'attente:
  motif non vide et priorite `normal`, `urgent` ou `existing_or_transfer` requis par l'API.
- `service_taken` dans l'interface utilise le transfert. Le RPC cree/lie le dossier et
  passe a `transferred_to_waiting_list`; un retry retourne le meme client.
  Le transfert cloture aussi les rendez-vous planifies dont l'appel est passe, dans la
  meme transaction, avec un evenement unique. Aucun rendez-vous futur n'est cloture.
  La lecture calendrier/fiche corrige l'affichage des anciens transferts deja confirmes;
  le seul depassement de l'heure ne termine jamais un appel sans resultat.
  La route PATCH accepte aussi `service_taken`: elle ne transfere pas elle-meme un dossier.
- `service_not_taken` et `other` exigent une justification. Historique de l'interface:
  resultats `other`, `service_not_taken`, `service_taken` historique et prospects transferes.
  Un suivi planifie repasse le prospect a `scheduled` en conservant la precision precedente.
- Reservation: hold non expire, puis booking idempotent. Conserver verrous SQL et
  contraintes anti-doublon; un controle UI ne les remplace pas.
- `appointmentId` interne. `conversionEventId` = UUID distinct, stable au retry,
  seul identifiant de reservation autorise dans le dataLayer avec le type d'evenement.
- Attribution: liste de champs techniques autorises, jamais les informations du formulaire.
  Le succes metier ne depend pas du succes d'une notification.
- Fuseau Toronto; lundi-vendredi de 8 h a 18 h, samedi de 12 h a 15 h 30, dimanche ferme.
  Pas de reservation dans les deux prochaines heures; appel 15 min + tampon 15 min.
- Deplacement: identifiants conserves. Annulation: rendez-vous inactif.
- « Prospects et appels » reunit calendrier, a traiter et historique. La meme fiche
  expose directement Service pris, Service non pris et Autre, sans commandes de modification
  du rendez-vous ni de gestion des tests. La reception (`created_at`) n'est
  jamais utilisee comme date du rendez-vous (`start_at`); fuseau Toronto pour les deux.
- A traiter = appels planifies dans la journee choisie (Toronto, aujourd'hui/demain) et
  rappels rapides sans rendez-vous actif, meme recus anterieurement. Les rappels rapides
  passent avant le prochain appel a partir de l'heure courante, puis les autres appels
  futurs en ordre chronologique; les heures passees du jour restent a traiter en dessous.
  Un prospect avec un resultat enregistre n'est plus dans cette file.
- Rappel sans rendez-vous: « Rappel des que possible ». Autre/refus enregistres par le
  RPC cloturent l'appel selectionne et terminent les taches de rappel liees. Le service
  pris conserve le transfert existant. Les annulations historiques gardent date/statut.
- Creer un autre rendez-vous pour Autre: precision requise, meme prospect, resultat et
  nouveau rendez-vous dans une transaction; aucun nouveau client/prospect. Retry idempotent,
  autorisation direction, horaire Toronto, preavis, verrous et conflits avec appels, holds
  et blocages. Aucun courriel automatique dans ce parcours interne.
- Suppression de test: direction authentifiee, marquage `is_test` explicite et confirmation
  distincte obligatoires. Les RPC controlent aussi le role de l'acteur en base. Aucun
  marquage retroactif automatique des demandes publiques ni reconnaissance par le nom.
- Un prospect lie a un client ou au statut `transferred_to_waiting_list` ne peut etre
  supprime ici. La suppression transactionnelle retire demandes idempotentes, taches de
  rappel/notes, rendez-vous/evenements et prospect; detache les references de doublons.
  Elle conserve les audits et n'efface ni client, ni assignation, ni plage bloquee, ni hold.
  Les cles idempotentes retirees ne sont plus reutilisables comme preuve de reception:
  ne pas rejouer une ancienne soumission de test apres nettoyage.
- Doublon potentiel = contact normalise deja present; avertissement distinct d'une
  soumission idempotente. Ne pas fusionner des dossiers sur un nom seul.
- Creation manuelle: lecture fraiche des fiches; bloquer uniquement une demande identique:
  nom, naissance (une absence n'est pas un joker), motif, service, tous les contacts,
  requerants, adresse, modalites, disponibilites et notes internes. Ignorer casse/espaces
  et format des contacts; les ensembles de contacts/modalites ignorent ordre et repetitions.
  Nom et motif non vides, avec naissance ou contact, requis pour affirmer un doublon.
  Le nom seul, un contact partage ou un motif different ne bloquent pas la creation.
  Statut, priorite, dates de gestion et identifiants ne definissent pas la demande.
  Ouvrir la fiche identique sans la modifier. Les transferts utilisent le motif saisi
  et les champs qui seront inseres, avant toute ecriture et dans le RPC corrige.
  `prospect-direct-waiting-list-transfer.sql` doit etre applique avec autorisation pour
  aligner une base existante; la verification TypeScript ne remplace pas le RPC distant.
  La verification manuelle ne garantit pas
  l'absence de course entre deux creations simultanees; une contrainte unique globale serait
  incorrecte pour les demandes multiples. Aucun regroupement destructif automatique.

Sources: `lib/publicIntakeSchedule.ts`, `lib/publicIntakeValidation.ts`,
`lib/publicIntakeSecurity.ts`, routes `app/api/public/intake/`,
`supabase/public-intake-calendar.sql`, `supabase/prospect-direct-waiting-list-transfer.sql`.
Complement: `lib/prospectsWorkspace.ts`, `lib/prospectTestActions.ts`,
`supabase/prospects-and-calls.sql`.
Parcours quotidien: `lib/prospectCallActions.ts`, `supabase/prospect-call-workflow.sql`.

## Remuneration, facture et budget
- Export: DATE, PROFESSIONNEL, CLIENT, REQUERANT, DESCRIPTION, DETAIL,
  EMPLACEMENT, PAYE, MONTANT RECLAME, MANDAT. Lignes `non facturable` exclues.
- Montant reclame = total facture. Rencontre a pourcentage: montant * taux,
  sans seconde multiplication par la duree.
- Quantite de facture = duree d'une rencontre, nombre d'elements d'un entretien
  telephonique. Prix unitaire derive du total / quantite.
- `rapport` ou `redaction` dans description/detail: 80 % pro / 20 % clinique,
  duree variable, meme sans categorie; ces lignes ne comptent pas au seuil hebdomadaire.
- Seuil de dix rencontres par semaine: intervenant 50 % puis 60 %; membre d'ordre
  60 % puis 70 %. Compter des rencontres, pas des heures ni des annulations.
- Psychotherapeute: forfait 110 par heure pour une rencontre; annulation au prorata
  de la base client 180. Consulter les exceptions dans `lib/professionalCompensation.ts`
  avant toute generalisation, notamment la part superviseur et l'exclusion d'import de paie.
- Annulation: repartir le montant reel (50 %, 100 % ou autre), pas un tarif complet suppose.
  Annulation sans montant valide exclue avec avertissement.
- Ouverture de dossier: revenu clinique, pas de paie pro. Deplacement: remboursement
  pro integral hors revenu clinique; kilometres = montant / 0,64.
- Nom de professionnel ambigu: avertissement, pas de choix arbitraire.
- Paie et budget partagent les regles. Budget multimois/periode partielle; un nouveau
  calcul enregistre remplace les anciens calculs des mois concernes.
- Frais fixes: montant complet une fois par mois analyse, bornes inclusives, sans prorata.
  Frais variables: dans les dates de la periode.
- Paie administrative en CAD: ajout par mois correspondant, pas une seconde depense fixe.
  Depenses publicitaires synchronisees: remplacement du total mensuel.
- Factures Word: `lib/generatePayrollInvoiceDocx.ts`; courriel avec CC comptable configuree.
  Verification visuelle des quantites/totaux requise.

## Paie des adjointes, acces et satisfaction
- Heures pre-remplies selon `default_schedule`, ajustables; samedi a zero modifiable.
- Taux effectif = salaire mensuel / heures prevues du mois si positifs, sinon taux configure.
  Ferie travaille double; ferie non travaille et vacances au taux normal; absence non payee
  a zero. Pauses soustraites des heures.
- Vacances en heures: droit annuel converti selon le jour planifie moyen puis acquis
  au prorata des heures planifiees jusqu'a la fin du mois consulte; heures utilisees
  soustraites. Pas un calcul de 4 % des salaires reels.
- Ne pas confondre role direction, super administrateur et listes d'acces metier.
  Les helpers de navigation ne remplacent pas API + RLS + Storage.
- Acquisition et gestion Satisfaction sont reservees au compte super administrateur avec
  profil direction charge. Les adjointes n'ont pas acces, y compris par URL ou API directe.
  Import/lecture/modification/envoi Satisfaction exigent `getSuperAdminContext` avant acces
  privilegie. Le profil absent est refuse. Les reponses et desabonnements publics par jeton
  conservent leur parcours. Les RLS Satisfaction verifient aussi le role et l'email du JWT signe;
  le correctif `supabase/satisfaction-super-admin-access.sql` exige une application autorisee.
- Satisfaction: au moins quatre rencontres dans la periode importee; correspondance
  unique du client; tous les destinataires autorises du dossier; pas de nouvelle sollicitation
  d'un client deja contacte/desabonne. Les contraintes SQL participent a cette garantie.
- Satisfaction: periode min/max des rencontres detectee dans Excel et recalculee par
  l'API si aucune periode explicite n'est fournie. Dates impossibles refusees.
  Les nouveaux imports conservent l'analyse (rencontres, exclusions, problemes de
  correspondance) dans `satisfaction_imports.analysis`; migration preparee dans
  `supabase/satisfaction-import-analysis.sql`, a appliquer avec autorisation.
  Les anciens imports sans analyse restent consultables, sans inventer leurs exclusions.
  Recherche sans accents/casse, filtres de professionnel/statut et suivi des reponses.
  Confirmation du destinataire avant envoi reel; aucun envoi automatique a l'import.
  Courriel test: super administrateur uniquement, confirmation et adresse explicites,
  meme modele HTML, liens de demonstration vers `/satisfaction/test`, aucune ecriture
  dans les imports/envois/reponses. Le formulaire partage simule la soumission en mode
  test sans appeler l'API de reponse.
  Le courriel distingue deux choix offerts a tous: avis Google public et sondage prive
  (note globale et commentaire facultatif), sans filtrer selon la satisfaction.
  Les liens de demonstration Google/desabonnement expliquent le parcours sans publier
  d'avis ni changer les preferences. La phrase « Votre suivi avec » est retiree.
- Fichiers marketing prives, accessibles par URL signee temporaire.

## Limites a verifier avant une evolution
- Des sequences multi-tables sont hors transaction (assignation et certains retours/budgets).
  Tester les echecs partiels et la concurrence dans une base isolee.
- Les tests de helpers de droits ne prouvent pas l'application des RLS distantes.
- Certains anciens tests lisent le code/SQL: contrat verifie, pas execution prouvee.
- Le scenario SQL local est sequentiel. Concurrence multi-session, RLS avec JWT distincts
  et parcours navigateur demandent des verifications separees.
