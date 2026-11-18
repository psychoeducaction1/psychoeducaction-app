# Tarif choisi et dates historiques à la migration

Correctif préparé dans `real-950-migration-selected-historical-rate.sql`.

La reprise individuelle d'une assignation ancienne déclenchait un mandat intermédiaire à sa date de création, avant l'application du tarif choisi. Si cette date précédait le catalogue, la transaction échouait avec MANDATE_RATE_REQUIRED.

950 dérive une variante privée du raccord existant : les vérifications d'identité, verrous, rattachements et UUID sont conservés. Dans cette variante seulement, le lien d'assignation est inséré après la création du suivi ; le déclencheur ordinaire ne construit donc pas de mandat intermédiaire. Le parcours 920 prépare ensuite le mandat à partir des renseignements et du tarif validés. Les dates historiques restent enregistrées. Aucun catalogue n'est antidaté, aucune donnée existante n'est mise à jour à l'installation. Les fonctions ordinaires, le déclencheur et la variante ancienne restent identiques. Aucun nouveau droit de compte n'est attribué ; la variante est privée et vérifie l'opérateur autorisé et son identité.

Contrôles sur PostgreSQL PGlite jetable : 14 vérifications réussies après chargement de 920/930/940/950, dont assignation antérieure au catalogue, tarif manuel distinct (147,50 $), date historique du mandat conservée, création d'assignation inchangée, supervision, une seule révision de mandat, reprise identique sans nouveau client ni PDF et anciennes conventions inchangées. Empreintes des fonctions ordinaires comparées avant/après. ESLint ciblé et diff vérifiés. Les ancrages du schéma hébergé sont compatibles, vérification en lecture seule.

Activation distante et publication non effectuées. Nécessitent une autorisation explicite distincte. Aucun import, dossier réel, PDF ou courriel traité pendant la préparation.

## Activation autorisée

950 appliquée et correctif publié sur app.psychoeducaction.com : dpl_BEW4YWsi3Q7UDxVqxcj911DrKTLy (READY, alias vérifié), commit fonctionnel d72351f. Lors de l'installation atomique, empreintes de 25 tables protégées et définitions/ACL de quatre fonctions ordinaires inchangées. La nouvelle fonction est privée. Aucun import, modification de rôle ou courriel exécuté. Recette utilisateur à effectuer ; aucun enregistrement de client réel n'a été tenté pendant la publication.

Référence du candidat suivant : output/unification-pilot/docs/migration/MIGRATION_950_RELEASE.json (589 fichiers). Reçus MIGRATION_950_APPLIED.json et MIGRATION_950_LIVE_PROMOTED.json. Retour arrière applicatif : dpl_99T5qZsLFc3sra7YYFPphRtF6J2Q ; définition SQL précédente sauvegardée en zone privée, procédure de retour arrière préparée et non exécutée.
