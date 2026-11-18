# Parcours de migration — revue et simplification locale

Base : 35ec6a7, version active de référence dpl_Gw3Ay4JneJYN76xYn5mW9CRDAUqK / MIGRATION_960_RELEASE.json. Aucun appel de production durant cette revue.

## Plan et page concernée

Page unique : `/administration/migration-donnees`. Réutiliser MigrationCentre, le formulaire MigrationClientPreparation et les API/permissions de 960. Présenter trois étapes visibles (fichiers, vérification des clients, bilan), une seule fiche détaillée à la fois, puis vérifier la sélection, les transferts et la reprise. Aucun nouveau module clinique ou service externe.

## Changements préparés

- Liste compacte des clients, recherche sans accents, filtres à traiter/à vérifier/ignorés, avancement et précédent/suivant. Une fiche en cours reste affichée quand sa dernière erreur est corrigée ; seul un enregistrement confirmé fait passer au suivant.
- Même liste de validations pour le repère de préparation, le bouton et l'action d'enregistrement. Les PDF originaux à redéposer après reprise sont signalés avant la soumission. Les identifiants sources dupliqués bloquent la préparation du lot avant un appel serveur.
- L'Excel original est transféré une seule fois par lot pendant la session, après confirmation du transfert et de sa conservation. Un échec laisse la reprise possible. Aucun contenu sensible n'est ajouté à un stockage navigateur persistant.
- Si la réponse de l'enregistrement se perd : une seule lecture du reçu du même lot, vérification du statut et des valeurs soumises, jamais de seconde écriture automatique. Un conflit connu et une révocation restent des refus. Un résultat non vérifié renvoie au rapport.
- Reprise directe du dernier lot inachevé ; ouverture des fiches clients dans un nouvel onglet et actualisation des correspondances en lecture seule en conservant les saisies. Un changement de version demande une nouvelle confirmation d'association.
- Changement explicite de fichiers/lot, avec confirmation de perte des saisies non enregistrées et conservation des reçus confirmés. Les fichiers utilisés par une préparation ne sont pas retirés isolément ; les aperçus et données en mémoire sont nettoyés à sa fermeture.
- Rattachement de PDF limité aux lignes encore visibles à traiter ; aucune destination déjà importée/masquée. Fusion par index et par empreinte, sans changer le nom d'un document déjà présent. Une source réutilisée avec un autre nom ou service n'est plus masquée à tort comme déjà traitée.

## Registre des écarts

Résolus localement : longue page de formulaires simultanés ; validations partielles avant clic ; transferts Excel répétés ; ambiguïté après réponse perdue ; risque de déplacement d'un PDF dans une ligne masquée ; perte de contexte à l'ouverture d'une fiche ; remplacement de fichiers ambigu ; navigation qui saute pendant la correction.

Conservés : validation manuelle client par client ; contrôles d'identité/permissions serveur ; nouveaux PDF toujours à vérifier ; aucun enregistrement automatique. Les dossiers ambigus et les parcours historiques non admissibles aux règles existantes restent soumis à une vérification, sans élargissement des règles métier dans ce lot.

## Vérifications et limites

19 tests ciblés fictifs passent (modèle, reprise, transferts, refus d'accès, réponse perdue et rendu/événements du composant réel de sélection), TypeScript global sans émission et ESLint ciblé passent, diff vérifié. Les contrôles PostgreSQL de 960 sont réutilisés : aucune modification SQL/API/permission. Pas de nouveau build complet ni recette navigateur authentifiée ; à faire lors de la publication autorisée et de la recette utilisateur. Aucun import, donnée réelle lue/modifiée, courriel, appel IA, abonnement ou déploiement.

Le lot est préparé localement ; publication distincte à autoriser. Aucun script SQL à appliquer. Le prochain candidat doit partir du manifeste MIGRATION_960_RELEASE.json et superposer uniquement les composants/helpers de ce lot.
