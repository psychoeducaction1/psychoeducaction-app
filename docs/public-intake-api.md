# Admission publique WordPress

Le formulaire public de `https://psychoeducaction.com` communique directement
avec les routes publiques de `https://app.psychoeducaction.com`. Aucun secret
Supabase, Resend ou Turnstile ne doit être inclus dans le JavaScript WordPress.

Chaque soumission crée d’abord un prospect dans `public_intake_prospects`.
Elle ne crée jamais automatiquement une ligne dans `waiting_list_clients`.
Après l’appel, la direction qualifie le résultat dans Direction > Prospects.
Seul un transfert volontaire d’un prospect ayant pris le service crée une
fiche dans la liste d’attente.

## Configuration manuelle

1. Exécuter `supabase/public-intake-calendar.sql` dans le SQL Editor Supabase.
2. Définir les variables de `.env.example` dans l’environnement de déploiement.
3. Créer un widget Cloudflare Turnstile pour `psychoeducaction.com`.
4. Placer uniquement la clé publique Turnstile dans WordPress.
5. Déployer l’application seulement après validation en environnement local.

`PUBLIC_INTAKE_HOLD_SECRET` et `PUBLIC_INTAKE_RATE_LIMIT_SALT` doivent être deux
valeurs aléatoires différentes d’au moins 32 caractères.

## Règles communes

- Origine autorisée : `https://psychoeducaction.com`.
- Corps : JSON et aucune donnée personnelle dans l’URL.
- Chaque `POST` exige un en-tête `Idempotency-Key` unique de 16 à 128 caractères.
- Les routes de mutation exigent un jeton Turnstile dans le corps.
- Fuseau horaire : `America/Toronto`.
- Les paramètres d’attribution permis sont `source`, `medium`, `campaign`,
  `term`, `content`, `id`, `gclid`, `gbraid`, `wbraid` et `fbclid`. Ils ne
  doivent jamais contenir de renseignements personnels.

## Disponibilités

`GET /api/public/intake/availability?from=2026-10-05&days=14`

Réponse :

```json
{
  "timeZone": "America/Toronto",
  "callMinutes": 15,
  "bufferMinutes": 15,
  "slots": [
    {
      "startAt": "2026-10-05T12:00:00.000Z",
      "endAt": "2026-10-05T12:15:00.000Z",
      "bufferEndAt": "2026-10-05T12:30:00.000Z"
    }
  ]
}
```

## Retenir un créneau

`POST /api/public/intake/holds`

```json
{
  "startAt": "2026-10-05T12:00:00.000Z",
  "turnstileToken": "jeton-public-turnstile"
}
```

Réponse `201` :

```json
{
  "holdId": "uuid",
  "holdToken": "jeton-de-retenue",
  "startAt": "2026-10-05T12:00:00+00:00",
  "expiresAt": "2026-10-04T15:05:00+00:00"
}
```

La retenue expire après cinq minutes. Un conflit retourne `409`.

## Confirmer une réservation

`POST /api/public/intake/bookings`

```json
{
  "startAt": "2026-10-05T12:00:00.000Z",
  "holdToken": "jeton-de-retenue",
  "intake": {
    "firstName": "Marie",
    "lastName": "Tremblay",
    "birthDate": "1990-04-12",
    "phone": "5145550101",
    "email": "marie@example.com",
    "requestType": "self",
    "requesterNames": [],
    "modalities": ["telehealth", "montreal"],
    "address": null,
    "city": null,
    "postalCode": null,
    "consultationReason": "Court motif facultatif",
    "contactType": "scheduled_call",
    "provenance": "Site web – rendez-vous téléphonique",
    "utm": { "source": "google", "campaign": "automne" }
  }
}
```

Le jeton Turnstile a déjà été validé au moment de la retenue. La confirmation
est autorisée par le jeton de retenue signé et non réutilisable.

Réponse `201` ou `200` pour une répétition idempotente :

```json
{
  "success": true,
  "appointmentId": "uuid",
  "conversionEventId": "uuid distinct",
  "startAt": "2026-10-05T12:00:00+00:00",
  "endAt": "2026-10-05T12:15:00+00:00",
  "notificationPending": false
}
```

`conversionEventId` est un UUID aléatoire distinct de `appointmentId`, créé et
conservé par le serveur pour cette réservation. Le formulaire public l'utilise
comme `conversion_event_id` pour émettre
`booking_form_submitted` uniquement après une confirmation positive de la
réservation. Une répétition idempotente retourne le même `conversionEventId`.
L'objet envoyé au `dataLayer` ne contient que le nom de l'événement et cet
identifiant; `appointmentId` et les données personnelles ou cliniques en sont
exclus.

```javascript
window.dataLayer.push({
  event: "booking_form_submitted",
  conversion_event_id: result.conversionEventId
});
```

## Demander un rappel rapide

`POST /api/public/intake/callbacks`

Le corps contient `turnstileToken` et le même objet `intake`, avec
`contactType: "rapid_callback"`. Réponse :

```json
{
  "success": true,
  "status": "RAPID_CALLBACK_REQUESTED",
  "conversionEventId": "uuid",
  "notificationPending": false
}
```

Le formulaire public émet `rapid_callback_submitted` uniquement après cette
réponse positive. Il utilise `conversionEventId` pour empêcher les doublons,
selon le même mécanisme de stockage local que la réservation.

```javascript
window.dataLayer.push({
  event: "rapid_callback_submitted",
  conversion_event_id: result.conversionEventId
});
```

Le helper `utm()` du formulaire doit lire les paramètres UTM et identifiants
publicitaires conservés dans `localStorage` par le suivi global WordPress. Il
ne doit jamais y ajouter les valeurs des champs du formulaire.
Le branchement teste est dans `wordpress-intake-form-tracking.js`: appeler
`emitIntakeSubmitted(result, type)` apres succes pour les deux types de demande.
Le suivi global conserve une seule provenance pour 30 jours avec consentement
marketing et efface cette conservation lors du retrait. Acquisition affiche
la plateforme, la campagne et la couverture d'attribution. Installation et
verification externes: `conversion-tracking-release.md`.

Les autres actions publiques doivent utiliser des événements distincts :
`contact_form_submitted` après confirmation serveur d’un formulaire de contact
et `phone_click` au clic sur un lien `tel:`. Un clic téléphonique est une
intention et doit rester une conversion secondaire; le suivi Google des appels
avec numéro de transfert permet de mesurer les appels réellement connectés.

## Journal anonyme des autres conversions

`POST /api/public/acquisition-events`

Cette route ne reçoit aucune donnée personnelle ou clinique. Le corps contient
uniquement `eventType` (`contact_form_submitted` ou `phone_click`), `source` et
les paramètres d’attribution autorisés dans `utm`. L’en-tête
`Idempotency-Key` est obligatoire.

Réponse :

```json
{
  "success": true,
  "conversionEventId": "uuid",
  "reused": false
}
```

Le même `Idempotency-Key` retourne toujours le même `conversionEventId`. Le
site peut ensuite pousser au `dataLayer` uniquement le type d’événement et cet
UUID. Les noms, téléphones, courriels, réponses et motifs sont exclus.

Le fichier `docs/wordpress-acquisition-tracking.js` contient le branchement
global prévu pour WPCode. Il suit les confirmations AJAX des formulaires
WPForms 598, 1009 et 2527, ainsi que les clics sur les liens `tel:`. Le formulaire
WPForms historique 3824 est volontairement exclu, puisque la réservation
actuelle utilise l'API publique et son propre `conversion_event_id`.

## Routes internes authentifiées

- `GET /api/direction/intake-calendar?from=<ISO>&to=<ISO>`

## Synchronisation des dépenses publicitaires

Le cron `GET /api/cron/ad-spend-sync` récupère chaque jour les dépenses par
campagne et par date depuis Google Ads et Meta Ads. Les lignes sont conservées
dans `ad_spend_daily`, puis le total mensuel de chaque plateforme remplace la
dépense variable correspondante dans le budget.

Variables Vercel requises pour Google Ads :

Méthode recommandée pour ce compte : installer le script
`scripts/google-ads-spend-sync.js` dans Google Ads et le planifier chaque jour.
Il utilise seulement :

- `GOOGLE_ADS_CUSTOMER_ID`
- `GOOGLE_ADS_INGEST_SECRET`

La méthode API directe demeure disponible si le compte obtient plus tard un
jeton développeur Google Ads :

- `GOOGLE_ADS_CUSTOMER_ID`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` seulement si le compte passe par un compte gestionnaire
- `GOOGLE_ADS_API_VERSION` facultatif, valeur par défaut `v25`

Variables Vercel requises pour Meta Ads :

- `META_AD_ACCOUNT_ID`
- `META_ADS_ACCESS_TOKEN`
- `META_GRAPH_API_VERSION` facultatif, valeur par défaut `v24.0`

Les jetons sont strictement côté serveur. Le bouton de synchronisation manuelle
de la page Acquisition utilise la même logique que le cron et récupère 90 jours
pour la première mise en service.
- `POST /api/direction/intake-calendar/blocks`
- `DELETE /api/direction/intake-calendar/blocks/:id`
- `PATCH /api/direction/intake-appointments/:id`
- `GET /api/direction/prospects`
- `PATCH /api/direction/prospects/:id`
- `POST /api/direction/prospects/:id/transfer`

Ces routes exigent `Authorization: Bearer <jeton Supabase>` et un profil ayant
le rôle `direction`. Les actions de rendez-vous sont `cancel` et `reschedule`.
Le transfert d’un prospect exige un motif de consultation non vide et une priorité
`normal`, `urgent` ou `existing_or_transfer`. L'interface utilise cette action lors
du choix « Service pris » : le RPC crée la fiche et classe le prospect dans
`transferred_to_waiting_list` atomiquement, sans imposer un statut préalable.
Un nouvel appel pour un prospect déjà transféré retourne le même identifiant client.

## Vie privée et suivi

Le backend n’envoie aucun événement à Meta ou Google. Le formulaire WordPress
peut transmettre des événements techniques sans nom, téléphone, courriel,
date de naissance, adresse, motif ou identifiant de dossier. Le motif de
consultation ne doit jamais être placé dans une URL ou un journal technique.
