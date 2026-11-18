# Migration 970 et lecture des mandats — publication du 18 novembre 2026

## Résultat

Migration 970 appliquée avec autorisation explicite. Les empreintes de neuf tables
(dossiers, assignations, mandats, signatures, documents et préparation de migration)
sont restées identiques pendant l'installation. Aucune importation ni aucun
courriel lancé ; aucun droit modifié.

Version active : dpl_EJXrnVmLQen6fQqLiT42SaHGbd5c sur
https://app.psychoeducaction.com. Code : 584cb5d puis 9c2964f.
Retour arrière applicatif avant ce lot : dpl_mnZQW8D9feosMpXTvVaUtrMFHWAt.
Les 595 fichiers du candidat proviennent de la version précédente vérifiée par
empreintes, avec seulement cinq fichiers d'exécution modifiés ou ajoutés.

## Rattachement à l'assignation

Une préparation opérationnelle concordait sur le professionnel, la naissance,
l'empreinte et le statut de l'assignation, mais son prénom n'était identique
qu'après normalisation. L'interface acceptait accents et séparateurs ; le serveur
920 refusait ces variations. Aucun renseignement personnel n'est conservé dans
ce rapport.

970 aligne uniquement les noms sur le comparateur existant de l'interface. Les
verrous, UUID, confirmation, professionnel, naissance, statut et empreinte restent
contrôlés. Le helper SQL reste privé. Aucun ancien enregistrement n'est modifié.
La définition antérieure de clinical_migration_command_930_base est conservée
localement dans output/unification-pilot/output/migration-970-function-before.sql
pour un retour arrière autorisé. Un contrôle de baseline fait échouer la migration
si la fonction attendue a changé.

## Mandat archivé

Les journaux anonymisés distinguaient une liste réussie et un détail en échec.
Le diagnostic fixe ajouté au lecteur a localisé l'échec au rendu des signatures
automatiques. Les documents possédaient leurs références Storage ; les noms de
signature étaient présents. La fermeture du dossier n'était pas une panne.

La police SignatureCursive.ttf n'était incluse que pour une sous-route mandats,
alors que Next.js sert cette API avec [[...segments]]. La configuration inclut
maintenant cette police dans la route API clinique commune, comme le logo existant.
Après cette seule correction supplémentaire, la consultation authentifiée du
mandat archivé concerné aboutit : convention affichée, statut fermé conservé,
aucun message d'indisponibilité. Les anciennes conventions et les consentements
n'ont pas été édités. Le lecteur existant peut achever l'archivage technique des
preuves de signature en attente pendant cette consultation.

Les erreurs futures indiquent si le mandat archivé ne peut pas être chargé sans
présenter la fermeture comme une panne générale. Les traces serveur ne conservent
que l'étape et un code fixe autorisé, jamais l'URL, un nom ou un message SQL brut.

## Présentation et contrôles

- Avertissement générique sur l'Excel et explications financières techniques retirés.
  Renseignements conservés sous Renseignements complémentaires, libellés simplifiés.
  Aucune autorité de consentement n'est attribuée par ce changement d'affichage.
- TypeScript global, lint ciblé, contrôle du diff et test du message : réussis.
- 16 tests SQL en base PGlite jetable : réussis, dont accents, refus des véritables
  divergences d'identité/naissance/empreinte, absence de doublons et lecture archivée.
- Deux builds Vercel READY ; promotion finale réussie.
- API migration et mandats anonymes avec contexte : 401.
- Consultation réelle limitée au défaut du mandat ; pas de campagne de tests
  fonctionnels ni de tentative d'import. L'utilisateur réalise sa recette.

Manifestes et preuves : output/unification-pilot/docs/migration/
MIGRATION_970_RELEASE.json et MIGRATION_970_LIVE_PROMOTED.json.
