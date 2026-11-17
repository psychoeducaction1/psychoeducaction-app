# Contrat de raccordement local2C

Statut : exécution autorisée dans le laboratoire fictif uniquement. Types dans types.ts.
Aucun ancien endpoint n'est réactivé. Un seul moteur d'écriture durable SQL210.

## Transport et réponses

GET /api/clinical-workspace/admission -> { workspace: AdmissionWorkspace }.
POST /api/clinical-workspace/admission/commands -> {action,id:null|UUID,data:object}.
Idempotency-Key UUID obligatoire ; X-Clinical-Context obligatoire ; cookie/JWT réel.
Réponse201 (création) ou200 (autre) : AdmissionCommandResult.
Les RPC sont lab_admission_query(p_context,p_action='workspace',p_id=null) et
lab_admission_command(p_context,p_action,p_id,p_data,p_request_key).
Le client utilise clinicalRequest avec /admission ou /admission/commands :
les intentions SHA256+UUID restent privées et aucune écriture mémoire de secours.
Les filtres/page/sélection sont dans l'URL et la pagination UI porte sur la projection
autorisée du serveur. Pas de troncature silencieuse ; un volume excessif doit échouer
explicitement au lieu d'afficher une liste faussement complète.

## Corps des commandes (les champs inconnus sont refusés)

- prospects.create : firstName,lastName,birthDate?,service?,consultationReason?,
  internalNotes?,requesterNames?,emails?,phones?,address?,modalities?,availability?,
  contactRequestType (rapid_callback|appointment),startAt? (UTC canonique),sourceLabel?.
  Un créneau est requis pour appointment. Pas de patient créé avant transfert.
- prospects.outcome : expectedVersion,outcome(service_not_taken|other),details.
- prospects.transfer : expectedVersion,priority,consultationReason,service,
  existingClientId? (lien explicite seulement). Retourne admission et même patient au retry.
- prospects.followup : expectedVersion,startAt,details. Autre + suivi atomiques ;
  même prospect, status scheduled, historique conservé.
- calendar.block : startAt,endAt,reason. calendar.unblock : expectedVersion.
- admissions.create : firstName,lastName,birthDate?,existingClientId?,
  service,consultationReason,priority,contactDate?,internalNotes?,requesterNames?,
  emails?,phones?,address?,modalities?,availability?.
- admissions.update : expectedVersion,expectedIdentityVersion?, firstName?,lastName?,
  birthDate?, et champs AdmissionDetails/priority/contactDate à modifier.
  Si identité corrigée : CAS commun patient par identityVersion, pas seulement case.
  Les contacts créés pour cette admission sont liés à leur source ; ne pas effacer
  les contacts d'autres demandes. Historique d'assignation garde un snapshot du motif.
- admissions.assign : expectedVersion,professionalId. Crée pending, jamais taken caché.
- admissions.process : expectedVersion,professionalId? ; processus to_contact.
- admissions.classify : expectedVersion,reason,classification(off_platform|closed|blacklisted).
- admissions.restore : expectedVersion,reason.
- capacities.create : professionalId?,requestedCount,comment?,offerSlots?,schedulePreference? ; pro cible propre identité,
  admin cible explicite. Quantité0..500, commentaire300. Zéro = inactive. Avec offre du calendrier,
  `offerSlots` accepte historiquement 1..60 plages datées `{day,startMinute,endMinute}` d'une à quatre heures entières ; l'interface actuelle n'en crée que d'une heure,
  non chevauchantes et situées dans les 180 prochains jours (heure de Toronto).
  `requestedCount` représente des nouveaux clients et ne dépasse pas la somme des heures offertes :
  un client correspond à un premier créneau d'une heure. Préférence `grouped`, `spread`, `flexible`
  ou `other` (commentaire obligatoire). La proposition ne réserve pas le calendrier et emprunte
  le même compteur de capacité et les mêmes droits d'assignation que la demande classique.
- capacities.update : expectedVersion,requestedCount,comment,enabled.
  Une demande complétée n'est pas rouverte silencieusement : nouvelle demande explicite.
- preferences.update : expectedVersion,preferences (ProfessionalStructuredPreferences).
  id = professionnel ; même droit propre/admin que capacité, pas de modification des rôles.
- processes.update : expectedVersion,professionalId?,responsibleActorId?,status?,details?.
  Status ajustable non terminal seulement ; finales par commandes dédiées.
- processes.contact : expectedVersion,channel(call|voicemail|sms_manual|email_simulated),
  occurredAt (UTC),note,outcome(no_response|waiting_response|interested|other).
  Texto = déclaration manuelle ; email = simulation explicite seulement.
  Première absence de réponse crée une seule tâche48h depuis premier contact.
- processes.assign : expectedVersion. Confirme taken auprès du pro envisagé,
  place recalculée sous verrou ; clôture tâches et garde événements.
- processes.classify : expectedVersion,reason ; refus motivé, sans assignation.
- processes.return : expectedVersion,reason ; retour attente.
- processes.reopen : expectedVersion,reason ; depuis historique, annule assignation
  liée si nécessaire, nouvelle démarche active sans suppression de traces.
- assignments.result : expectedVersion,outcome(not_contacted|pending|taken|not_taken),reason?.
  Motif obligatoire pour refus ; Autre exige précision selon helper existant.
  Une assignation annulée ne se réactive pas ici.
- assignments.return : expectedVersion,reason ; annule et remet en attente avec traces.
- tasks.create : admissionId,processId?,title,dueAt,kind?,targetProfessionalId?.
  `assignment_support` exige un professionnel actif et une admission encore en attente ;
  une seule tâche de ce type reste active par admission. Elle apparaît dans les
  tâches administratives sans retirer le client de la liste d’attente.
  tasks.complete : expectedVersion.
- notifications.simulate : admissionId,assignmentId?,processId?,
  kind(client|professional|internal),subject,body.
  Destinataire inféré des liens serveur, domaine fictif seulement ; aucun appel fournisseur.
  status simulated signifie uniquement simulation enregistrée, jamais livré.
- notifications.review : id de notification préparée, decision(simulate|skip),
  to?,cc?,subject?,body?. L'administration révise le courriel d'assignation
  dans l'éditeur commun; seules les adresses `.invalid` sont acceptées.
  L'original reste immuable et la révision lui est liée.
- lab_admission_run_reminders(p_now) : RPC réservée au service_role et au
  laboratoire fictif. Cron authentifié quotidien ; après trois jours sans réponse,
  une notification groupée par professionnel et une revendication immuable par
  assignation empêchent le double rappel. Aucune livraison externe.

## Modèle et invariants

Conserver patients/service_requests/service_episodes/lab_assignments/care_cases/grants.
Prospect distinct ; patient créé seulement au transfert ou création d'attente.
Une admission par service_request ; patient permanent dérivé par FK.
Demandes de capacité distinctes des service_requests.
Un nouveau cycle de réassignation crée TOUJOURS un nouvel épisode, conserve ancien
épisode/dossier/notes/grants ; ne ferme pas automatiquement un dossier clinique.
Remplacer UNIQUE global lab_assignments.request_id par unicité partielle active ;
episode_id reste unique par assignation. Plusieurs assignations successives autorisées.
L'ancien clients.assign/lab_assign_request DOIT déléguer au moteur210 avec capacité,
ou être refusé explicitement. Aucune ancienne clé ne ressuscite une assignation annulée.
Les assignations déjà présentes sans capacité/admission restent lisibles dans une
section antérieure ; ne pas inventer une demande professionnelle ni les supprimer.
outcome initial non documenté = not_contacted, aucune confirmation taken inventée.

Places = not_contacted+pending+taken non annulés. Pris = taken seulement.
Une demande active peut avoir zéro place si confirmations en attente.
Refus/annulation libèrent ; inactive reste inactive ; completed seulement si taken>=quantité.
Une démarche envisagée ne réserve pas encore de place.
Retour/hors plateforme générique refusé si assignation occupante ou démarche active.
Toutes transitions, compteurs, événements, tâches, reçu et audit sont atomiques.
CAS sur identité/admission/processus/capacité/assignation/préférences/bloc/tâche.
Rejeu = même intention hashée, autorisation courante avant reçu, projection fraîche.

Données identiques : réutiliser règle waitingListDuplicates (tous renseignements),
jamais le nom seul. Ne pas fusionner deux patients existants ; proposer/retourner
la demande identique sans mutation cachée de leurs identités.
Calendrier admission distinct du clinique : Toronto,15min+15tampon,préavis120min,
horaires existants publicIntakeSchedule, conflits appels+blocages sous verrou.
Le simple dépassement de l'heure ne termine jamais un appel.
Au transfert, seuls appels déjà passés sont terminés, pas les futurs.

Droits : admin+adjoint mêmes actions administratives. Pratique propre seulement.
Professionnel reçoit uniquement ses demandes, assignations/historiques et motifs
explicitement partagés ; pas de prospects non affectés, internalNotes, payeurs,
notes cliniques ou prix clients. Aucune création automatique de case/grant.
Tables/helper bruts interdits anon/authenticated/service_role ; wrappers auth seulement.
Audit technique IDs/actions/versions, pas de motif ni corps de communication.
L'historique métier privé peut conserver motifs de refus/contacts autorisés.
Transport email/SMS/IA externe absent, anciennes routes fermées. Les courriels
d'assignation sont préparés et révisables; prise en charge et rappel trois jours
sont simulés et ne sollicitent pas Resend.

## Réemploi et réception

Réutiliser shared.ts (statuts/refus/compteurs), professionalMatching,
professionalPreferences/Editor, prospectsWorkspace, publicIntakeSchedule,
waitingListDuplicates et waitingListFilters. Ne pas recopier les écritures multi-requêtes.
UI sous shell : appels(calendrier/àtraiter/historique), attente/historique clients,
démarches(actif/historique), demandes pro, préférences, assignations/historique.
Vraies URLs, recherche/pagination, lien vers identité permanente, erreurs/conflits,
brouillons conservés ; notifications clairement simulées.
Tests SQL/Node hors ligne puis Auth/HTTP réels, dernière place concurrente,
rollback audit/événement/reçu, homonymes, retours et nouvelle assignation,
retrait de droits, redémarrage et restauration. Aucun nettoyage pour rendre vert.

