# Conflits d'identité dans la migration — 960

## Diagnostic

Le fichier et le dossier sélectionné portent deux dates de naissance différentes. La confirmation « même client » ne lève pas cette contradiction. Le serveur refusait avec PATIENT_CHANGED / SQLSTATE 40001 ; les logs techniques montrent des répétitions à intervalle d'une seconde. Le transport finissait par exposer une indisponibilité générique. Aucun nom, date de naissance, coordonnée ou contenu de dossier n'est enregistré dans cette notice.

## Correctif préparé

- Contrôle des dates dans la préparation, y compris après sélection manuelle et confirmation. Message affiché auprès du client et bouton de validation désactivé tant que les dates connues diffèrent. Une date inconnue reste autorisée selon les règles existantes ; aucune valeur n'est remplacée automatiquement.
- 960 contrôle explicitement cette contradiction côté serveur, avant mutation, pour un élément non encore importé dans un lot possédé par l'opérateur. Les contrôles d'accès habituels restent obligatoires. Un rejeu confirmé conserve le traitement idempotent existant.
- Seuls les conflits métier nommés sont convertis de 40001 vers PT409 (réponse HTTP 409). Les véritables erreurs de sérialisation non reconnues restent inchangées.
- Le transport et la route migration conservent uniquement les codes métier fixes et leurs messages français, sans transmettre de valeurs SQL ou détails du fournisseur. Les autres modules restent inchangés.

## Vérifications

Six tests existants UI/API/helper, quatre tests de conflit dont transport réel simulé et HTTP, et quinze vérifications PostgreSQL PGlite jetables réussissent. La chaîne SQL inclut 920/930/940/950/960. Une naissance contradictoire est refusée sans changer le dossier ; après correction explicite de la préparation, le même client et le même suivi sont réutilisés. La version périmée retourne PT409 / PATIENT_CHANGED. Contrôles de conservation des anciennes conventions et de reprise sans nouveau client/PDF conservés. TypeScript sans émission, ESLint ciblé et diff vérifiés.

Aucune migration distante, publication, modification d'identité, réimportation de PDF ou émission de courriel durant la préparation. La bonne date doit être vérifiée par l'opérateur dans la préparation. L'application distante de 960 et la publication nécessitent un accord explicite distinct.
