# Facture courante et rectification manuelle

Règles demandées le 2 novembre 2026; remplace le parcours de conservation décrit
dans `payroll-invoice-corrections.md` pour les corrections futures.

- Quantité facturée = durée début/fin divisée par 60 minutes. Le nombre de rendez-vous
  du seuil hebdomadaire reste entier et distinct. Une durée absente/nulle/invalide
  bloque l’émission : utiliser « Corriger les horaires » puis recalculer. Le fichier
  importé reste inchangé; les lignes corrigées sont recalculées aussi côté serveur.
  Le tarif horaire client est déduit du montant et de la durée, avec récupération
  de l’arrondi au cent. Les libellés « Rencontre (135 $) » regroupent les mêmes tarifs
  et règles de rémunération; les annulations sont simplement « Annulation ».
  Le pourcentage est appliqué au montant réclamé, sans proratisation supplémentaire.
  Les tarifs horaires spécifiques conservent leur règle et exigent une durée réelle.
- « Annulation » dans description ou détail prime sur « Rencontre » et sur les
  rapports : montant partagé selon la règle d'annulation, zéro rencontre au seuil.
  Ce classement est partagé avec le budget, sans modifier ses données enregistrées.
- Une catégorie manquante produit un calcul incomplet et bloque l'émission.
- La clé facture reste UUID + fournisseur/période. Une rectification conserve le
  numéro. Le compteur technique de révision protège les écritures concurrentes;
  il ne correspond plus à un historique consultable des documents.
- La page `/direction/paie/rectifier?id=…` permet ajout/retrait/modification des
  postes et du déplacement. Les totaux sont recalculés et validés côté serveur.
  L'identité du professionnel et la période ne viennent pas des champs éditables.
- Une rectification supprime les anciens octets, snapshots et signatures de cette
  facture dans la même transaction, puis enregistre le nouveau snapshot. Aucun
  ancien document n'est proposé au téléchargement. Un échec de génération se
  récupère en retéléchargeant le snapshot courant. Aucun envoi automatique.
- Cette suppression concerne le registre applicatif. Elle ne supprime ni les
  copies déjà téléchargées/envoyées ni les sauvegardes de l'hébergeur.
- Les séquences sont privées, propres aux professionnels, avec préfixes uniques.
  Initialiser seulement après rapprochement de la dernière facture envoyée, en
  prenant la dernière référence chronologique, pas le maximum de tous les anciens
  sujets (des séquences ont déjà été reprises). Les collisions AG/MD nécessitent
  des préfixes distincts pour les prochaines émissions, sans renuméroter l'existant.
- Une séquence non confirmée bloque une nouvelle émission. Le formulaire permet
  sa confirmation une fois; `…-000` confirme explicitement une première facture.
  Un compteur configuré ne peut pas être remis à zéro par ce formulaire.
- Pour reprendre une période historique sans fiche registre, renseigner la
  référence déjà émise dans « Ancienne facture non enregistrée ». Aucun import
  d'original exigé; aucune nouvelle séquence consommée pour cette reprise.

Déploiement : appliquer `supabase/payroll-invoice-current.sql` après la migration
du registre existante, initialiser les séquences vérifiées, puis publier le code.
L'installation ne réécrit ni ne supprime de facture existante; la suppression des
anciennes versions intervient lors de la rectification explicite.

Contrôles : tests `payroll*.test.ts`, helper des vraies routes avec fournisseur
d'envoi simulé, `scripts/test-payroll-current.mjs` avec `PGLITE_MODULE_PATH` local.
Le test SQL vérifie remplacement, suppression des signatures, collisions, retries,
corrections concurrentes et droits. PGlite sérialise une connexion; ce contrôle ne
simule pas plusieurs connexions PostgreSQL physiques.

Quantités affichées à deux décimales maximum, demi arrondi vers le haut dès le
troisième chiffre (1,584 → 1,58; 1,585 → 1,59). Durées et quantités exactes restent
conservées dans les calculs et snapshots; aucun montant dû arrondi sur la quantité affichée.

La rectification depuis la paie ouvre désormais un dialogue sur la même page.
L’import, la période, les corrections d’horaires, les références saisies et les
résultats des autres professionnels restent en mémoire pendant cette opération.
Après sauvegarde, seul le snapshot de la facture concernée est actualisé.
« Calculer » réutilise les lignes importées; choisir un nouveau fichier invalide
ce cache. Aucun stockage persistant des activités dans le navigateur n’est ajouté.
Une actualisation complète ou la fermeture de la page exige toujours un nouvel import.
Contrôle visuel : deux professionnels, correction 81 → 90 pour le premier, second
à 72 inchangé, période/fichier/référence conservés, recalcul sans réimport, puis
remplacement volontaire du fichier sans réutilisation de l’ancien contenu.
