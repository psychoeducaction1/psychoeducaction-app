> Activation autorisée le 23 octobre 2026 : registre et correction du titre de Megan appliqués en production. Dernière période déjà facturée confirmée par la direction : 18 octobre 2026. Aucun document généré, envoyé ou remplacé lors de cette activation. Les constats de préparation ci-dessous décrivent aussi l’état avant activation.

# Factures professionnelles — corrections préparées le 23 octobre 2026

Travail de développement uniquement. Aucun original remplacé, profil distant corrigé,
document envoyé, contrat changé, paiement modifié ou déploiement effectué.

## Diagnostic et rapprochement

Les cinq originaux ont été retrouvés en pièces jointes aux réponses Outlook aux
factures concernées. Les copies de travail sont conservées dans le dossier local
ignoré `.env.invoice-review/`, avec leurs empreintes SHA-256. Ne pas versionner ce
dossier ni ses documents. Les signatures éventuelles restent sur ces originaux.

Les activités suivantes ont permis de reconstituer exactement les cinq totaux :

- `C:/Users/thinh/Downloads/Activités détaillées (44).xlsx`, uniquement du 5 au 11 octobre;
- `C:/Users/thinh/Downloads/psylog-references/Activités détaillées (41).xlsx`, uniquement
  du 12 au 18 octobre.

Ce rapprochement ne prouve pas quels fichiers ont été importés à l'émission :
l'ancienne application ne persistait ni l'export ni un snapshot de facture.
Les catégories utilisées pour le rapprochement reproduisent les pourcentages des
originaux; aucun contrat ou profil de production n'a été relu ou modifié.

| Facture | Avant | Résultat préparé | Effet financier sur ces originaux |
| --- | --- | --- | --- |
| PEA-REB-006 | 14, prix affiché 0,61, total 1 540,00 | 14 h à 110,00; total 1 540,00 | Aucun : erreur d'affichage. Le tarif 110 est déjà dans la règle spécifique de rémunération; 0,61 vient du coefficient 110/180. Le modèle local avait déjà une projection total/quantité; elle est conservée, complétée d'unités et testée. |
| PEA-ÈD-009 | Deux lignes de quantité nulle : 42,00 et 94,50 | Anomalies sources identifiées; émission corrigée bloquée en attente de confirmation | Aucun montant soustrait; total calculé toujours 2 223,06, déplacement 28,56 inclus. |
| PEA-MD-018 | Titre « Psychoéducatrice », total 132,00 | Titre de profil « Intervenante B.Sc. Ps.éd », total 132,00 | Aucun; correctif de profil préparé séparément, non appliqué. |
| PEA-AG-021, deux fournisseurs | Même référence pour 276,00 et 201,56 | Deux UUID; références anciennes conservées; prochaine émission avec compteur global | Aucun; aucune fusion ni suppression. |

### Activités d'Ève à confirmer

| Fichier et ligne Excel | Date et horaire source | Base facturée | Honoraires reproduits | Confirmation nécessaire |
| --- | --- | --- | --- | --- |
| (41), ligne 62 | 14 octobre, 17:30–17:30 | 60,00 | 42,00 | Horaire réel, ou règle et statut d'annulation/forfait. |
| (44), ligne 286 | 7 octobre, 12:45–12:45 | 67,50 | 47,25 | Même confirmation. |
| (44), ligne 294 | 6 octobre, 17:00–17:00 | 67,50 | 47,25 | Même confirmation. |

Ces lignes sont classées « Rencontre » dans les exports. Une durée de zéro est
réellement enregistrée : ce n'est pas un arrondi de durée fractionnaire. Leur
montant seul ne prouve ni une durée de 30 minutes ni une annulation. Les trois
activités restent dans le calcul et leurs lignes sources sont signalées; la
facture est bloquée jusqu'à une correction ou confirmation de la source.

La ligne 304 du fichier (44) est également une « Rencontre » d'une heure dont le
détail mentionne des frais d'annulation. Sa nature doit être confirmée avant
émission; aucun changement automatique du seuil hebdomadaire ou du montant.

## Calcul et documents

- Coefficient de partage et montant horaire sont distincts. La facture fournisseur
  utilise exclusivement ses honoraires, une unité explicite et un prix dérivé
  du total par quantité; aucune base client ni pourcentage interne n'y figure.
- Décimaux rationnels via BigInt, sans dépendance applicative supplémentaire.
  Les montants CAD sont arrondis au cent par activité, demi à l'opposé de zéro;
  les sommes des lignes affichées forment le total. Les durées ne sont pas arrondies
  à l'entier. Les kilomètres équivalents restent affichés à deux décimales.
- Cette convention d'arrondi peut modifier un futur calcul d'un cent par rapport
  à un ancien arrondi seulement à la fin (ex. 2 × 33,75 × 70 % : 47,26 au lieu de
  47,25). Elle ne recalcule ni ne remplace les documents ou paiements historiques.
  La convention fait partie des points à valider avant activation.
- Le titre est lu dans `profiles.professional_title`, sans titre par défaut issu
  de la catégorie de paie. Ce champ est éditable séparément dans l'écran de paie.
  Le script ciblé `supabase/payroll-megan-title-correction.sql` reste à valider.
- Les snapshots conservent période, échéance, titre, honoraires, version du modèle,
  convention de calcul et empreinte des lignes sources; pas les colonnes patient.

## Registre et reprise de l'historique

Migration préparée : `supabase/payroll-invoice-registry.sql`. Elle doit être
revue et testée sur une base de développement avant toute autorisation distante.

1. Archiver les originaux déjà émis, y compris signés, en associant chaque document
   au bon UUID professionnel, à sa période et à sa référence comptable existante.
   Le contenu original et son SHA-256 sont conservés. Le statut de signature peut
   rester inconnu; il n'est jamais transféré à un nouveau document.
2. Les anciens numéros identiques sont admis sur deux factures distinctes; leurs
   UUID les distinguent. Le couple fournisseur/période empêche une création répétée.
   Ne pas modifier les écritures comptables déjà référencées sans rapprochement.
3. Après inventaire et validation comptable, fixer explicitement la date de reprise
   `payroll_invoice_registry_settings.historical_through`. La valeur initiale
   `infinity` bloque toute nouvelle émission sans original : aucune date de reprise
   arbitraire n'est appliquée automatiquement.
4. Les nouvelles références suivent `PEA-AAAA-000001` et un compteur global en base,
   indépendant des initiales. Un verrou transactionnel par fournisseur/période et
   des contraintes uniques protègent créations simultanées et répétitions.
5. Un calcul identique retrouve le même UUID et la même version. Un calcul différent
   exige un rectificatif motivé avec la version attendue; le document précédent doit
   être finalisé. Une correction concurrente périmée est refusée. Une répétition
   identique après réponse perdue ne crée aucune version supplémentaire.
6. Chaque version conserve ses octets Word/PDF et leur empreinte. Le téléchargement
   reprend ces octets, sans relire le profil ni rerendre avec un nouveau modèle.
   Une génération interrompue peut finaliser une seule fois une version réservée.
7. Un rectificatif conserve la référence historique, porte une version distincte,
   son motif et la mention « RECTIFICATIF NON SIGNÉ — nouvelle approbation requise ».
   Aucune image ou approbation de signature de l'original n'est copiée.
8. L'envoi existant lit uniquement le document finalisé du registre. Une pièce
   jointe ou un destinataire fourni par le navigateur ne peut le remplacer.

Les tables du registre sont privées, sans droit navigateur, avec RLS activées;
les routes vérifient identité et droit paie avant accès serveur. Les mises à jour,
suppressions et TRUNCATE de l'historique sont interdits, sauf finalisation unique
des octets d'une version encore vide. Un registre absent échoue sans fallback local.

## Contrôles et limites

- `npm run check` final : types, lint et **241 tests passés**. Trois avertissements
  lint préexistants; aucun nouvel avertissement sur les fichiers modifiés.
- Régressions métier et vrais DOCX : Rim, quantités nulles et fractions, téléphone,
  annulations, titre par profil, totaux et exclusion des données patient.
- Vraies routes exercées hors ligne : droits, recalcul serveur, montant/titre
  falsifiés ignorés, intégrité du téléchargement, original historique et pièce
  jointe d'envoi immuable; fournisseur d'envoi simulé seulement.
- `scripts/test-payroll-invoice-registry.mjs` exécuté contre PostgreSQL embarqué
  PGlite en mémoire, module installé dans le dossier ignoré de travail. Migration,
  répétitions en parallèle, collisions, CAS, signatures, immutabilité, permissions
  et date de reprise par défaut vérifiés. PGlite sérialise une connexion : cela ne
  remplace pas un test de contention à plusieurs connexions PostgreSQL/Supabase.
- Build : compilation TypeScript et pages réussies lors du premier passage, puis
  arrêt sur une alerte de sécurité Next.js. Des relances Turbopack ont échoué dans
  le lancement du processus CSS Windows, y compris hors restriction. Ne pas
  annoncer le build complet comme réussi sur cette seule base.
  Le build Webpack a également compilé, vérifié les types et généré les 58 pages,
  puis s'est arrêté sur l'alerte de sécurité Next.js. Aucune mise à niveau de
  dépendance n'a été lancée dans ce chantier.
- Rendu visuel Word/PDF non validé : LibreOffice absent et automatisation Word
  bloquée. Les aperçus locaux de Rim et Megan sont des brouillons v2 non émis,
  sans signature; ils ne constituent pas des documents approuvés ou prêts à envoyer.
- Aucun essai sur interface connectée à la production; aucune RLS distante,
  migration ou correction de profil appliquée. Validation humaine encore requise.

## Livraison du 23 octobre 2026

- Migrations `payroll-invoice-registry.sql` et `payroll-megan-title-correction.sql` appliquées après autorisation explicite. Le registre démarre vide; aucun original historique n’est importé ou reconstitué automatiquement. Les politiques RLS sont actives.
- `payroll_invoice_registry_settings.historical_through` fixé au **2026-10-18**, date confirmée explicitement par la direction. Toute période commençant à cette date ou avant exige de conserver/importer l’original avant rectificatif.
- Titre de Megan confirmé dans le profil : **Intervenante B.Sc. Ps.éd**. Aucune signature Outlook ou approbation historique modifiée.
- Livraison isolée assignations + facturation : **239 tests réussis**, types et lint validés, build Webpack complet réussi après relance de l’arrêt initial d’avertissement Next.js. Le registre a de nouveau passé ses tests PostgreSQL en mémoire (collisions, répétitions, versions, signatures, immutabilité et permissions).
- Aucun contrat, paiement, montant historique ni document signé modifié. Aucun envoi réel déclenché. Les lignes ambiguës d’Ève restent signalées et bloquent leur émission corrigée jusqu’à confirmation des activités sources. Le rendu Word/PDF reste la limite visuelle décrite plus haut; les vérifications DOCX portent sur les contenus générés.
