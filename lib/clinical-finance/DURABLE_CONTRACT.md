# Finance persistante du laboratoire — lot6

Ce contrat concerne uniquement `feature/plateforme-clinique`, PostgreSQL local
`pea-clinical-lab` sur127.0.0.1. Le prototype mémoire reste séparé et conservé.
Aucune règle, donnée, paie ou facture de production n'est modifiée.

## Frontières

- Administration : factures, payeurs, règlements, catalogue et relevés administratifs.
- Clinique : uniquement relevés personnels validés/clôturés, sans prix clients,
  payeurs, commissions, noms clients ni lignes comptables internes, y compris PDF.
- Notes cliniques et administration financière gardent des habilitations distinctes.
- Les tables privées ont RLS forcée et aucun accès direct anon/authenticated/service_role.
- Chaque API réauthentifie via GoTrue local, marqueur fictif et capacités SQL.

Les wrappers `lab_billing_query/command` et `lab_fee_query/quote` exigent
un JWT utilisateur. Seuls `lab_billing_batch_service` et
`lab_fee_server_command` acceptent service_role, jamais authenticated/anon.
L'écriture d'honoraires revalide l'acteur administratif, le hash des sources et
contrats sous verrous ; aucun montant de rémunération soumis par le client n'est accepté.

## Factures

Une source d'activité réalisée et sa version, le mandat signé applicable, le tarif
figé, les payeurs et leurs parts alimentent une facture distincte par payeur.
Le professionnel et l'épisode doivent correspondre. Une nouvelle révision de
mandat non signée ne remplace pas silencieusement la convention signée applicable.

Le worker Node démarre uniquement en local-db, au démarrage puis toutes les 60s.
Il classe les rencontres planifiées dont la fin est passée, puis prépare les
factures admissibles immédiatement, sans émission, envoi ni règlement. Il est
désactivé au build et peut être mis en pause avec
`PEA_CLINICAL_BILLING_WORKER=off`. Dans le projet de test isolé, la lecture de
l'agenda et de la facturation déclenche aussi ce traitement après authentification ;
un cron quotidien le rattrape sans consultation. Plusieurs processus restent
protégés par PostgreSQL. Aucun traitement n'est activé dans l'application en service.

L'ouverture60CAD est une source unique par identité permanente, créée à la
confirmation administrative explicite du premier rendez-vous, puis répartie entre
les payeurs. Réassignation/réouverture ne recrée pas les frais. Cette garantie
conservatrice reste à faire approuver pour les exceptions réelles.

Les montants sont en cents. Politique fictive proposée : plus grands restes par
ligne de prestation, égalité par UUID stable du payeur ; chaque ligne et le total
conservent exactement les cents. Ce choix n'est pas une décision officielle.

Le brouillon peut être rafraîchi après correction de durée/km tant que toutes les
parts sont en brouillon, avec version/historique. Après émission manuelle : numéro
unique SIM, texte, octets PDF et empreinte immuables ; corrections par avoirs et
nouvelles opérations, jamais écrasement. Les corrections de payeur après préparation
ne sont pas réaffectées automatiquement : traitement administratif à spécifier.

## Règlements et documents

Paiement partiel/complet, avoir ou remboursement sont des écritures positives
append-only. Le solde signé est total−avoirs−paiements+remboursements.
Les plafonds et versions sont vérifiés sous verrous ; une clé réutilisée pour une
intention différente est refusée. Un remboursement exige un trop-perçu consécutif
à un avoir. Selon Q01, direction et adjointes ont les mêmes droits administratifs,
y compris avoirs et remboursements. Les confirmations, motifs, plafonds,
versions et clés de reprise s'appliquent aux deux ; aucun accès clinique n'en découle.

Les méthodes Carte/Virement/Dépôt sont exclusivement des simulations. Aucun
numéro de carte, CVC, expiration ou véritable token bancaire n'est demandé.
La saisie de tels champs supplémentaires est refusée. Un reçu PDF distinct est
lié à chaque paiement/remboursement ; un avoir conserve son propre document.
Chaque téléchargement vérifie le SHA-256 des octets privés, avec attachment HTTP,
cookie utilisateur et contexte documentaire fixe. Aucune URL de Storage publique.

L'envoi de facture est une simulation explicite avec date/historique, jamais un
statut de livraison de courriel réel. Les anciens historiques d'envoi sont conservés.

### Frontière future Stripe

La comptabilité interne (facture, opération, allocation, reçu, idempotence) reste
indépendante de la méthode. Un futur adaptateur serveur Stripe devra ajouter une
intention tokenisée/provider_reference unique, un état préparé/confirmé/échoué,
des webhooks signés et une réconciliation. Seul le succès bancaire confirmé pourra
créer l'encaissement réel. Les références de carte seront exclusivement celles du
prestataire ; aucun PAN/CVC en SQL, logs, exports ou UI. Chaque débit devra recevoir
une confirmation administrative propre. Aucune clé, SDK, connexion Stripe ou débit
réel/sandbox n'est activé par ce lot ; cette intégration exige une autorisation séparée.

## Honoraires

`calculateProfessionalCompensation` demeure la source des taux/priorités.
L'adaptateur sélectionne le contrat applicable à chaque date ; seuil par rencontres
uniques du lundi au dimanche, y compris contexte voisin hors période mais sans le
rémunérer. Une rencontre multipayeur ne compte qu'une fois. Rapports80%, déplacements
admissibles100%, ouverture exclue, catégories50/60 et60/70 et exceptions existantes
sont conservées. Les alias historiques du calculateur restent privés au serveur.

Contrats append-only datés, relevés préparés puis validés/clôturés manuellement,
snapshots et PDF figés. Périodes chevauchantes refusées. Une correction motivée
crée une révision liée, y compris pour recalculer un brouillon obsolète ; les versions
ne s'additionnent pas en paiements et les ancêtres deviennent consultables seulement.

Les contrats service libre sans règle, annulations/absences sans montant facturé
explicite, sources non émises, avoirs/remboursements et corrections d'activité bloquent
la validation tant qu'une règle ou un traitement explicite n'est pas approuvé.
Aucun montant d'annulation ou effet sur rémunération n'est inventé.

Ordre des verrous : professionnel honoraires → batch facturation global →
professionnel calendrier → sources → factures → activités. Les nouveaux outcomes
ne peuvent entrer entre le contrôle du hash et la validation du relevé.

## API et vérification

- GET `/api/clinical-workspace/billing` : search/status/page1based/pageSize/invoiceId,
  plus `clientId` et `activityId` UUID exacts. La page conserve `?client=UUID&activity=UUID`.
  Les deux scopes se combinent par ET avant total et pagination ; le détail d'une
  facture hors scope est refusé. Les homonymes ne sont jamais rapprochés par ce filtre.
  Activité désigne `calendar_activities.id`, avec toutes ses parts payeurs et sans
  frais d'ouverture. Les projections de préparation/ouverture suivent le même scope.
  Les nouvelles rencontres créent une facture distincte par payeur. Les factures
  regroupées antérieures restent consultables et renvoient `activityIds`, les
  identifiants de toutes leurs rencontres liées : le transport valide le filtre
  sur cette liste, y compris si l'activité demandée n'est pas la première.
  L'ancien DTO à une rencontre conserve
  son `activityId` comme repli strict pour les scénarios SQL historiques.
  Le transport refuse une réponse dont le scope diffère de la requête, et l'interface
  masque l'ancienne projection pendant un changement de périmètre. Les filtres sont
  visibles et retirables, sans modifier l'identité ni les droits du client.
- GET `/billing/fees` : projection administrative ou personnelle selon contexte.
- POST `/billing/commands` : enveloppe stricte {key,action,data}, corps32KiB.
  `invoice.issue` ferme et numérote le brouillon; `receipt.send_demo` journalise
  l'envoi simulé d'un reçu existant sans créer un autre paiement.
- GET `/billing/documents/:id/administration/download` : facture/reçu/avoir.
- GET `/billing/fees/documents/:id/:context/download` : relevé autorisé.

Le client conserve seulement empreinte d'intention+UUID en sessionStorage, sans
montant, nom ou payload financier. Une réponse incertaine conserve la même clé ;
l'ACK confirmé et la relecture sont distincts, pour ne pas répéter une écriture.

`check:full` ajoute les scénarios WASM billing/fees aux suites existantes.
`billing-http.mjs run --fictional-only` est distinct : véritables GoTrue,
deux sessions, concurrence et PostgreSQL local. Il crée de nouvelles fixtures et
conserve un manifeste privé pour une relecture indépendante après redémarrage.
Ne pas relancer aveuglément une période d'honoraires déjà créée : reprendre ou
corriger le relevé existant, sans deuxième rémunération.

Fiscalité, mentions officielles, titre/numéro professionnel, coordonnées complètes,
maquette de facture/reçu et exceptions contractuelles exigent une validation avant
toute activation réelle. Les documents portent leur caractère fictif.

## Extension locale250/260 — activité et absence

La source de facturation `cancellation` est distincte de `activity` et `opening`.
Elle référence `absence_id`/`absence_version`, sans `calendar_activity` fictive.
Les minutes réalisées restent à0 ; `billing_duration_minutes` représente seulement
la durée réservée servant au calcul des frais acceptés. Aucun déplacement ne se
rajoute automatiquement à une absence. La règle J+1 des frais d'absence reste
distincte de la facturation immédiate des rencontres terminées. Les brouillons,
émissions, avoirs, reçus et corrections existants sont conservés.

Les versions de paramètres financiers et leurs payeurs sont liées à une activité
et à la révision de mandat applicable. Les sources gardent la référence
`financial_settings_id`. Les documents/écritures émis ne sont jamais réécrits.
Une exception incompatible avec un nouveau mandat produit
`FINANCIAL_REVIEW_REQUIRED` : l’activité est isolée et le reste du lot continue.

L’entrée interne d’honoraires accepte `meetingEquivalentHalfUnits` (0/1/2).
L’absence à50% compte une demi-unité de rencontre, sans multiplier le compte par
payeur ou déplacement. Le champ est optionnel pour relire les anciens instantanés,
qui conservent leur sémantique historique. Les relevés clôturés restent figés.
