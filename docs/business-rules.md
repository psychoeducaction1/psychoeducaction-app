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
- Une demande active avec place restante est requise avant creation de l'assignation;
  les actions de suggestion ne creent pas silencieusement une demande en plus.
- Un refus exige un motif; `Autre` exige une precision. Utiliser les helpers de
  `app/professionnel/shared.ts` pour traduire et valider les statuts.
- Confirmer directement un service cree `contacted=true`, `is_active=true` et recalcule.
- Reouvrir une demarche historique ou retourner un client en attente doit annuler
  l'assignation liee si necessaire, recalculer et conserver les traces historiques.
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
  La route PATCH accepte aussi `service_taken`: elle ne transfere pas elle-meme un dossier.
- `service_not_taken` et `other` exigent une justification. Historique de l'interface:
  prospects refuses et transferes; les autres restent a traiter.
- Reservation: hold non expire, puis booking idempotent. Conserver verrous SQL et
  contraintes anti-doublon; un controle UI ne les remplace pas.
- `appointmentId` interne. `conversionEventId` = UUID distinct, stable au retry,
  seul identifiant de reservation autorise dans le dataLayer avec le type d'evenement.
- Attribution: liste de champs techniques autorises, jamais les informations du formulaire.
  Le succes metier ne depend pas du succes d'une notification.
- Fuseau Toronto; lundi-vendredi de 8 h a 18 h, samedi de 12 h a 15 h 30, dimanche ferme.
  Pas de reservation dans les deux prochaines heures; appel 15 min + tampon 15 min.
- Deplacement: identifiants conserves. Annulation: rendez-vous inactif.
- Doublon potentiel = contact normalise deja present; avertissement distinct d'une
  soumission idempotente. Ne pas fusionner des dossiers sur un nom seul.

Sources: `lib/publicIntakeSchedule.ts`, `lib/publicIntakeValidation.ts`,
`lib/publicIntakeSecurity.ts`, routes `app/api/public/intake/`,
`supabase/public-intake-calendar.sql`, `supabase/prospect-direct-waiting-list-transfer.sql`.

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
- Satisfaction: au moins quatre rencontres dans la periode importee; correspondance
  unique du client; tous les destinataires autorises du dossier; pas de nouvelle sollicitation
  d'un client deja contacte/desabonne. Les contraintes SQL participent a cette garantie.
- Fichiers marketing prives, accessibles par URL signee temporaire.

## Limites a verifier avant une evolution
- Des sequences multi-tables sont hors transaction (assignation et certains retours/budgets).
  Tester les echecs partiels et la concurrence dans une base isolee.
- Les tests de helpers de droits ne prouvent pas l'application des RLS distantes.
- Certains anciens tests lisent le code/SQL: contrat verifie, pas execution prouvee.
- Le scenario SQL local est sequentiel. Concurrence multi-session, RLS avec JWT distincts
  et parcours navigateur demandent des verifications separees.
