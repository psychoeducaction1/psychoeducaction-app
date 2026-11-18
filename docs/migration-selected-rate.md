# Tarif choisi et dates historiques à la migration

Correctif préparé dans `real-950-migration-selected-historical-rate.sql`.

La reprise individuelle d'une assignation ancienne déclenchait un mandat intermédiaire à sa date de création, avant l'application du tarif choisi. Si cette date précédait le catalogue, la transaction échouait avec MANDATE_RATE_REQUIRED.

950 dérive une variante privée du raccord existant : les vérifications d'identité, verrous, rattachements et UUID sont conservés. Dans cette variante seulement, le lien d'assignation est inséré après la création du suivi ; le déclencheur ordinaire ne construit donc pas de mandat intermédiaire. Le parcours 920 prépare ensuite le mandat à partir des renseignements et du tarif validés. Les dates historiques restent enregistrées. Aucun catalogue n'est antidaté, aucune donnée existante n'est mise à jour à l'installation. Les fonctions ordinaires, le déclencheur et la variante ancienne restent identiques. Aucun nouveau droit de compte n'est attribué ; la variante est privée et vérifie l'opérateur autorisé et son identité.

Contrôles sur PostgreSQL PGlite jetable : 14 vérifications réussies après chargement de 920/930/940/950, dont assignation antérieure au catalogue, tarif manuel distinct (147,50 $), date historique du mandat conservée, création d'assignation inchangée, supervision, une seule révision de mandat, reprise identique sans nouveau client ni PDF et anciennes conventions inchangées. Empreintes des fonctions ordinaires comparées avant/après. ESLint ciblé et diff vérifiés. Les ancrages du schéma hébergé sont compatibles, vérification en lecture seule.

Activation distante et publication non effectuées. Nécessitent une autorisation explicite distincte. Aucun import, dossier réel, PDF ou courriel traité pendant la préparation.
