import {
  clientGroupOptions, meetingModeOptions, motifOptions, officeLocationOptions,
  serviceTypeOptions,
} from '@/lib/professionalPreferences'

const preferenceLabels: Record<string, string> = {
  pref_languages: 'Langues', pref_age_ranges: 'Âges acceptés',
  pref_client_groups: 'Clientèles', pref_service_types: 'Services',
  pref_office_locations: 'Bureaux', pref_meeting_modes: 'Modalités de rencontre',
  pref_motifs: 'Motifs de consultation', pref_exclusions: 'Exclusions et limites',
  pref_matching_notes: 'Notes de jumelage',
}

const optionLabels = new Map([
  ...clientGroupOptions, ...meetingModeOptions, ...motifOptions,
  ...officeLocationOptions, ...serviceTypeOptions,
  { value: 'psychoeducational_assessment', label: 'Évaluation psychoéducative' },
  { value: 'ivac', label: 'IVAC' },
  { value: 'intervenant_psychoeducation', label: 'Intervenant en psychoéducation' },
  { value: 'psychoeducateur_membre_ordre', label: 'Psychoéducateur membre de l’Ordre' },
  { value: 'psychotherapeute', label: 'Psychothérapeute' },
].map(option => [option.value, option.label]))

export function legacyPreferenceLabel(key: string): string {
  return preferenceLabels[key] ?? key.replace(/^pref_/, '').replaceAll('_', ' ')
}

function ageRange(value: Record<string, unknown>): string | null {
  if (typeof value.min !== 'number' || !Number.isFinite(value.min)) return null
  if (value.max === null) return `${value.min} ans et plus`
  if (typeof value.max === 'number' && Number.isFinite(value.max)) return `${value.min} à ${value.max} ans`
  return null
}

export function legacyPreferenceValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => legacyPreferenceValue(item)).filter(item => item !== '—').join(', ') || '—'
  if (typeof value === 'string') return optionLabels.get(value.trim()) ?? (value.trim() || '—')
  if (value && typeof value === 'object') {
    const range = ageRange(value as Record<string, unknown>)
    if (range) return range
    return Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([key]) => optionLabels.get(key) ?? key).join(', ') || '—'
  }
  return '—'
}

export const legacyAuditActions: Record<string, string> = {
  administrative_assignment_task_created: 'Tâche d’assignation créée',
  administrative_task_created_from_waiting_list: 'Tâche créée depuis la liste d’attente',
  assigned_client_canceled: 'Assignation annulée',
  assigned_client_deleted: 'Assignation supprimée',
  assignment_created: 'Assignation créée',
  assignment_process_client_email_sent: 'Courriel au client envoyé pour une démarche',
  assignment_process_reopened: 'Démarche d’assignation rouverte',
  assignment_process_started: 'Démarche d’assignation commencée',
  assignment_request_created_by_direction: 'Demande professionnelle créée par la direction',
  assignment_request_created_by_super_admin: 'Demande professionnelle créée par l’administration',
  assignment_request_deleted: 'Demande professionnelle supprimée',
  assignment_request_increased_by_direction: 'Demande professionnelle augmentée par la direction',
  assignment_request_increased_by_super_admin: 'Demande professionnelle augmentée par l’administration',
  assignment_status_changed: 'Statut de l’assignation modifié',
  client_assignment_email_resent: 'Courriel d’assignation renvoyé au client',
  client_notification_failed: 'Courriel au client échoué',
  client_notification_not_sent: 'Courriel au client non envoyé',
  client_notification_sent: 'Courriel au client envoyé',
  intake_appointment_rescheduled: 'Appel d’admission déplacé',
  intake_calendar_block_created: 'Bloc du calendrier d’admission créé',
  intake_calendar_block_deleted: 'Bloc du calendrier d’admission supprimé',
  payroll_invoice_email_sent: 'Courriel de facturation professionnelle envoyé',
  payroll_professional_title_corrected: 'Titre professionnel corrigé',
  pending_contact_reminder_sent: 'Rappel de prise de contact envoyé',
  platform_access_enabled: 'Accès plateforme activé',
  professional_access_resent: 'Invitation professionnelle renvoyée',
  professional_assignment_email_resent: 'Courriel d’assignation renvoyé au professionnel',
  professional_created: 'Professionnel créé',
  professional_deleted: 'Professionnel supprimé',
  professional_notification_failed: 'Courriel professionnel échoué',
  professional_notification_not_sent: 'Courriel professionnel non envoyé',
  professional_notification_sent: 'Courriel professionnel envoyé',
  professional_preferences_announcement_recipient_sent: 'Annonce des préférences envoyée au destinataire',
  public_intake_appointment_created: 'Appel d’admission public créé',
  public_intake_callback_requested: 'Rappel demandé depuis le formulaire public',
  public_intake_prospect_status_updated: 'Statut du prospect public modifié',
  public_intake_prospect_transferred_to_waiting_list: 'Prospect transféré à la liste d’attente',
  service_taken_confirmation_email_sent: 'Confirmation du service pris envoyée',
  unreachable_client_followup_sent: 'Relance d’un client injoignable envoyée',
  waiting_calendar_correction_completed: 'Correction du calendrier d’attente terminée',
  waiting_calendar_correction_started: 'Correction du calendrier d’attente commencée',
  waiting_list_client_created: 'Client ajouté à la liste d’attente',
  waiting_list_client_marked_off_platform: 'Client marqué hors plateforme',
  waiting_list_client_permanently_deleted: 'Client supprimé définitivement',
  waiting_list_client_restored: 'Client rétabli dans la liste d’attente',
}

const auditStatuses: Record<string, string> = {
  callback_requested: 'Rappel demandé', contacted: 'Contacté', false: 'Non', true: 'Oui',
  not_contacted: 'Non contacté', not_taken: 'Service non pris', other: 'Autre',
  pending: 'En attente', scheduled: 'Planifié', service_not_taken: 'Service non pris',
  service_taken: 'Service pris', taken: 'Service pris',
}
const auditRoles: Record<string, string> = {
  direction: 'Direction', professionnel: 'Professionnel', public: 'Public', system: 'Système',
}

export function legacyAuditStatus(value: string): string { return auditStatuses[value] ?? value }
export function legacyAuditRole(value: string): string { return auditRoles[value] ?? value }
