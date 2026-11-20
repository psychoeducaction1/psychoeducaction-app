import type { ClinicalAuditEvent, ClinicalRecordSummary, WorkspaceView } from '@/lib/clinical-core/types'

const auditLabels: Readonly<Record<string, string>> = {
  'profile.update': 'Coordonnées du client modifiées', 'person.create': 'Requérant ou responsable ajouté',
  'person.update': 'Requérant ou responsable modifié', 'document.create': 'Document privé ajouté',
  'record.close': 'Dossier fermé', 'record.reopen-request': 'Réactivation du dossier demandée', 'record.reopen': 'Dossier réactivé',
  'client.create': 'Identité client créée', patient_created: 'Identité client créée',
  'client.admin.update': 'Dossier administratif modifié', patient_admin_updated: 'Dossier administratif modifié',
  'client.contact.create': 'Contact associé', contact_added: 'Contact associé',
  'client.representative.create': 'Représentant associé', representative_added: 'Représentant associé',
  'client.payer.create': 'Payeur associé', payer_added: 'Payeur associé',
  'request.create': 'Demande de service créée', request_created: 'Demande de service créée',
  'episode.create': 'Épisode de service ouvert', episode_created: 'Épisode de service ouvert',
  'assignment.link': 'Lien d’assignation préparé', legacy_linked: 'Lien d’assignation préparé',
  assignment_created: 'Assignation créée',
  'record.create': 'Dossier clinique créé', case_created: 'Dossier clinique créé',
  'record.access.update': 'Autorisations cliniques modifiées',
  case_access_granted: 'Accès au dossier accordé', case_access_revoked: 'Accès au dossier retiré',
  'record.read': 'Dossier clinique consulté', lab_record_read: 'Dossier clinique consulté',
  'note.create': 'Brouillon créé', note_created: 'Brouillon créé',
  'note.read': 'Note consultée', note_read: 'Note consultée',
  note_listed: 'Liste des notes consultée', note_appointment_choices_read: 'Rencontres consultées pour une note',
  'note.save': 'Nouvelle version sauvegardée', note_saved: 'Nouvelle version sauvegardée',
  'note.sign': 'Note signée', note_signed: 'Note signée',
  'note.cosign': 'Note cosignée', note_cosigned: 'Note cosignée',
  'note.amend.create': 'Amendement créé', note_amendment_created: 'Amendement créé',
  appointment_created: 'Rendez-vous créé', appointment_updated: 'Rendez-vous modifié',
  appointment_cancelled: 'Rendez-vous annulé', appointment_series_created: 'Série de rendez-vous créée',
  office_updated: 'Bureau mis à jour', availability_updated: 'Disponibilités mises à jour',
  'clients.list': 'Liste des clients consultée', lab_clients_read: 'Liste des clients consultée',
  'workspace.read': 'Espace consulté', lab_workspace_read: 'Espace consulté',
  'audit.read': 'Journal consulté', lab_audit_read: 'Journal consulté',
  lab_actors_read: 'Intervenants autorisés consultés', lab_command_replayed: 'Opération déjà confirmée retrouvée',
  'scheduling.directory.read': 'Droits de planification vérifiés',
}

const resourceLabels = { client: 'Client', record: 'Dossier clinique', note: 'Note clinique', workspace: 'Espace de travail' } as const
export function clinicalAuditLabel(action: string) { return auditLabels[action] ?? 'Activité enregistrée' }
export function clinicalAuditResourceLabel(event: ClinicalAuditEvent, workspace: Pick<WorkspaceView, 'clients' | 'records'>): string {
  const client = workspace.clients.find(item => item.id === event.clientId || event.resourceType === 'client' && item.id === event.resourceId)
  const record = workspace.records.find(item => item.id === event.recordId || event.resourceType === 'record' && item.id === event.resourceId)
  // Only the current authorized projection supplies names. Never read a note,
  // arbitrary event details, or an administrative managedRecord as clinical text.
  return [resourceLabels[event.resourceType] ?? 'Ressource autorisée',
    client ? client.firstName + ' ' + client.lastName : null,
    record ? record.label : null].filter(Boolean).join(' · ')
}

const normalizeSearch = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').trim()
export type ClinicalRecordDirectoryEntry = { record: ClinicalRecordSummary; clientName: string; birthDate: string | null; episodeLabel: string }
export function clinicalRecordDirectory(workspace: Pick<WorkspaceView, 'clients' | 'records'>, search = ''): ClinicalRecordDirectoryEntry[] {
  const query = normalizeSearch(search)
  return workspace.records.map(record => {
    const client = workspace.clients.find(item => item.id === record.clientId)
    return { record, clientName: client ? client.firstName + ' ' + client.lastName : 'Identité non disponible',
      birthDate: client?.birthDate ?? null,
      episodeLabel: client?.episodes.find(episode => episode.id === record.episodeId)?.label ?? 'Épisode non disponible' }
  }).filter(entry => !query || normalizeSearch([entry.clientName, entry.episodeLabel, entry.record.label].join(' ')).includes(query))
}

export function clinicalAuditEntries(events: readonly ClinicalAuditEvent[], workspace: Pick<WorkspaceView, 'clients' | 'records'>, resourceType: ClinicalAuditEvent['resourceType'] | '', search = '') {
  const query = normalizeSearch(search)
  return [...events].reverse().filter(event => (!resourceType || event.resourceType === resourceType) && (!query ||
    normalizeSearch([clinicalAuditLabel(event.action), clinicalAuditResourceLabel(event, workspace)].join(' ')).includes(query)))
}
