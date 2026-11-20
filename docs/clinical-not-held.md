# Rencontre annulée ou client absent — préparation 1030

Périmètre confirmé : Direction/administration autorisée et professionnels cliniques
déjà activés, sur leurs propres rencontres. Aucun autre compte n'est activé.

Depuis une rencontre existante, même marquée Réalisée, choisir « Rencontre annulée
ou client absent », puis le résultat, l'origine de l'annulation et les frais permis.
Une absence ne peut être déclarée avant l'heure de début. Le choix porte par défaut
sur cette occurrence ; l'annulation existante des occurrences planifiées d'une
série reste disponible, sans frais. La création d'une activité ne propose plus
l'absence du client.

Les notes restent visibles avec une mention séparée du texte signé. Aucune note,
signature, transcription ou version clinique n'est réécrite.

## Facturation et honoraires

- Conditions acceptées imposées côté serveur : 0/50/100 %, aucun frais pour une
  annulation professionnelle, clinique ou avec préavis d'au moins 24 heures.
- La date de déclaration sert de préavis ; aucune date historique n'est inventée.
  Cette action ne facture pas de déplacement.
- Facture existante annulée sans crédit automatique ; les autres rencontres
  sont reprises dans un nouveau brouillon. Le traitement automatique existant
  reprend les frais d'absence convenus sans doubler une prestation.
- Les anciens calculs non validés restent dans l'archive de révisions financières
  avant remplacement. Une rencontre annulée n'alimente plus de nouveaux honoraires
  comme si elle avait été effectuée.
- Paiement existant conservé. Envoi et nouveau paiement sur le remplacement
  bloqués jusqu'à sa vérification par Direction/administration. Aucun débit,
  remboursement ou envoi n'est appelé.
- Des honoraires déjà validés exigent une correction administrative préalable :
  le serveur refuse leur réécriture silencieuse et explique le blocage.

## Installation et vérification

Appliquer `supabase/clinical/real-1030-not-held-encounters.sql` et publier le code
ensemble, après autorisation. La migration ne requalifie aucune rencontre.
Elle échoue entièrement si les points précis des fonctions étendues ont changé.

Projection calendrier 1030, commande `appointments.not-held`. Identité et droits
vérifiés côté SQL, décisions privées et immuables, contrôle de version et
empreinte de confirmation, reçu idempotent. Verrous sur le professionnel, le
dossier, la rencontre et les factures. Le résultat courant des notes reste
extérieur au contenu signé.

Recette : `node scripts/clinical-db/test-not-held-encounters.mjs`, sur une base
Docker jetable créée depuis le seul schéma local, avec fixtures fictives,
transaction annulée et base supprimée. Aucun endpoint distant ni fournisseur.
Tests de validation et choix des frais : `tests/notHeld.test.ts`.
La recette ne remplace ni un essai navigateur authentifié ni une épreuve de
concurrence entre deux connexions.
