'use client'

import { useState } from 'react'
import type { ClinicalAuditEvent, WorkspaceView } from '@/lib/clinical-core/types'
import { clinicalAuditEntries, clinicalAuditLabel, clinicalAuditResourceLabel } from '@/lib/clinical-workspace/presentation'
import { clinicalCard, clinicalInput, clinicalLabel } from './styles'

export function ClinicalTimeline({ events, workspace }: { events: ClinicalAuditEvent[]; workspace: WorkspaceView }) {
  const [resourceType, setResourceType] = useState<ClinicalAuditEvent['resourceType'] | ''>(''), [search, setSearch] = useState('')
  const entries = clinicalAuditEntries(events, workspace, resourceType, search)
  return <section className={clinicalCard}><h2 className="text-lg font-semibold">Chronologie des activités autorisées</h2><p className="mt-1 text-sm text-[#8a6f5d]">Les consultations et les modifications sont tracées sans recopier le texte clinique.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className={clinicalLabel}>Rechercher une activité ou un client autorisé<input className={clinicalInput} type="search" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} /></label><label className={clinicalLabel}>Type de ressource<select className={clinicalInput} value={resourceType} onChange={event => setResourceType(event.target.value as typeof resourceType)}><option value="">Tous</option><option value="client">Clients</option><option value="record">Dossiers cliniques</option><option value="note">Notes cliniques</option><option value="workspace">Espace de travail</option></select></label></div>
    <p role="status" className="mt-4 text-xs text-[#8a6f5d]">{entries.length} événement(s) accessible(s) pour ces filtres{entries.length > 100 ? ' · les 100 plus récents sont affichés' : ''}.</p>
    <ol className="mt-5 grid gap-3">{entries.slice(0, 100).map(event => <li key={event.id} className="relative border-l-2 border-[#d8b992] py-1 pl-4"><p className="text-sm font-semibold">{clinicalAuditLabel(event.action)}</p><p className="mt-1 text-sm text-[#6f5a49]">{clinicalAuditResourceLabel(event, workspace)}</p><p className="mt-1 text-xs text-[#8a6f5d]">{workspace.actors.find(actor => actor.id === event.actorId)?.displayName ?? 'Intervenant'} · {new Date(event.occurredAt).toLocaleString('fr-CA', { timeZone: 'America/Toronto' })}{event.version ? ' · version ' + event.version : ''}</p></li>)}</ol>
    {!entries.length && <p className="mt-5 text-sm text-[#8a6f5d]">Aucune activité accessible pour ces filtres.</p>}
  </section>
}
