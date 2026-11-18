# Facture : présentation et carte enregistrée — 18 novembre 2026

Copie : `C:\Users\thinh\Documents\assignations-app\output\billing-ui-isolated-20261118`.
Branche : `codex/billing-ui-20261118`.
Base exacte du patch : `1c7a23f186348098d706ee4250cceeafa7ce8294`.
Référence initiale locale avant retouches : `c23716a50a8ba4151dd4b1370bd35efc83546e88` (la base suivante ajoute seulement les déclarations Next de référence).

Base publiée confirmée par le reçu du chat principal : `dpl_mnZQW8D9feosMpXTvVaUtrMFHWAt`, candidat `migration-review-release-20261118`. Les 591 fichiers applicatifs ont été vérifiés contre `output/unification-pilot/docs/migration/MIGRATION_REVIEW_RELEASE.json` ; sources complémentaires du commit `ae6c4499f7b7be31fa4f6bef314b713a06244f7c`. Aucun départ depuis main, fichier .env, dossier .vercel ou configuration de publication importé. La copie partagée est conservée.

## Changements

- Le bouton et le panneau d’annulation manuelle de facture disparaissent. L’API refuse `invoice.void` après authentification ; le script SQL préparé ferme également cet appel RPC direct. Les factures déjà annulées et les corrections automatiques liées aux activités restent conservées. Les corrections de paiements et remboursements restent accessibles.
- Envoyer la facture et son destinataire se trouvent immédiatement après le total.
- Fermer cette facture et son explication sont placés tout en bas ; le titre Terminer cette facture est remplacé. Les règles existantes de fermeture, numérotation, envoi et paiement restent les mêmes.
- Le bloc autonome Carte de crédit de… et son message d’absence de carte sont retirés.
- Paiement et reçu contient le choix Carte de crédit uniquement lorsque le serveur confirme une carte du **payeur de cette facture**. Ce choix est présélectionné automatiquement, sauf choix manuel déjà effectué. Une absence ou une erreur de lecture n’expose pas cette option ; les autres modes restent disponibles.
- La carte utilise la commande Stripe existante, sa confirmation explicite, son contrôle de montant/version et sa clé de reprise. Aucun paiement par carte n’est enregistré artificiellement avec `payment.record`. Le montant saisi est conservé lors du changement de mode. La sélection de carte ne déclenche aucun débit.
- La recherche de carte est privée, annulée au démontage et liée au couple client/payeur pour éviter une carte périmée lors d’un changement de dossier. Les changements de mode utilisent le garde de navigation existant ; le formulaire de carte bloque le changement pendant une demande de débit.

## Fichiers

- `components/clinical-billing/InvoiceDetail.tsx` : ordre envoi/paiement/fermeture et retrait du bloc carte autonome.
- `InvoicePayment.tsx` : regroupement du choix de paiement et intégration de la carte existante ; paiements manuels et remboursements conservés.
- `SavedCardChargePanel.tsx` : recherche réutilisable de carte, formulaire d’encaissement intégré, mécanisme Stripe existant conservé.
- `PaymentCorrections.tsx` : retrait de l’annulation de facture, conservation des corrections de paiements.
- `lib/clinical-unification/financeHttp.ts` : refus de l’annulation manuelle par l’API.
- `supabase/clinical/real-980-disable-manual-invoice-void.sql` : enveloppe RPC qui refuse l’annulation manuelle et délègue les autres commandes ; aucun enregistrement modifié à l’installation.
- `tests/billingInvoiceSimplification.test.mjs` : tests React/interaction, recherche et portée de carte, confirmation de débit avec transport simulé et garde SQL sur PostgreSQL embarqué fictif.

## Intégration et limites

Intégrer uniquement le commit fonctionnel fourni, préserver les autres changements du chat principal. Examiner puis appliquer séparément 980 pour fermer aussi le RPC direct ; **aucun SQL distant exécuté ici**. Ne pas appliquer la seule interface et considérer la protection RPC installée. La migration suppose le contrat existant `clinical_unified_finance_command(uuid,text,jsonb)`. Attention aux changements parallèles sur ces composants de facturation et à un éventuel numéro de migration 980 déjà utilisé ailleurs.

Le mode Stripe existant reste inchangé (le libellé actuel mentionne Stripe test). Aucune clé, activation de paiement ou configuration de production n’est modifiée. Aucun débit, courriel, annulation de facture ou donnée réelle utilisé pendant les contrôles.

Contrôles : **5 tests ciblés réussis**, TypeScript global sans émission, ESLint ciblé sans erreur ni avertissement et diff vérifié. SQL exécuté dans une base PGlite jetable avec un contrat minimal : cela vérifie le refus/délégation et les privilèges de l’enveloppe, pas un rejeu intégral du registre financier. Le rendu des vrais composants et leurs interactions sont exercés avec données fictives et transport de paiement simulé.

Non exécutés : navigateur réel/mobile, build complet, intégration Stripe ou registre financier distant. L’intégration, la migration distante et la publication sont réservées au chat principal.
