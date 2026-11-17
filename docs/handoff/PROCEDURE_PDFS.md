# Complément PDF des procédures — préparation locale du 17 novembre 2026

Copie indépendante : `C:\Users\thinh\Documents\assignations-app\output\procedures-isolated-20261117`.
Branche : `codex/procedures-pdf-20261117`.
Base exacte du complément : `71bd45590352b0492f10ccc716f1576b2ba582b6` (bibliothèque de procédures déjà livrée).
Le lot initial reste inchangé dans `output/procedures-handoff-20261117`.

## Comportement

- Chaque procédure dispose d’une liste de PDF : joindre, consulter dans une fenêtre de la page, télécharger et remplacer.
- Un remplacement ajoute une version ; les anciennes restent consultables et téléchargeables. Aucun effacement dans ce complément.
- Titre et nom de fichier affichés ; taille maximale de **3 Mio (3 145 728 octets)** par fichier, affichée « 3 Mo » dans l’interface. Limite choisie pour conserver la requête JSON/base64 sous la limite d’entrée de l’hébergement.
- PDF réellement analysés avec `pdf-lib`, déjà installé. PDF chiffrés, corrompus, à actions actives ou pièces jointes intégrées refusés. Vérification SHA-256 avant restitution. Cette validation n’est pas un antivirus.
- La consultation utilise le lecteur PDF du navigateur dans une iframe et une URL Blob temporaire ; si le navigateur ne l’affiche pas, un bouton permet le téléchargement. Aucun lien public permanent ni lien signé partageable n’est généré.
- Chargements annulés et URL Blob révoquées à la fermeture/démontage/changement de session. Droits revérifiés sur chaque requête et par les RPC. Un fichier déjà téléchargé ne peut pas être repris à son détenteur.
- Saisie protégée par le garde de navigation existant. Le retour du sélecteur de fichiers ne recharge pas la bibliothèque pendant l’édition. Conflit : formulaire conservé ; reprise identique : même identifiant, pas de doublon.

## Accès privés et installation réservée au chat principal

Même liste explicite `procedure_library_members` que les procédures, sans privilège implicite lié au rôle. Les cinq personnes prévues sont **Ève Deveault-Harvey, Thinhinane Ould Younes, Hicham Boukili, Hajar et Fatima Zahra**. Les identités Auth/profiles doivent être vérifiées par le chat principal avant activation selon la notice initiale. Le complément n’insère aucun membre, ne modifie aucun compte ni droit réel et ne contient aucun UUID réel.

1. Intégrer d’abord le lot initial `71bd455...` ou son équivalent déjà intégré ; ne pas rejouer ce lot initial si présent.
2. Intégrer le commit/patch complémentaire fourni. Résoudre d’éventuels conflits uniquement dans les fichiers de procédures ; aucune modification de l’éditeur clinique ou des signatures.
3. Examiner puis appliquer séparément `supabase/procedure-library/003-private-pdfs.sql` **après** `001-library.sql`. Script préparé, **non appliqué à une base distante**. Pas de migration automatique au déploiement.
4. Conserver/activer uniquement les cinq adhésions explicites déjà prévues ; `can_edit=true` autorise ajout/remplacement. Lecture seule reste supportée.
5. Avant publication, vérifier le rendu du lecteur PDF et le téléchargement dans les navigateurs utilisés, puis l’accès des cinq comptes réels et le refus d’un sixième compte de test.

Stockage : table privée `procedure_library_pdfs` avec RLS et octets `bytea`, suivant le mécanisme d’archives binaires déjà présent dans l’application. Pas de nouveau bucket Storage, de clé service, de configuration de production ni de dépendance. Écriture uniquement par RPC avec contrôle de membre actif + plateforme, auteur issu de la session, verrou et version attendue. Lecture directe des octets et écritures directes refusées au rôle authenticated. Les RPC de lecture n’exposent aucun contenu aux non-membres. Métadonnées seules dans la liste.

## Fichiers et portée

- `components/procedures/ProcedurePdfs.tsx` : liste, historique de versions, aperçu, téléchargement, dépôt/remplacement.
- `components/procedures/ProcedureLibrary.tsx` : insertion du panneau et protection du formulaire lors du retour de la boîte de fichiers.
- `lib/procedures/pdfModel.ts`, `pdfHttp.ts` : contrats, validation, autorisation et réponse privée.
- `lib/procedures/client.ts`, `server.ts` : transport authentifié et réutilisation du contrôle des membres.
- `app/api/procedures/files/route.ts`, `files/[id]/route.ts` : endpoints privés.
- `supabase/procedure-library/003-private-pdfs.sql` : stockage versionné et RPC/RLS.
- Tests PDF HTTP/UI et extension des tests SQL/UI existants ; présente notice.

## Contrôles

Tests hors ligne : `node --import ./tests/register-procedures.mjs --test --experimental-strip-types tests/procedureLibrary.test.ts tests/procedureLibraryUi.test.ts tests/procedureLibrarySql.test.mjs tests/procedurePdfs.test.ts tests/procedurePdfsUi.test.ts` : **16 tests réussis**.

Ils couvrent les procédures existantes, validation PDF, contenu actif imbriqué, autorisation préalable, réponses privées et intégrité, membres fictifs (cinq autorisés et un refusé), lecture seule, révocation, plateforme désactivée, versions conservées, conflit, reprise sans doublon, refus des écritures directes et comportement du formulaire. SQL exécuté uniquement dans PostgreSQL embarqué jetable PGlite, sans URL distante.

TypeScript global sans émission, ESLint ciblé et `git diff --check` exécutés ; résultats finaux consignés dans le manifeste du paquet.

Non exécutés : build complet, test navigateur réel et lecteur PDF natif, Supabase/PostgreSQL distant et concurrence multi-session réelle. Aucun PDF réel (dont le guide PAE), secret, configuration de production, client réel ou courriel importé. Le guide PAE devra être joint par une personne autorisée après intégration et activation. Le texte des PDF n’est pas indexé par la recherche de procédures dans ce complément.
