import { serviceTypeOptions } from '@/lib/professionalPreferences'
import type { ClientAdminProjection, ClinicalRecordSummary, WorkspaceView } from '@/lib/clinical-core/types'

export type ClientFileTab = 'activities' | 'notes' | 'documents' | 'communications'
export type ClientDirectoryStatus = 'active' | 'archived' | 'all'
export const clientFileTabs = (context: WorkspaceView['context']) => [
  { id: 'activities' as const, label: 'Activités' },
  ...(context === 'clinical' ? [{ id: 'notes' as const, label: 'Notes cliniques' }] : []),
  { id: 'documents' as const, label: 'Documents' }, { id: 'communications' as const, label: 'Historique des courriels' },
]
export function clientFileTab(context: WorkspaceView['context'], requested: string | null): ClientFileTab {
  return clientFileTabs(context).find(tab => tab.id === requested)?.id ?? 'activities'
}
export function clientFileRecords(workspace: WorkspaceView, clientId: string): ClinicalRecordSummary[] {
  return workspace.context === 'clinical' ? workspace.records.filter(record => record.clientId === clientId) : []
}
export function clientIsArchived(workspace: WorkspaceView, client: ClientAdminProjection): boolean {
  const records = [...workspace.records, ...workspace.managedRecords].filter(record => record.clientId === client.id)
  return client.episodes.length > 0 && client.episodes.every(episode => episode.status === 'closed')
    && records.every(record => record.status === 'closed')
}
export function clientDirectoryProfessionals(workspace: WorkspaceView) {
  if (workspace.context !== 'administration') return []
  const assigned = new Set(workspace.clients.flatMap(client => client.assignments.map(assignment => assignment.professionalId)))
  return workspace.actors.filter(actor => assigned.has(actor.id)).sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr-CA'))
}
export function clientDirectoryRows(workspace: WorkspaceView, search: string, status: ClientDirectoryStatus, professionalId = '') {
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').trim()
  return workspace.clients.filter(client => normalize(`${client.firstName} ${client.lastName} ${client.caseNumber ?? ''}`).includes(normalize(search))
    && (!professionalId || client.assignments.some(assignment => assignment.professionalId === professionalId))
    && (status === 'all' || clientIsArchived(workspace, client) === (status === 'archived')))
}
export function clientServiceDisplayLabel(value: string): string { return serviceTypeOptions.find(option => option.value === value)?.label ?? value }
/** Format only the known numeric-percent shape; descriptive responsibilities remain verbatim. */
export function clientPayerResponsibilityLabel(value: string): string {
  const match = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(value.trim())
  if (!match) return value
  const amount = Number(match[1].replace(',', '.'))
  return Number.isFinite(amount) && amount >= 0 && amount <= 100 ? new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 }).format(amount) + '%' : value
}
export function clientServiceLabel(client: ClientAdminProjection): string {
  const activeRequests = new Set(client.episodes.filter(episode => episode.status === 'open').map(episode => episode.requestId))
  const services = [...new Set(client.requests.filter(request => activeRequests.has(request.id) || request.status === 'open').map(request => clientServiceDisplayLabel(request.service)).filter(Boolean))]
  return services.join(' · ') || clientServiceDisplayLabel(client.requests.at(-1)?.service ?? '') || 'Service à préciser'
}
export function clientResponsibleNames(workspace: WorkspaceView, client: ClientAdminProjection): string[] {
  const ids = new Set(client.assignments.filter(item => item.status === 'active').map(item => item.professionalId))
  if (!ids.size && workspace.context === 'clinical') clientFileRecords(workspace, client.id).forEach(record => record.members.filter(member => member.canWrite).forEach(member => ids.add(member.actorId)))
  return [...ids].map(id => workspace.actors.find(actor => actor.id === id)?.displayName ?? 'Professionnel responsable')
}
/** Only the directory's own state survives returning from a file; module filters never do. */
export function clientDirectoryReturn(query: URLSearchParams): Record<string, string | null> {
  return { client: null, record: null, note: null, appointment: null, clientTab: null, clientMode: null,
    recherche: query.get('recherche'), page: query.get('page'), directoryStatus: query.get('directoryStatus'), directoryProfessional: query.get('directoryProfessional'),
    view: query.get('view') === 'assignments' ? 'assignments' : null, tab: query.get('view') === 'assignments' ? query.get('tab') : null }
}
export function clientModuleNavigation(clientId: string, tab: ClientFileTab, query: Record<string, string | null>): Record<string, string | null> {
  return { ...query, client: clientId, clientTab: tab, clientMode: null }
}
export function clientDocumentHref(href: string): boolean {
  return href.startsWith('/api/clinical-workspace/') && !href.startsWith('//') && !/[?\u0000-\u0020#\\]/.test(href)
}
