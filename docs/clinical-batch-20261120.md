# Correctifs cliniques et administratifs du 20 novembre

Branche locale `codex/integrated-ui-20261116-v2`. Le lot part de `10a0e89`, qui comprend la préparation de la migration 1030. La publication, les changements de données, les courriels et les paiements réels sont hors de cette livraison.

| Demande | Résultat local et limites |
| --- | --- |
| 1. Tâches administratives | Tri par date prévue décroissante, avec les tâches sans date à la fin. |
| 2. Clients assignés et profils | Le raccourci « Demande d’admission » est retiré de la fiche administrative de l’assignation. Le répertoire propose un filtre lorsque la projection autorise plusieurs professionnels. Dans l’onglet Clients d’un profil administratif, l’aperçu de provenance compare les dossiers affichés aux reçus de migration à partir des identifiants du dossier, du suivi et du professionnel. La lecture de production a trouvé six dossiers avec reçu pour Hicham et un dossier avec reçu pour un autre professionnel. L’aperçu présente les entrées à conserver ou à retirer avant toute modification des rattachements. Les listes restent intactes pendant cette revue. |
| 3. Renseignements complémentaires | Le récapitulatif importé a été retiré de la fiche. Les données restent conservées et les champs usuels de la fiche continuent de fonctionner. |
| 4. Accès des adjointes et de la Direction | Les vérifications de configuration en lecture seule confirment l’autorisation clinique administrative de Hajar et Fatima Zahra, ainsi que les six bureaux actifs. Direction et Hicham ont leurs habilitations d’administration prévues. Le chargement des dossiers et des bureaux n’accorde pas de droit sur les notes cliniques. La session réelle de Hajar doit encore être vérifiée pour isoler la cause de son signalement. |
| 5. Bureaux | La section « Bureaux autorisés » est repliable. Le nom est affiché si la réservation et son professionnel sont déjà visibles dans la projection administrative. Une occupation anonyme reste anonyme. |
| 6. Prospects | Les heures et les bornes de blocage utilisent America/Toronto. Un choix apparaît si l’heure saisie se produit deux fois au retour à l’heure normale. La fiche identifie l’heure du rendez-vous séparément de la réception de la demande. Une ancienne réponse réseau ne remplace pas la nouvelle période affichée. |
| 7. Demandes professionnelles | Dans la gestion administrative, la case a été remplacée par « Mettre en pause » et « Réactiver », avec l’état affiché. La pause conserve les assignations et les compteurs, demeure en vigueur lorsqu’une opération libère une place et la reprise exige une place et l’absence d’une autre demande active. Le parcours des professionnels non activés reste hors de ce changement. |
| 8. Disponibilités | Le changement préparé pour le module clinique conserve les choix et précise « Autre ». 72 heures écoulées au minimum sont vérifiées dans l’interface et en base, y compris les fins de semaine. La validation du périmètre des autres parcours professionnels reste à obtenir. |
| 9. Activités | « Absence du client » a été retirée de la création pour les comptes autorisés. Les trois explications signalées ont été retirées de l’interface de création ou de déclaration selon le cas. Les autorisations et les règles d’absence restent vérifiées. |
| 10. Rencontres passées | La migration 1030 prépare la correction et le changement d’issue d’une rencontre passée. Une annulation sans frais retire la prestation du circuit de facturation et préserve les autres lignes d’une facture groupée. Les pièces déjà établies restent traçables, et la note signée reste visible avec la mention d’annulation. Un règlement ou des honoraires déjà approuvés peuvent demander une intervention administrative. |
| 11. Frais d’ouverture | Une activité financière et sa facture séparée peuvent être créées depuis le détail d’un rendez-vous futur admissible. Le calendrier repère cette activité sous la rencontre, sans occuper un créneau supplémentaire. Le PDF numéroté est archivé et la facture s’ouvre sur le parcours d’envoi manuel. Les frais sont comptés une fois par dossier, même si la rencontre ensuite est facturée. |
| 12. Rappels | Le dépôt contient des préférences patient à 48 h et à 2 h. Le cron existant des assignations traite une autre catégorie d’événements. Aucun job clinique de livraison des rappels de rencontre aux clients n’a été identifié dans cette version. Il reste à construire la file commune client et professionnel, sans inclure le superviseur. |
| 13. Courriels | Paramètres de la clinique → Courriels permet à un compte de gestion financière de modifier et d’apercevoir le modèle de facture. Le transport manuel utilise le modèle stocké et vérifie le PDF avant de le transmettre au fournisseur. Les tests utilisent un fournisseur simulé. L’activation de l’envoi sur l’hébergement réel reste à confirmer. Les autres modèles ont été inventoriés ci-dessous. |
| 14. Migration | L’Excel reconnaît plus de libellés exacts pour le motif, les dates, la référence, les modalités, les disponibilités et les commentaires. Un motif explicite dans un PDF clinique identifiable est proposé et signalé. Un PDF joint à une autre ligne préremplit le motif vide seulement si le prénom, le nom et la naissance concordent. Une valeur saisie est conservée et les divergences sont signalées. Les PDF scannés sans couche texte et les motifs déduits d’un récit restent à renseigner. |
| 15. Réponse inattendue | Le message provient du client de l’espace clinique lorsqu’une réponse reçue avec succès échoue à la lecture du JSON ou à la validation du contrat. Le formulaire d’assignation y ajoutait la phrase sur la saisie. Les parcours de lecture et d’écriture ont désormais des consignes distinctes. Une confirmation incertaine garde la même clé et n’envoie aucune seconde mutation d’elle-même. L’occurrence initiale demeure inconnue. |

## Inventaire des courriels

- Factures cliniques avec PDF et confirmations manuelles depuis la facturation. Ce modèle est raccordé à l’onglet Courriels.
- Assignations côté client et professionnel, renvois, demandes professionnelles, relance des assignations en attente, confirmation de service pris, messages du processus d’assignation et suivi de client injoignable.
- Tâches de coordination, tâches administratives et annonce de mise à jour des préférences professionnelles.
- Réservation d’appel et demandes de rappel provenant de la prise de contact publique.
- Sondages de satisfaction, envoi de paie avec pièce jointe et communications d’accès au compte. Les liens et jetons d’authentification relèvent de leurs flux dédiés.
- Les rappels cliniques de rencontre devront vérifier à l’envoi le statut, l’horaire courant, la préférence de rappel et le destinataire de chaque canal. Il faudra garantir l’unicité par rencontre, horaire, échéance et destinataire et invalider toute tâche en attente après annulation ou déplacement.

## Contrôles et dépendances

- La recette PostgreSQL `node scripts/clinical-db/test-advance-opening.mjs` dépend du schéma du pilote Docker local. Elle copie le schéma seul et vérifie la pause et la reprise, le contrôle des 72 heures, les droits, la version du modèle, la facture d’ouverture et sa pièce jointe, puis le traitement de facturation sans doublon. Le scénario utilise des dossiers fictifs et aucun fournisseur externe.
- 65 tests ciblés ont réussi. ESLint global a signalé les trois avertissements déjà présents. Les huit échecs du premier passage global ont été reproduits sur le commit de départ. Celui-ci présente aussi un échec supplémentaire dans le test du sélecteur de bureaux, corrigé dans ce lot.
- Le build a généré les 72 pages de la copie propre au commit `912f027` avec Next.js 16.4.5, la version du verrou. La copie de travail réutilisait Next.js 16.4.3 et a soulevé l’alerte corrigée par cette version. Le complément `627bdfe` a repassé TypeScript, ESLint ciblé et la recette PostgreSQL.
- La migration 1060 doit suivre 1030 et s’appuie sur l’envoi manuel de 1000. Les changements 1040, 1050, 1060 et 1070 nécessitent la publication conjointe des routes et de leurs appels. 1080 est isolée dans son propre commit pour que le périmètre clinique puisse être validé séparément.
- La recette authentifiée de Hajar et Fatima Zahra ainsi que le contrôle de la configuration réelle des envois restent nécessaires. L’aperçu de provenance doit être soumis à la revue de Direction avant un éventuel ajustement d’affichage des listes.

## Commits locaux

- `b45a3c7` Tâches, dossiers et demandes en administration.
- `7bd36b4` Activités du calendrier, bureaux et prospects.
- `68d17ac` Sources de migration et confirmations incertaines.
- `8c61462` Proposition de disponibilités et limite de 72 heures.
- `912f027` Frais d’ouverture et modèle de courriel des factures.
- `627bdfe` Choix de l’heure répétée à Toronto et recette des reçus de migration.

La préparation de l’annulation des rencontres passées est dans `91b3118`, `7b17bca` et `10a0e89`. Les deux changements d’interface antérieurs sur les choix de création et le raccourci d’admission sont dans `478a41b` et `9e6c608`. La commande `git diff --name-status 10a0e89..627bdfe` donne la liste des fichiers de ce lot.
