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
- Les paramètres UTM permis sont `source`, `medium`, `campaign`, `term` et
  `content`. Ils ne doivent jamais contenir de renseignements personnels.

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
  "startAt": "2026-10-05T12:00:00+00:00",
  "endAt": "2026-10-05T12:15:00+00:00",
  "notificationPending": false
}
```

## Demander un rappel rapide

`POST /api/public/intake/callbacks`

Le corps contient `turnstileToken` et le même objet `intake`, avec
`contactType: "rapid_callback"`. Réponse :

```json
{
  "success": true,
  "status": "RAPID_CALLBACK_REQUESTED",
  "notificationPending": false
}
```

## Routes internes authentifiées

- `GET /api/direction/intake-calendar?from=<ISO>&to=<ISO>`
- `POST /api/direction/intake-calendar/blocks`
- `DELETE /api/direction/intake-calendar/blocks/:id`
- `PATCH /api/direction/intake-appointments/:id`
- `GET /api/direction/prospects`
- `PATCH /api/direction/prospects/:id`
- `POST /api/direction/prospects/:id/transfer`

Ces routes exigent `Authorization: Bearer <jeton Supabase>` et un profil ayant
le rôle `direction`. Les actions de rendez-vous sont `cancel` et `reschedule`.
Le transfert d’un prospect exige le statut `service_taken` et une priorité
`normal`, `urgent` ou `existing_or_transfer`.

## Vie privée et suivi

Le backend n’envoie aucun événement à Meta ou Google. Le formulaire WordPress
peut transmettre des événements techniques sans nom, téléphone, courriel,
date de naissance, adresse, motif ou identifiant de dossier. Le motif de
consultation ne doit jamais être placé dans une URL ou un journal technique.
