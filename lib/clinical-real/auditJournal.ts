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
  appointment_cancelled: 'Rencontre annulée',
  appointment_series_created: 'Série de rencontres créée',
  office_updated: 'Bureau modifié',
  availability_updated: 'Disponibilité modifiée',
}

export function clinicalAuditLabel(action: string): string {
  return clinicalActionLabels[action] ?? `Action clinique : ${action.replaceAll('_', ' ')}`
}

export function clinicalAuditRow(event: ClinicalAuditEvent) {
  return {
    id: `clinical:${event.id}`,
    created_at: event.occurredAt,
    actor_profile_id: event.actorId,
    actor_name: event.actorName,
    actor_role: event.actorRole,
    action: `clinical_${event.action}`,
    entity_type: 'clinical',
    entity_id: event.resourceId,
    description: `${event.caseId
      ? `Dossier clinique · référence ${event.caseId.slice(0, 8)}`
      : 'Administration clinique'}${event.version === null ? '' : ` · version ${event.version}`}`,
    metadata: event.version === null ? null : { version: event.version },
  }
}
