import { isProfessionalSlug } from './professionalLinks.ts'
import type { ClinicalAccessContext } from '@/lib/clinical-core/types'
export type AdmissionSection = 'calls' | 'waiting' | 'processes' | 'tasks' | 'requests' | 'preferences' | 'assignments' | 'admission-history'
export type WorkspaceSection = 'home' | 'clients' | 'note-page' | 'calendar' | 'offices' | 'professionals' | 'my-profile' | 'migration' | 'clinic-settings' | 'billing' | 'timeline' | 'mandates' | AdmissionSection
const routes: Record<WorkspaceSection, string> = { home: '', clients: 'clients', 'note-page': 'note', calendar: 'agenda', offices: 'bureaux', professionals: 'professionnels', 'my-profile': 'mon-profil', migration: 'migration-donnees', 'clinic-settings': 'parametres-clinique', billing: 'facturation', timeline: 'journal', mandates: 'mandats', calls: 'appels', waiting: 'attente', processes: 'demarches', tasks: 'taches', requests: 'demandes', preferences: 'preferences', assignments: 'assignations', 'admission-history': 'historique' }
const sections = new Map(Object.entries(routes).map(([key, value]) => [value, key as WorkspaceSection]))
export function isAdmissionSection(section: WorkspaceSection | null): section is AdmissionSection {
  return section !== null && ['calls', 'waiting', 'processes', 'tasks', 'requests', 'preferences', 'assignments', 'admission-history'].includes(section)
}
export function workspaceRoute(pathname: string, query: URLSearchParams) {
  const context: ClinicalAccessContext = pathname.startsWith('/administration') ? 'administration' : 'clinical'
  const segments = pathname.split('/').filter(Boolean).slice(1)
  const section = sections.get(segments[0] ?? '')
  return { context, section: section ?? null, clientId: segments[0] === 'clients' && segments[1] ? segments[1] : query.get('client'), recordId: query.get('record'), professionalFileId: segments[0] === 'professionnels' && segments[1] ? segments[1] : null,
    admissionId: query.get('admission'), prospectId: query.get('prospect'), processId: query.get('process'), assignmentId: query.get('assignment'), professionalId: query.get('pro'), tab: query.get('tab'), selectedDay: query.get('day'),
    actorId: query.get('actor'), search: (query.get('recherche') ?? '').slice(0, 120), page: Math.max(0, Math.min(100000, Number.parseInt(query.get('page') ?? '1', 10) - 1 || 0)) }
}
export function workspaceHref(context: ClinicalAccessContext, section: WorkspaceSection, query: Record<string, string | null | undefined> = {}) {
  const values = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value && !(section === 'clients' && key === 'client' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) && !(section === 'professionals' && key === 'professional' && (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) || isProfessionalSlug(value)))) values.set(key, value)
  const clientPath = section === 'clients' && query.client && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(query.client) ? '/' + encodeURIComponent(query.client) : ''
  const professionalPath = section === 'professionals' && query.professional && (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(query.professional) || isProfessionalSlug(query.professional)) ? '/' + encodeURIComponent(query.professional) : ''
  const suffix = routes[section] + clientPath + professionalPath
  const base = context === 'administration' ? '/administration' : '/clinique'
  return base + (suffix ? '/' + suffix : '') + (values.size ? '?' + values : '')
}
/** Preserve old entry points while keeping one visible destination for each workflow. */
export function canonicalWorkspaceDestination(context: ClinicalAccessContext, section: WorkspaceSection, query: Record<string, string | null | undefined> = {}) {
  if (context === 'administration' && (section === 'requests' || section === 'preferences')) {
    const { pro, ...rest } = query
    return { section: 'professionals' as WorkspaceSection, query: { ...rest, professional: pro ?? null, tab: section } }
  }
  if (section === 'admission-history') return context === 'clinical'
    ? { section: 'assignments' as WorkspaceSection, query: { ...query, tab: 'history' } }
    : { section: 'clients' as WorkspaceSection, query: { ...query, view: 'assignments', tab: 'history' } }
  if (section === 'assignments') return context === 'clinical'
    ? { section, query }
    : { section: 'clients' as WorkspaceSection, query: { ...query, view: 'assignments' } }
  return { section, query }
}
export function safeWorkspaceReturn(value: string | null) {
  if (!value || value.length > 1000 || /[\\\r\n]/.test(value) || !/^\/(?:administration|clinique)(?:[/?]|$)/.test(value)) return null
  try { const url = new URL(value, 'http://127.0.0.1:3100'); return url.origin === 'http://127.0.0.1:3100' ? url.pathname + url.search : null } catch { return null }
}

/** One form owns its guard state; confirming it never dismisses another draft. */
export function createClinicalFormState(dirty = false, pending = false) {
  let current = { dirty, pending }
  return {
    sync(nextDirty: boolean, nextPending: boolean) { current = { dirty: nextDirty, pending: nextPending } },
    markPending() { current = { ...current, pending: true } },
    markSettled() { current = { ...current, pending: false } },
    markSaved() { current = { dirty: false, pending: false } },
    canLeave(confirmDiscard: () => boolean) { return !current.pending && (!current.dirty || confirmDiscard()) },
    hasUnsaved() { return current.dirty || current.pending },
  }
}

export type WorkspaceNavigationGroup = { id: string; label: string; sections: WorkspaceSection[] }
/** Group every available destination once; an added destination is never hidden. */
export function workspaceNavigationGroups(context: ClinicalAccessContext, available: readonly WorkspaceSection[]): WorkspaceNavigationGroup[] {
  const groups: WorkspaceNavigationGroup[] = [
    { id: 'assignment', label: context === 'administration' ? 'Assignations' : 'Mes assignations',
      sections: context === 'administration' ? ['home', 'waiting', 'clients', 'calls', 'processes', 'tasks', 'professionals', 'requests', 'preferences', 'assignments', 'admission-history'] : ['assignments', 'requests', 'admission-history', 'preferences'] },
    { id: 'workspace', label: context === 'administration' ? 'Clinique et calendrier' : 'Mon espace clinique',
      sections: context === 'clinical' ? ['my-profile', 'clients', 'calendar', 'offices', 'mandates', 'billing', 'timeline', 'home'] : ['clients', 'calendar', 'offices', 'mandates', 'billing', 'timeline', 'migration', 'clinic-settings'] },
  ]
  const remaining = new Set(available)
  const visible = groups.map(group => ({ ...group, sections: group.sections.filter(section => remaining.delete(section)) })).filter(group => group.sections.length)
  if (remaining.size) visible.push({ id: 'other', label: 'Autres fonctions', sections: [...remaining] })
  return visible
}

/** Refresh is a departure from an editable snapshot, so it uses the same guards. */
export async function refreshWorkspaceWhenSafe(canLeave: () => Promise<boolean>, refresh: () => Promise<void>): Promise<boolean> {
  if (!await canLeave()) return false
  await refresh()
  return true
}

