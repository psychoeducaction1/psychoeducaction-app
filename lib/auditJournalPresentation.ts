import { legacyAuditActions } from '@/lib/clinical-workspace/legacyPresentation'
import { clinicalAuditLabel } from '@/lib/clinical-real/auditJournal'

type Row = { action: string | null; entity_type?: string | null; description?: string | null; metadata?: Record<string, unknown> | null }
const technicalActions = new Set([
  'waiting_calendar_correction_started', 'waiting_calendar_correction_completed',
  'notification_simulated', 'capacities.update', 'preferences.update',
  'office_updated', 'office_changed', 'office_grants_changed',
  'availability_updated', 'availability_changed',
  'financial_conditions_recorded', 'activity_financial_settings_changed',
  'absence_financial_decision_recorded', 'appointment_completed_automatic',
])
const extraLabels: Record<string, string> = {
  intake_appointment_cancelled: 'Rendez-vous téléphonique annulé',
  intake_followup_appointment_created: 'Rendez-vous de suivi réservé',
  additive_administrative_access_granted: 'Accès administratif accordé',
  platform_access_disabled: 'Accès à la plateforme désactivé',
  waiting_list_client_deleted: 'Client retiré de la liste d’attente',
}

/** Presentation only: never used to suppress audit writers or delete records. */
export function isBusinessAuditEvent(row: Row): boolean {
  const action = row.action ?? ''
  const bare = action.startsWith('clinical_') ? action.slice(9) : action
  return !technicalActions.has(action) && !technicalActions.has(bare)
    && !(typeof row.metadata?.calendar_action === 'string' && technicalActions.has(row.metadata.calendar_action))
    && !/^(?:note_|migration_|lab_|pdf_storage_)/.test(bare)
    && !['note', 'clinical_note', 'migration', 'migration_batch', 'migration_item'].includes(row.entity_type ?? '')
}

export function auditActionLabel(action: string | null): string {
  if (!action) return 'Événement enregistré'
  if (action.startsWith('clinical_')) return clinicalAuditLabel(action.slice(9))
  return Object.hasOwn(extraLabels, action) ? extraLabels[action]
    : Object.hasOwn(legacyAuditActions, action) ? legacyAuditActions[action] : 'Événement enregistré'
}

export function auditDescription(row: Row): string {
  const status = row.metadata?.new_status
  if (row.action === 'assignment_status_changed') {
    if (status === 'taken' || status === true) return 'Le statut du service est passé à « Service pris ».'
    if (status === 'not_taken' || status === false) return 'Le statut du service est passé à « Service non pris ».'
    if (status === 'pending') return 'Le statut du service est passé à « En attente ».'
    if (status === 'not_contacted') return 'Le client est à contacter.'
  }
  if (row.action?.startsWith('clinical_')) return row.description || auditActionLabel(row.action) + '.'
  const known = row.action && (Object.hasOwn(extraLabels, row.action) || Object.hasOwn(legacyAuditActions, row.action))
  return known && row.description?.trim() ? row.description : auditActionLabel(row.action) + '.'
}
