# Noyau clinique — capacités et contrat du laboratoire local

Ce module n'appelle ni Supabase, ni IA, ni messagerie. Le store reste en mémoire du processus : perdu au redémarrage, non durable, données fictives seulement.

## Activation et identité

API fermée (404) sauf si PEA_CLINICAL_FIXTURES=true ET PEA_ISOLATED_DEVELOPMENT=true ET NEXT_PUBLIC_SUPABASE_URL pointe vers localhost/127.0.0.1/[::1]. Aucun module Supabase importé. Sauf GET /actors, en-tête requis X-Clinical-Fixture-Actor : UUID choisi dans la liste SERVEUR.

| ID | Rôle d’affichage | Capacités | Usage |
| --- | --- | --- | --- |
| 11111111-1111-4111-8111-111111111111 | admin | administration | Administration complète, gestion explicite des dossiers/grants ; aucun contenu clinique |
| 22222222-2222-4222-8222-222222222222 | assistant | administration | Exactement les mêmes droits administratifs que direction |
| 33333333-3333-4333-8333-333333333333 | professional | practice | Identités assignées et notes des dossiers explicitement autorisés |
| 44444444-4444-4444-8444-444444444444 | supervisor | practice, supervision | Notes autorisées et cosignature nommée, aucun accès général |
| 55555555-5555-4555-8555-555555555555 | admin | administration, practice | Un seul compte, deux contextes distincts ; grants cliniques toujours requis |

Les autorisations ne découlent jamais du rôle d’affichage. ClinicalActorInput =
string | {actorId,context:'administration'|'clinical'}. Une chaîne est une commodité
des anciennes fixtures à contexte unique ; le compte double doit toujours fournir
un contexte explicite. La résolution ne modifie aucun singleton. Les API durables
construisent l’acteur depuis leur session vérifiée ; un header fixture n’est jamais
une identité de session locale.

L’en-tête X-Clinical-Context sélectionne le contexte de chaque requête fixture.
canAdmin exige administration + capacité administration ; canPractice exige
clinical + practice ; canSupervise exige clinical + supervision. Une capacité
administrative n’accorde aucune lecture clinique, même au même compte en contexte
administration. Les capacités sont obligatoires, sans repli sur role.

Deux homonymes restent deux UUID. Contact, représentant et payeur sont distincts. Créer un épisode ou préparer un lien d'assignation ne crée PAS un dossier clinique.
Un épisode porte au plus un dossier clinique : un nouveau dossier exige un nouvel épisode. La cosignature exige la capacité supervision, le contexte clinique et un grant explicite `canCosign` sur le même dossier, en plus de la désignation dans la note ; une capacité seule ne donne aucun accès.

## Types JSON (types.ts fera autorité)

WorkspaceView = { mode:'isolated_fixture'|'isolated_local'; durable:boolean; context:'administration'|'clinical'; actor:FixtureActor; actors:FixtureActor[]; clients:ClientAdminProjection[]; records:ClinicalRecordSummary[]; managedRecords:ClinicalRecordSummary[]; noteTypes:{id:ClinicalNoteType;label:string;sections:{id;title}[]}[]; audit:ClinicalAuditEvent[] }

FixtureActor = {id;displayName;role:'admin'|'assistant'|'professional'|'supervisor';permissions:('manage_clinical_access')[];capabilities:('administration'|'practice'|'supervision')[];context?:'administration'|'clinical'}. Les réponses résolues renseignent context. `permissions` conserve le libellé de gestion pour compatibilité ; la capacité administration et le contexte déterminent le droit. `managedRecords` expose seulement les métadonnées en administration ; `records` exige contexte clinique et grant explicite.

ClientAdminProjection = {id;firstName;lastName;birthDate:string|null;createdAt; administrativeRecord:{id;clientId;administrativeNotes:string;version:number}; contacts:{id;clientId;fullName;relationship;email;phone}[]; representatives:{id;clientId;fullName;relationship;authorityVerified:boolean}[]; payers:{id;clientId;fullName;payerType:'self'|'parent'|'organization';email}[]; requests:{id;clientId;service;requestedAt;administrativeReason;status}[]; episodes:{id;clientId;requestId:string|null;label;status;openedAt;closedAt}[]; assignmentLinks:{id;clientId;episodeId;source:'fixture_assignment';externalAssignmentId}[]; assignments:ClientAssignment[] }

ClinicalRecordSummary = {id;clientId;episodeId;label;status;members:RecordGrant[];grantRevision:number;createdAt}
RecordGrant = {actorId;canRead:boolean;canWrite:boolean;canCosign:boolean;requiresCosignature:boolean;supervisorId:string|null}

En contexte clinique, la projection masque payeurs, notes administratives, motifs administratifs des demandes et assignmentLinks. Un grant de dossier ou une assignation active au praticien ouvre seulement l’identité/contacts et les épisodes/demandes associés ; les assignments renvoyés sont uniquement les siens encore actifs. Un compte avec seule capacité administration ne peut recevoir de grant clinique ; un compte double le peut, puis doit choisir le contexte clinique.
ClinicalRecordView = {record:ClinicalRecordSummary;client:ClientAdminProjection;notes:ClinicalNoteSummary[];audit:ClinicalAuditEvent[]}
ClinicalNoteSummary = {id;recordId;noteType;title;encounterDate:string|null;authorId;status:'draft'|'awaiting_cosignature'|'signed';version;amendsNoteId:string|null;amendmentReason:'correction'|'clarification'|'supplement'|null;appointmentId:string|null;appointmentSnapshot:ClinicalAppointmentSnapshot|null;createdAt;updatedAt;signedAt:string|null;requiresCosignature:boolean;supervisorId:string|null}
ClinicalNoteView = {note:ClinicalNoteSummary;content:Record<sectionId,string>;versions:NoteVersion[];signatures:NoteSignature[]}
NoteVersion = {version;content:Record<sectionId,string>;title;encounterDate;noteType;status;appointmentId;appointmentSnapshot;actorId;createdAt;kind:'create'|'save'|'sign'|'cosign'}
NoteSignature = {actorId;signedAt;version;kind:'author'|'supervisor';contentHash:sha256}. Le hash concerne le même contenu clinique pour l’auteur et le cosignataire; cette attestation locale ne constitue pas une signature qualifiée.

records contient uniquement les dossiers explicitement autorisés en contexte clinique : [] en contexte administration. Ceux-ci ne reçoivent aucune note/version/contenu même avec UUID connu. Journal : identifiants/actions/version/horodatage uniquement, aucun texte clinique/titre/motif libre. Pro/superviseur ne voient que leurs patients autorisés et leurs événements de dossier.

## API /api/clinical-workspace

Réponses private,no-store, Vary:X-Clinical-Fixture-Actor,X-Clinical-Context. Erreurs {error,code}, statuts 400/403/404/409/413. Champs inconnus refusés. GET /actors ne nécessite pas d'acteur mais reste soumis au triple verrou d'environnement.

| Méthode/chemin | Corps | Réponse |
| --- | --- | --- |
| GET /actors | — | {actors,mode:'isolated_fixture',durable:false} |
| GET / | — | {workspace:WorkspaceView} |
| GET /clients | — | {clients} |
| POST /clients | {firstName,lastName,birthDate?} | {client}, 201 |
| PATCH /clients/:id | {expectedVersion,administrativeNotes} | {client}, CAS obligatoire |
| POST /clients/:id/contacts | {fullName,relationship?,email?,phone?} | {client}, 201 |
| POST /clients/:id/representatives | {fullName,relationship,authorityVerified} | {client}, 201 |
| POST /clients/:id/payers | {fullName,payerType,email?} | {client}, 201 |
| POST /clients/:id/requests | {service,administrativeReason?} | {client}, 201 |
| POST /clients/:id/episodes | {requestId?,label} | {client}, 201 |
| POST /clients/:id/assign | {requestId,professionalId,label} | {client}, 201, contexte administration |
| POST /clients/:id/assignment-links | {episodeId,externalAssignmentId} | {client}, 201 |
| POST /records | {clientId,episodeId,label,members:RecordGrant[]} | {record}, 201, contexte administration |
| GET /records/:id | — | {record:ClinicalRecordView} |
| GET /records/:id/appointments | — | {appointments:ClinicalAppointmentSnapshot[]}, auteur avec grant écriture |
| PATCH /records/:id/access | {expectedRevision,members:RecordGrant[]} | {record:ClinicalRecordSummary}, capacité et contexte administration |
| POST /records/:id/notes | {noteType,title?,encounterDate?,content?,appointmentId?} | {note:ClinicalNoteView}, 201 |
| GET /notes/:id | — | {note:ClinicalNoteView} |
| DELETE /notes/:id | {expectedVersion} | {id,removed:true}, auteur autorisé, brouillon ou signée |
| PATCH /notes/:id | {expectedVersion,content,title?,encounterDate?} | {note:ClinicalNoteView} |
| POST /notes/:id/sign | {expectedVersion,attested:true} | {note:ClinicalNoteView} |
| POST /notes/:id/cosign | {expectedVersion,attested:true} | {note:ClinicalNoteView} |
| POST /notes/:id/amend | {expectedVersion,reason:'correction'|'clarification'|'supplement'} | {note:ClinicalNoteView}, 201 |
| GET /audit | — | {events} |

Content = {document:string} pour la rédaction continue ou les anciens sectionId:string issus de clinicalNoteBlueprints, sept types clinicalNoteTemplates existants. Les deux formes ne se mélangent pas. expectedVersion obligatoire et monotone : conflit409 sans écrasement/relance. Chaque save crée une version immuable. Signer verrouille le texte immédiatement ; supervision requise → awaiting_cosignature jusqu'au superviseur nommé, sinon signed. Amendement : nouvelle note liée à la note signed, original jamais altéré ; auteur original seulement. La suppression demandée par l'auteur retire même une note signée de la consultation du dossier, mais conserve les versions et signatures privées et la preuve immuable du retrait; aucune restauration applicative n'est exposée.

Dans le mode PostgreSQL fictif, `GET /notes/:id/pdf` renvoie le PDF après contrôle d'accès au dossier. Le lien de consultation peut porter `?context=clinical` lorsque le lecteur PDF du navigateur ne peut pas envoyer l'en-tête `X-Clinical-Context`; la session et le droit clinique restent obligatoires. Le navigateur intégré peut bloquer le lecteur PDF : la fiche propose alors un aperçu du texte et le téléchargement du PDF exact.

Limites d’entrée : 96 KiB de JSON réellement lus (pas seulement Content-Length), titre 120 caractères, section 6000, contenu total 24000. Dates réelles ISO YYYY-MM-DD, naissance non future. Brouillon vide permis, signature vide refusée, attestation humaine `true` requise. Un dossier fermé bloque create/save/sign/cosign/amend; sa lecture reste soumise aux grants. Si la règle de supervision a changé depuis la création d’un brouillon, sa signature est refusée plutôt que de contourner la nouvelle règle.

Gestion des accès : grantRevision commence à 1, expectedRevision obligatoire, remplacement complet de members atomique puis +1. Une ancienne révision produit409 sans écrasement. [] révoque tous les accès cliniques. Retirer un superviseur est toujours possible; les notes dépendantes restent verrouillées ou non signables jusqu’à rétablissement d’un accès cohérent. Les snapshots des notes ne sont jamais réécrits par ce mécanisme. Le journal append-only conserve accessChanges:[{actorId,previous:RecordGrant|null,next:RecordGrant|null}] avec identifiants et booléens seulement, jamais de contenu clinique. La capacité administrative ne donne toujours aucune lecture clinique.

## Rattachement facultatif à une rencontre

ClinicalAppointmentSnapshot = {id;recordId;clientId;professionalId;startAt;endAt;modality:'office'|'home'|'phone'|'video';status:'planned'|'completed';version}. Les dates sont des instants UTC canoniques et la durée est positive, au maximum 12 heures. Le snapshot vient uniquement d’un provider serveur injecté; le navigateur fournit seulement appointmentId. Le même dossier, client et auteur professionnel sont exigés. Un superviseur ne peut pas rédiger une note rattachée au rendez-vous d’un autre intervenant. Une date de rencontre explicitement saisie doit correspondre au jour local America/Toronto du snapshot; aucune date n’est déduite automatiquement.

Le lien est créé une seule fois, conservé dans chaque version et dans le hash, et refusé dans PATCH de note. Un rendez-vous planned ou completed peut être choisi; une source planned n’est jamais présentée comme une séance effectuée. Cancelled/no_show sont refusés. Avant la signature d’une note originale, la source est revérifiée : changement de client/dossier/auteur/horaires/modalité ou disparition/annulation donne409, avec texte et snapshot conservés. Une évolution planned→completed et son incrément de version technique restent compatibles; le snapshot initial n’est pas réécrit. La cosignature atteste le snapshot auteur déjà verrouillé. Un amendement conserve la référence historique de sa note signée et ne la résout pas de nouveau contre l’agenda courant.

ClinicalServiceOptions.appointments est un provider synchrone list/resolve minimal, sans accès aux notes. Il est appelé après une préautorisation, hors transaction mémoire, puis le grant courant est revérifié dans la transaction. L’absence de provider bloque503 toute liaison demandée; créer sans lien reste possible. La composition dans lib/clinical-workspace/fixtureComposition.ts relie les domaines sans import circulaire : core n’importe pas calendrier et calendrier ne lit aucune note. Les endpoints HTTP gardent leur triple verrou avant de charger cette composition.

## Service pur injectable

createClinicalService({store,now,newId,appointments?}) : listClients/createClient/updateAdministrativeRecord/addContact/addRepresentative/addPayer/createRequest/createEpisode/assignRequest/linkAssignment/createClinicalRecord/updateClinicalAccess/getClinicalRecord/listNotes/listNoteAppointments/createNote/getNote/saveNote/signNote/cosignNote/amendNote/getWorkspace/listAudit/getSchedulingDirectory. Premier argument ClinicalActorInput. AdministrativeRecord commence à version1 ; update exige expectedVersion, ajoute1 après validation et refuse409 sans écrasement si obsolète. Retours copiés, store non exposé par API. Mutations synchrones atomiques en mémoire ; horloge et générateur UUID injectables pour tests hors ligne.

getSchedulingDirectory(actorId) = {actors;clients:[{id,firstName,lastName}];records:[{id,clientId,status,members}]}. Admin/assistant voient la métadonnée de planification; pro/super seulement leurs dossiers autorisés. Aucun libellé clinique, contenu, payeur ou note administrative. Une lecture est auditée sous le demandeur réel, sans impersonation d’un autre acteur. La fixture d’usine a une horloge fixe pour les tests; le singleton HTTP horodate les actions nouvelles avec l’horloge serveur.

## Pont d’assignation locale (lot2C)

ClientAssignment = {id;clientId;requestId;episodeId;professionalId;
status:'active'|'closed';assignedAt;closedAt:string|null}. assignRequest exige
un client et une demande existante ouverte, un professionnel avec practice,
un label borné ; il crée atomiquement un épisode et une assignation normalisée,
puis ferme la demande. Répéter une demande fermée/assignée donne409 en mémoire.
Le journal garde l’acteur réel sans motif clinique.

Ce pont n’appelle pas le module d’assignation legacy du dépôt principal et ne prouve
pas sa parité. assignmentLinks manuels de provenance restent distincts. Une
assignation ne crée jamais de dossier clinique ni de grant, et ne donne aucun
accès à une note. Une assignation active permet au praticien en contexte clinique
de voir la fiche d’identité et les contacts associés ; sa clôture ou le retrait
de practice retire cet accès si aucun grant distinct ne subsiste. L’identité
client est permanente, sans fusion des homonymes.

Le store vérifie FK logiques, unicité demande/épisode/ID, statut/date cohérents,
liens immuables et interdiction de suppression d’une assignation ; toute erreur
annule toute la transaction, y compris demande/épisode/audit. Une capacité peut
être retirée sans effacer l’historique administratif d’une assignation.

## Limites

Identité sélectionnable = simulation, pas Auth production. Aucun envoi, upload réel, facture, paiement ou IA. Pas de conservation durable/signature réglementaire. Le SQL futur doit refaire respecter les invariants indépendamment du TypeScript.
Le singleton est partagé par les graphes de routes au moyen d’une propriété globalThis privée au processus; plusieurs processus distincts auraient chacun leur propre fixture. Les scripts SQL de référence et le store mémoire restent indépendants. Un adaptateur serveur local-db est développé séparément dans lib/clinical-local, avec session Supabase locale, marker fictif et RPC contextuelles ; ce n’est pas une bascule automatique vers la production. Le mode isolated_local/durable:true est réservé à cet adaptateur, jamais au store mémoire. Sa réception réelle (Auth, Docker, redémarrage, multi-connexion et restauration) doit être démontrée séparément. Les tests PGlite du seed compilent une structure Auth simulée et ne prouvent pas GoTrue. Aucun contrôle local ne prouve une configuration de production.
