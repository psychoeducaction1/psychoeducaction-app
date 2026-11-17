import { isProfessionalSlug } from '../clinical-workspace/professionalLinks.ts'
/** Clinical rendering comes from the laboratory; operational flows retain their established routes. */
export function unifiedOperationalDestination(context: 'administration' | 'clinical', segments: readonly string[], query = new URLSearchParams()): string | null {
  if (segments.length > 1) return null
  const section = segments[0] ?? ''
  const administration: Record<string, string> = {
    '': '/direction', attente: '/direction/liste-attente', appels: '/direction/prospects',
    demarches: '/direction/assignations-en-cours', taches: '/direction/taches-administratives',
    journal: '/direction/journal-audit', preferences: '/preferences-professionnels',
    assignations: '/direction/assignations-en-cours', demandes: '/direction/assignations-en-cours',
  }
  const clinical: Record<string, string> = {
    assignations: '/clinique/mon-profil?tab=clients', demandes: '/clinique/mon-profil?tab=requests', historique: '/clinique/mon-profil?tab=requests',
  }
  const destination = (context === 'administration' ? administration : clinical)[section]
  if (!destination) return null
  const [path, fixedQuery] = destination.split('?')
  const merged = new URLSearchParams(query)
  // The destination tab must win over the source page's tab/filter.
  for (const [key, value] of new URLSearchParams(fixedQuery)) merged.set(key, value)
  return path + (merged.size ? `?${merged}` : '')
}

export function isOriginalClinicalPage(context: 'administration' | 'clinical', segments: readonly string[]): boolean {
  const allowed = context === 'administration'
    ? ['clients', 'mandats', 'agenda', 'bureaux', 'professionnels', 'migration-donnees', 'parametres-clinique', 'facturation']
    : ['clients', 'notes', 'note', 'mandats', 'agenda', 'bureaux', 'mon-profil', 'facturation', 'preferences']
  return segments.length <= 2 && allowed.includes(segments[0]) && (!segments[1]
    || (['clients', 'professionnels'].includes(segments[0])
      && (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segments[1]) || segments[0]==='professionnels' && isProfessionalSlug(segments[1]))))
}
