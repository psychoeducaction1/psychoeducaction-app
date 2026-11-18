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

## Ajustements demandés avec l'autorisation de 960

Conflit de naissance : champ rouge avec aria-invalid et message immédiatement adjacent ; retrait des listes de correspondances générales et du sélecteur de suivi. Une destination unique peut être affichée à vérifier sans confirmation en cas de contradiction. Une ambiguïté réelle reste bloquée et renvoie à la fiche client ; aucun homonyme ou suivi n'est choisi arbitrairement. Les anciens lots repris sont à nouveau rapprochés en lecture seule avec le catalogue.

Dossiers traités : la lecture autorisée du centre retourne les reçus de migration réussis appartenant à l'opérateur. Le même fichier est reconnu par sa source, les nouveaux exports par nom + naissance + professionnel + service lorsque la destination est unique. Les cas incertains restent à vérifier. Les lignes traitées ne sont pas ajoutées au nouveau lot et apparaissent dans une section consultable avec accès à la fiche normale pour modification. Le retrait d'un rapport n'efface pas ces reçus. Aucune identité, date, donnée clinique ou autorisation n'est modifiée à l'installation.

Tests complétés : douze tests UI/API/modèle et seize vérifications PostgreSQL fictives passent, notamment reprise d'export, homonymes, autre professionnel/service, reçu conservé après retrait de rapport et isolation des reçus entre deux opérateurs.
