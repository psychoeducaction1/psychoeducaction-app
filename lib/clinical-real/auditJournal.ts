export type ClinicalAuditEvent = {
  id: string
  occurredAt: string
  actorId: string
  actorName: string | null
  actorRole: string | null
  action: string
  caseId: string | null
  resourceId: string
  version: number | null
  cancellationOrigin?: string | null
  calendarAction?: string | null
}

const clinicalActionLabels: Record<string, string> = {
  patient_created: 'Client clinique créé',
  patient_admin_updated: 'Fiche administrative modifiée',
  contact_added: 'Contact ajouté',
  representative_added: 'Représentant ajouté',
  payer_added: 'Payeur ajouté',
  request_created: 'Demande clinique créée',
  episode_created: 'Épisode de service créé',
  legacy_linked: 'Assignation liée au dossier',
  case_created: 'Dossier clinique créé',
  case_access_granted: 'Accès au dossier accordé',
  case_access_revoked: 'Accès au dossier révoqué',
  note_created: 'Note clinique créée',
  note_saved: 'Note clinique enregistrée',
  note_read: 'Note clinique consultée',
  note_listed: 'Liste des notes consultée',
  note_appointment_choices_read: 'Rencontres liées aux notes consultées',
  note_signed: 'Note clinique signée',
  note_cosigned: 'Note clinique cosignée',
  note_amendment_created: 'Complément de note créé',
  appointment_created: 'Rencontre créée',
  appointment_updated: 'Rencontre modifiée',
  appointment_rescheduled: 'Rencontre déplacée',
  appointment_removed: 'Rencontre supprimée',
  activity_corrected: 'Rencontre effectuée corrigée',
  appointment_cancelled: 'Rencontre annulée',
  appointment_series_created: 'Série de rencontres créée',
  office_updated: 'Bureau modifié',
  availability_updated: 'Disponibilité modifiée',
}

export function clinicalAuditLabel(action: string): string {
  return Object.hasOwn(clinicalActionLabels, action) ? clinicalActionLabels[action] : 'Événement clinique enregistré'
}

export function clinicalAuditRow(event: ClinicalAuditEvent) {
  const origins: Record<string, string> = { client: 'du client', professional: 'du professionnel', clinic: 'de la clinique' }
  const calendarAction = event.action === 'appointment_updated' && ['appointment_rescheduled', 'appointment_removed', 'activity_corrected'].includes(event.calendarAction ?? '') ? event.calendarAction! : event.action
  const origin = event.action === 'appointment_cancelled' && Object.hasOwn(origins, event.cancellationOrigin ?? '') ? origins[event.cancellationOrigin!] : undefined

  return {
    id: `clinical:${event.id}`,
    created_at: event.occurredAt,
    actor_profile_id: event.actorId,
    actor_name: event.actorName,
    actor_role: event.actorRole,
    action: `clinical_${calendarAction}`,
    entity_type: 'clinical',
    entity_id: event.resourceId,
    description: origin ? `Rencontre annulée à la demande ${origin}.` : clinicalAuditLabel(calendarAction) + '.',
    metadata: { ...(event.version === null ? {} : { version: event.version }), calendar_action: event.calendarAction ?? null },
  }
}
