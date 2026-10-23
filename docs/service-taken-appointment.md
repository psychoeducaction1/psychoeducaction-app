# Premier rendez-vous lors d'un service pris direct

Validé en développement le 23 octobre 2026. Les migrations d’assignation et de
civilité ont été appliquées en production après autorisation explicite :
3 profils M., 22 profils Mme, aucun rendez-vous ajouté aux dossiers historiques.
Version applicative publiée sur main (commit 9bd8b7c), déploiement Vercel confirmé Ready; aucun envoi réel effectué.

## Parcours

Dans **Assignations en cours**, le bouton **Confirmer le service pris** ouvre un
formulaire de confirmation. Il exige la date du premier rendez-vous, l'heure au
Québec et une modalité : visioconférence, présentiel à domicile, bureau de Montréal
ou bureau de Longueuil. Annuler le formulaire ne modifie aucun statut.

La validation est également faite sur le serveur, avant mutation. L'assignation,
le statut service pris, les compteurs, la fin de démarche et les détails du
rendez-vous sont confirmés dans une même transaction. La date d'assignation
reste distincte de la date du rendez-vous. Cette saisie confirme le rendez-vous
convenu par l'équipe; elle n'ajoute aucune réservation à un calendrier externe.

L'instant UTC et les date/heure locales `America/Toronto` sont conservés dans
`assigned_clients.service_appointment`, avec la modalité et l'adresse du bureau
au moment de la confirmation. Les dates impossibles, heures inexistantes et
heures ambiguës lors des changements d'heure sont refusées. L'historique de
démarche reprend aussi ces renseignements. Aucun rendez-vous n'est inventé ou
ajouté aux assignations historiques.

## Courriel

Le parcours existant est conservé : le client reçoit la confirmation et le
professionnel est en copie conforme. Tous deux voient la même date, heure,
modalité et, pour un bureau, la même adresse. Les valeurs envoyées sont relues
depuis l'assignation; des dates ou adresses envoyées dans le body de notification
ne peuvent pas les remplacer.

Après la création, une fenêtre `EmailComposerModal` présente le sujet et le texte
modifiables avant envoi. Les destinataires sont affichés en lecture seule et
relus par le serveur. L'action `preview` ne fait aucun envoi; seule l'action
explicite `send`, avec sujet et message valides, appelle le fournisseur.
Fermer ou désactiver le courriel conserve l'assignation sans envoi. L'historique
permet de rouvrir la confirmation après fermeture ou rechargement; un envoi déjà
audité est refusé comme répétition. Un échec laisse l'éditeur ouvert avec son
texte modifié pour réessayer. Après fermeture, la réouverture reconstruit le modèle
depuis les données enregistrées (les modifications non envoyées ne sont pas sauvées).
Modifier le texte ne modifie pas le rendez-vous enregistré. Le HTML est reconstruit
côté serveur à partir du texte échappé; aucun HTML fourni par le navigateur n'est envoyé.
Le sujet est limité à 300 caractères sans saut de ligne, le message à 30 000.
L'audit conserve un indicateur de personnalisation, sans recopier le texte du message.

- **Visioconférence** : lien envoyé par le professionnel le jour du rendez-vous,
  invitation à vérifier les courriels indésirables. Aucune adresse de bureau.
- **Montréal** : 1600, boulevard Henri-Bourassa Ouest, Montréal (Québec) H3M 3E3,
  bureau 233 (2e étage). Adresse fournie par la direction dans cette demande.
- **Longueuil** : 401, chemin du Coteau-Rouge, Longueuil, J4J 1X5. Adresse déjà
  présente dans le dépôt, conservée pour ce parcours.
- **À domicile** : modalité confirmée, sans inventer une adresse domiciliaire
  depuis la ville du dossier. Aucune consigne d'accès aux bureaux.

Les deux adresses ont des valeurs par défaut côté serveur dans
`lib/serviceAppointmentServer.ts`. Les variables facultatives
`SERVICE_APPOINTMENT_MONTREAL_ADDRESS` et `SERVICE_APPOINTMENT_LONGUEUIL_ADDRESS`
permettent de les actualiser ultérieurement. Une adresse actualisée ne change
pas les rendez-vous déjà confirmés.

Les consignes d'arrivée à l'heure exacte, d'attente à l'extérieur et d'ouverture
de porte concernent Longueuil seulement. Aucune de ces consignes à Montréal.
L'envoi utilise une clé fournisseur stable par assignation et vérifie
l'audit d'un envoi précédent. L'échec du courriel n'annule pas un service pris
déjà confirmé; l'interface signale alors l'échec. Une assignation historique sans
renseignements de rendez-vous ne peut pas produire cette nouvelle confirmation.

## Activation à valider

Avant la version applicative, appliquer aussi `supabase/professional-civility.sql`
sur développement isolé. Le champ `profiles.professional_civility` accepte M. ou
Mme, sans valeur par défaut. La direction le modifie dans la liste des profils
actifs ou archivés et le choisit à l'invitation; le profil l'affiche. Le serveur,
une contrainte SQL et un trigger protègent les valeurs et les droits. Les RLS
restent applicables. Sans civilité, le courriel utilise une formulation neutre.

Le script ponctuel `supabase/professional-civility-initialization.sql` prépare la
consigne explicite reçue : M. pour Patrick, Louis-Nicolas et Hicham, Mme pour les
autres profils professionnels existants. Revoir le roster avant exécution; un
prénom absent ou ambigu annule toute initialisation et nécessite de confirmer
les UUID. Les valeurs déjà saisies sont conservées. Ne pas réutiliser ce script
pour les nouveaux profils. Aucune initialisation de production effectuée.

La confirmation commence par « Bonjour, ». Le nom complet du client apparaît
une seule fois, dans la phrase « Nous avons le plaisir de vous confirmer un
rendez-vous avec [civilité et nom], dans le cadre du dossier de [client] à la
Clinique PsychoÉducAction. » Le rappel des indésirables est en gras dans le HTML;
les valeurs sont échappées et une version texte équivalente est conservée.

Tests supplémentaires : `tests/professionalCivility.test.ts` et
`node scripts/test-professional-civility.mjs` avec `PGLITE_MODULE_PATH`.

1. Vérifier le schéma de développement et les prérequis de
   `supabase/waiting-list-assignment-transactions.sql`, déjà préparé localement.
2. Appliquer ensuite, seulement sur une base isolée autorisée,
   `supabase/service-taken-appointment.sql`. Ce script ajoute le champ JSON et
   le RPC `create_scheduled_waiting_list_assignment`; aucun backfill.
3. Les mutations passent uniquement par les routes autorisées direction. Le RPC
   reste réservé au serveur et recontrôle les droits via le RPC transactionnel
   de base. Une modification navigateur directe des détails confirmés est refusée.
4. Valider l'interface et les quatre modalités sur des données fictives. Aucun
   envoi réel requis pour les tests unitaires. La publication et les migrations
   de production restent soumises à une autorisation explicite distincte.

## Vérifications

`tests/serviceAppointment.test.ts` couvre les champs obligatoires, les quatre
modalités, le fuseau, les changements d'heure et le modèle de courriel. Son helper
exerce la vraie route de notification hors ligne : droits, service non confirmé,
assignation annulée, ancien dossier sans rendez-vous, données incohérentes, audit
indisponible, envoi déjà fait, données persistées et copie professionnelle.

Le helper des routes d'assignation exerce aussi la vraie création avec le rendez-vous
et une adresse fournie par le navigateur qui doit être ignorée.

Le script `scripts/test-service-appointment.mjs` nécessite `PGLITE_MODULE_PATH`
vers un module PGlite local installé séparément, puis :

```powershell
node --import ./tests/register-aliases.mjs --experimental-strip-types scripts/test-service-appointment.mjs
```

Il construit uniquement une base en mémoire avec des fixtures fictives et exécute
les deux vraies migrations. Sont vérifiés : persistance des quatre modalités,
service pris et tâche finalisés ensemble, historique, répétition idempotente,
conflit de rendez-vous sur une même clé, rollback d'une erreur après la création
initiale, absence de reçu orphelin et refus des modifications non autorisées.
Cela ne remplace pas un essai à plusieurs connexions Supabase ou une validation
visuelle dans un navigateur connecté à une base de développement.

Contrôle local après civilités et aperçu modifiable : `npm run check` réussi,
**248 tests**, types et lint; trois
avertissements lint préexistants. Le script PostgreSQL embarqué ci-dessus a
également réussi. Le build Webpack a compilé, vérifié TypeScript et généré les
pages, puis s'est arrêté sur l'alerte de sécurité Next.js déjà observée dans le
chantier précédent. Les dépendances n'ont pas été modifiées. L'interface connectée
à une base de développement reste à essayer avant une activation.

Le test PostgreSQL des civilités a aussi réussi, en mémoire : valeurs autorisées,
initialisation répétée, absence de défaut pour les futurs profils, refus d'un
prénom ambigu, droits direction et refus d'un compte privé d'accès. Le helper
de notification vérifie l'aperçu sans envoi, la personnalisation, l'envoi explicite,
les limites de saisie, les destinataires persistés et l'échappement HTML.

## Vérification de la livraison isolée

Le 23 octobre : 219 tests réussis, types et lint validés, build Webpack complet
réussi après l’arrêt initial d’avertissement Next.js (dépendances inchangées).
Vérification dans le navigateur sur données fictives : formulaire obligatoire,
quatre modalités, aperçu modifiable, échec d’envoi sans perte des modifications,
fermeture sans envoi et réouverture depuis l’historique après rechargement.
Le HTML final affiche le rappel des indésirables en gras. Montréal ne comporte
aucune consigne d’attente; Longueuil les conserve. Civilité visible dans les profils.
Le schéma de production a été reproduit en mémoire avec ses 37 contraintes et
ses deux triggers : quatre modalités et répétitions idempotentes réussies, sans
charger de données de dossiers réels. Aucun courriel réel envoyé pendant les tests.
