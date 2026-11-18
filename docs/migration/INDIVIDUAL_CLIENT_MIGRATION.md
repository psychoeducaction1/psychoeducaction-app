# Migration client par client — lot local du 17 novembre 2026

## Référence et intégration

Copie indépendante : `C:\Users\thinh\Documents\assignations-app\output\migration-clients-isolated-20261117`.
Branche : `codex/migration-clients-20261117`.
Base Git exacte avant retouches : `dae2de8d91741a9173a027808fb83ea6f81fdb6c`.

Les 581 fichiers applicatifs viennent du candidat validé `output/unification-pilot/output/procedures-910-release-20261117`, vérifiés contre `docs/migration/PROCEDURES_910_RELEASE.json`. Publication de référence attestée par le chat principal : `dpl_2urzFbo9ofEGykKLtbfHff6jkFbG` (`PROCEDURES_910_LIVE_PROMOTED.json`). Ce n’est pas une branche créée depuis main.

Le commit local initial `8e9a7e4fe3a29a8a8e934ff74f92e084a1fbe9d8` conserve cet instantané applicatif. Des commits de référence supplémentaires complètent uniquement les dépendances des recettes hors ligne, absentes du candidat de publication : SQL, tests et scripts fictifs déjà présents dans les sources. Le dernier est la base exacte ci-dessus ; ils ne sont pas à intégrer au produit. Aucun fichier .env, dossier .vercel, secret, script de déploiement ou configuration de publication n’a été importé. Les dépendances installées au dépôt parent sont utilisées en lecture seule.

Intégrer uniquement le commit fonctionnel/patch livré après cette base, puis examiner et appliquer séparément `supabase/clinical/real-920-individual-client-migration.sql`. **Script non appliqué à distance, aucune publication.** Il dépend du schéma clinique unifié installé, notamment 792/793, 801/802, 804–810, 820, 830–860 et 910. Il ne contient aucune activation d’opérateur ni reprise de dossiers existants.

## Parcours demandé

1. Choisir le professionnel du lot avant le dépôt Excel/PDF. Les lecteurs Excel/PDF, les composants et le centre de migration existants sont conservés.
2. Analyser et rapprocher les identités : dossier existant, assignation existante ou création. Homonymes, naissance contradictoire et suivi ambigu restent à résoudre. Un suivi déjà fermé peut être sélectionné pour une migration classée terminée/non prise ; il n’est pas rouvert.
3. Pour chaque client : identité, coordonnées (dont coordonnées supplémentaires), adresse, date de contact, début du suivi, requérants, modalités, disponibilités, motif et commentaires. Les informations actuelles du dossier sont consultables. Les valeurs renseignées remplacent les anciennes ; les blancs les conservent. Les requérants sont ajoutés/réutilisés sans leur inventer une autorité de consentement.
4. Choisir Service pris/suivi actif, Service non pris, ou Service pris/suivi terminé et archivé. L’historique conserve la date de contact d’origine. Les nouveaux imports ne consomment pas de place dans une demande du professionnel ; aucune rencontre historique, facture ou notification n’est fabriquée.
5. Choisir zéro, un ou plusieurs responsables des honoraires ; si des parts sont renseignées, elles doivent totaliser 100 %. Une absence de payeur n’empêche pas l’enregistrement et ne crée pas de payeur fictif. Une facture ne peut toutefois pas être attribuée à une personne inexistante : ses destinataires financiers doivent être renseignés avant son émission.
6. Tarif du fichier prioritaire ; sinon 135 CAD en psychoéducation, 100 CAD en intervention psychoéducative, puis tarif configuré pour les autres services. Modifiable avant validation. Le contenu clinique et administratif provient du service configuré, est affiché et peut être ajusté. Un changement de configuration entre lecture et enregistrement est refusé sans écrasement ; recharger le contenu avant de reprendre.
7. Bouton individuel **Enregistrer et valider ce client**. Le lot est préparé sans créer de clients ; chaque bouton effectue ensuite sa propre transaction. Les autres lignes restent en attente, les lignes réussies sont conservées et une reprise identique ne crée pas de doublon. L’ancien endpoint `item` ne permet pas de contourner la validation des nouveaux lots.

Une absence de date de naissance, de requérant, de coordonnées ou de signature n’empêche pas la migration. Il reste nécessaire d’identifier la destination et de choisir un service disponible pour pouvoir générer le bon mandat. Si aucune date du suivi n’est connue, la date de migration sert de référence, sans être présentée comme une rencontre historique.

## Mandats et signatures

- Mandat enregistré en état métier `prepared` (ou `partially_signed`), **pas `draft`**. Les PDF des conventions sont générés et figés. L’ancienne convention externe n’est pas considérée comme une signature sur la nouvelle convention comprenant l’IA.
- Si une version documentaire existe déjà dans l’application, elle reste intacte et une nouvelle version est créée ; aucun PDF ni ancienne signature n’est écrasé. Une mise à jour volontaire d’une même source peut réutiliser le dossier après confirmation du rattachement ; ses lots et documents antérieurs restent conservés.
- L’acceptation professionnelle possède une date de référence conservée : migration pour les mandats migrés, création du mandat pour les nouvelles assignations. L’image disponible est reprise automatiquement. Une image absente ne bloque pas la préparation.
- Lors de l’enregistrement ultérieur de l’image dans le profil, les mandats concernés sont actualisés automatiquement. La date de référence demeure inchangée ; `graphic_added_at` et l’évidence conservent séparément le moment réel de l’ajout de l’image. Les PDF originaux restent immuables ; les preuves graphiques sont ajoutées avec le mécanisme existant.
- Même règle pour la supervision désignée. Les signatures cliniques des clients/représentants restent réellement à recueillir. Un payeur ou requérant n’obtient aucun consentement IA, pouvoir de représentation ou accès aux notes par sa seule sélection.
- L’identité/autorité du futur signataire doit être réelle avant la signature : la migration n’invente pas la capacité de consentir si l’âge ou la représentation est inconnu. Les représentants déjà vérifiés sont conservés comme signataires ; les renseignements manquants peuvent être corrigés par le parcours normal de modification du mandat.
- L’ajout d’images ne modifie pas les signatures des notes cliniques. Aucun fichier de l’éditeur de notes n’est touché.

## Autorisations et fichiers partagés

Accès par opérateur de migration explicite et actif, avec `can_import=true` pour les mutations. Le rôle seul n’accorde pas l’accès. La direction et les adjointes autorisées peuvent utiliser le parcours ; aucune autorisation réelle n’est activée ici. Des variantes **privées** des routines de création/rattachement et de supervision limitent la délégation au pipeline de migration ; aucun droit général de gestion des accès n’est ajouté aux adjointes. Les routines publiques ordinaires et leurs contrôles restent en place.

Tables privées supplémentaires : validations individuelles et acceptations professionnelles. RLS forcées et aucun accès direct authenticated/anon/service_role. Tous les nouveaux helpers sont privés. Les RPC conservent le JWT de l’opérateur, les contrôles de plateforme et les drapeaux d’activation existants.

Fichiers modifiés :

- `components/clinical-migration/MigrationCentre.tsx` : parcours et transactions individuelles, contenu chargé depuis les paramètres, reprise du lot.
- `components/clinical-migration/MigrationClientPreparation.tsx` : fiche complète, requérants, parts et mandat.
- `lib/clinical-migration/preparation.ts`, `model.ts`, `intake.ts` : données de préparation, tarif/date/coordonnées, rapprochement des archives, validation des projections.
- `lib/clinical-unification/migrationHttp.ts` : nouvelles actions privées, mêmes contrôles et limites.
- `supabase/clinical/real-920-individual-client-migration.sql` : transactions, historique, mandats, signatures différées et accès limités.
- `lib/clinical-mandates/types.ts`, `transport.ts`, `components/clinical-mandates/MandateDetail.tsx` : dates d’acceptation et état des images. Contrat DTO à intégrer avec la migration.
- `components/clinical-workspace/ClientImportedIntake.tsx` : message de vérification retiré uniquement pour les imports individuellement validés.
- `tests/migrationClients.test.ts`, `migrationClientsSql.test.mjs` : modèle, vraie fiche React, API et transactions SQL fictives ; présente notice.

Conflits possibles : modifications simultanées du centre, du détail du mandat ou de son contrat DTO. Conserver les travaux du chat principal. Ne pas appliquer seulement les changements d’interface : 920 et les validateurs vont ensemble. L’extension des signatures concerne les nouveaux mandats ; aucune reprise automatique des anciennes versions existantes n’est effectuée à l’installation.

L’ancienne correction de rattachement d’archives reste disponible pour les anciens lots. Elle ne s’applique pas aux nouveaux dossiers validés : déplacer seulement leurs PDF laisserait leur mandat et leurs données administratives dans un autre dossier. Une erreur de rattachement après validation demande une revue administrative cohérente ; ce lot ne crée pas d’outil de déplacement complet de dossiers.

## Contrôles et limites

Tests ciblés : `node --import ./tests/register-procedures.mjs --test --experimental-strip-types tests/clinicalMigrationCentre.test.ts tests/clinicalMigrationIntake.test.ts tests/clinicalMigrationTransfer.test.ts tests/clinicalMandatesClient.test.ts tests/migrationClients.test.ts tests/migrationClientsSql.test.mjs`.

Recette SQL en mémoire PGlite : schéma clinique réel rejoué jusqu’à 910 puis 920 ; données exclusivement fictives. La migration 820 contient aussi des réécritures de fonctions administratives sans rapport avec ce lot, absentes de la fixture : leurs colonnes de capacité sont représentées, sans rejouer ces réécritures étrangères au parcours. Cela ne prouve pas le catalogue distant. Aucune base partagée ou distante n’a été modifiée.

Scénarios : préparation sans dossier, un seul client enregistré, reprise, mauvais rattachement, mise à jour de la même source, champs vides, parts multiples, ancienne convention conservée, images ajoutées après migration, date stable, supervision sans image, suivi archivé, rattachement d’assignation, opérateur retiré, aperçu seul, adjointe sans privilège général, configuration périmée et refus d’écritures directes.

TypeScript global sans émission, ESLint ciblé et diff vérifiés. Résultats chiffrés finaux dans le manifeste du paquet.

Non exécutés : build complet, navigateur réel (notamment sélecteur de fichiers, mobile et retour après fermeture), Supabase distant et concurrence multi-session. Le fichier réel de dix clients n’a pas été fourni ni importé dans ce lot. Une fois intégré, tester ce parcours avec un petit fichier fictif avant une migration réelle ; intégration, revue des opérateurs, migration distante et publication restent au chat principal.
