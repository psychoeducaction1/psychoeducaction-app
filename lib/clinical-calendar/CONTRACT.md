# Calendrier clinique fictif

Service pur `createClinicalCalendarService({store,directory,now,newId})`, calendrier commercial existant conservé séparément. Le fournisseur d'annuaire est reconstruit sous l'acteur courant depuis la projection minimale du noyau clinique. Il ne lit aucune note clinique.

- Dates UTC en mémoire, saisie/affichage `America/Toronto`. Une heure inexistante est refusée; une heure double demande `earlier` ou `later`. Les répétitions hebdomadaires conservent l'heure locale.
- Durée entière 1–720 minutes, déplacements 0–180 minutes, séries de 2–12 occurrences, période lue de 1–93 jours.
- Modalités `office`, `home`, `phone`, `video`. Un bureau actif est obligatoire uniquement pour `office`.
- États `planned`, `completed`, `cancelled`, `no_show`. Une échéance passée ne marque jamais une rencontre effectuée. Le résultat est une action explicite après son début; une rencontre effectuée/absente n'est plus déplacée ni annulée.
- Interface : « Absence du client » n'est pas un type proposé à la création d'une activité. La déclaration d'absence sur une rencontre existante et la lecture des absences historiques restent disponibles.
- Les chevauchements sont refusés pour le professionnel avec ses déplacements, le bureau sur la rencontre proprement dite et le patient sur l'ensemble de ses dossiers. Bornes semi-ouvertes : des rencontres adjacentes sont permises.
- Les disponibilités enregistrées sont facultatives et ne conditionnent pas la création ou le déplacement d'une rencontre. Une série entière et ses événements sont préparés avant la mutation; un seul conflit empêche toute création.
- Direction/adjoints : gestion administrative du calendrier sans contenu de notes. Professionnel/superviseur : son agenda et dossiers actuellement autorisés. L'occupation tierce ne contient ni nom de client, ni identifiant de dossier ou rendez-vous.
- Une mutation de rendez-vous exige `expectedVersion`. Un remplacement de disponibilités exige une révision **par professionnel**, y compris lors du premier remplacement : 0 si absente, puis +1. La réponse GET donne `availabilityRevisions[professionalId]`; une révision obsolète produit un conflit 409, sans écraser les plages. Une modification d'un autre professionnel ne change pas cette révision.
- L'annulation conserve les enregistrements et son origine; elle peut porter sur cette occurrence et les suivantes encore planifiées.

## API locale

`GET /api/clinical-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` renvoie `{workspace}`. `POST` accepte `create`, `reschedule`, `cancel`, `outcome`, `availability`. Pour cette dernière :

```json
{
  "action": "availability",
  "professionalId": "UUID du professionnel fictif",
  "expectedRevision": 0,
  "input": [{ "weekday": 1, "startMinute": 480, "endMinute": 1080, "validFrom": "2026-10-19", "validTo": null }]
}
```

Les trois verrous de développement isolé et un acteur fictif autorisé précèdent tout accès au singleton. Aucun adaptateur Supabase, notification ou rappel n'est appelé. L'en-tête d'acteur est une simulation, pas une authentification de production.

## Ponts minimaux

`getBillingAppointments(actorId)` expose au service financier seulement identifiants de rencontre/client/professionnel, début/fin et état. Pour un professionnel, seules ses propres rencontres sont retournées. Cette métadonnée financière peut exister après le retrait de son accès clinique; sa projection finale d'honoraires masque alors le nom du client.

`getNoteAppointmentChoices(actorId,caseId)` et `resolveNoteAppointment(actorId,appointmentId)` servent au noyau clinique. Ils exigent un auteur professionnel/superviseur, sa propre rencontre et un accès actuel au dossier; seules les rencontres planifiées/effectuées sont admissibles. Retour exact : `id`, `caseId`, `clientId`, `professionalId`, `startAt`, `endAt`, `modality`, `status`, `version`. Aucun texte de note ne revient dans l'agenda. La liaison signée doit conserver son instantané/version; le noyau décide des règles de signature et modification du lien.

## Limites

Le magasin global est partagé par les routes d'un même processus, perdu au redémarrage et distinct entre processus. Les transitions synchrones et CAS testent les règles de la maquette; ils ne remplacent pas les transactions d'une base. La référence SQL et ses tests mémoire sont séparés, non branchés à l'API. Aucun contrôle local ne vaut validation de RLS ou de comportement en production.
