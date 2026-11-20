'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ClipboardList, UserCheck, Users } from 'lucide-react'
import { AssignmentRequestComment } from '@/components/AssignmentRequestComment'
import { Badge, buttonClass, EmptyState, SectionCard, StatCard } from '@/components/ui/index'
import { fetchAdmission } from '@/lib/clinical-admission/client'
import { buildAdministrationDashboard } from '@/lib/clinical-admission/dashboard'
import type { AdmissionWorkspace } from '@/lib/clinical-admission/types'
import type { WorkspaceSection } from '@/lib/clinical-workspace/navigation'

type Props = { actorId: string; onNavigate: (section: WorkspaceSection, query?: Record<string, string | null>) => void }

export function AdministrationDashboard({ actorId, onNavigate }: Props) {
  const [data, setData] = useState<AdmissionWorkspace | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void fetchAdmission({ actorId, context: 'administration' }, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setData(value); setError('') } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Impossible de charger les données d’assignation.') })
    return () => controller.abort()
  }, [actorId])
  const stats = useMemo(() => data ? buildAdministrationDashboard(data) : null, [data])

  if (error) return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</p>
  if (!stats) return <p role="status">Chargement des capacités et de la liste d’attente…</p>

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-[#7a6859]">Vue rapide des capacités, demandes et situations à surveiller.</p>
      <button type="button" className={buttonClass('primary')} onClick={() => onNavigate('professionals')}>Voir les professionnels</button>
    </div>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6" aria-label="Indicateurs des assignations">
      <StatCard label="Clients en liste d’attente" value={stats.waiting} helper="Clients non encore assignés" tone="warm" priority={stats.waiting > 0 ? 'high' : 'default'} icon={Users} />
      <StatCard label="Places à combler" value={stats.remaining} helper="Places non assignées" tone="warm" priority={stats.remaining > 0 ? 'high' : 'default'} icon={ClipboardList} />
      <StatCard label="Clients assignés en attente" value={stats.pending} helper="En attente de réponse du client" tone="warm" priority={stats.pending > 0 ? 'high' : 'default'} icon={ClipboardList} />
      <StatCard label="Services pris" value={stats.taken} helper="Services confirmés" tone="success" priority="subtle" icon={UserCheck} />
      <StatCard label="Services non pris" value={stats.refused} helper="Services refusés" tone="neutral" priority="subtle" icon={AlertCircle} />
      <StatCard label="Alertes / urgences" value={stats.urgent} helper="Urgents ou transferts" tone="warm" priority={stats.urgent > 0 ? 'high' : 'default'} icon={AlertCircle} />
    </section>
    <div className="grid gap-6 xl:grid-cols-2">
      <SectionCard title="Professionnels disponibles pour assignation" priority="high" icon={ClipboardList}>
        {stats.available.length === 0 ? <EmptyState title="Aucune assignation à faire actuellement." /> : <div className="space-y-3">{stats.available.map(row =>
          <div key={row.id} className="flex flex-col gap-3 rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className="font-medium text-[#6d3f1f] underline decoration-[#d9b591] underline-offset-2 hover:decoration-[#9b6a3d]" onClick={() => onNavigate('professionals', { professional: row.id })}>{row.name}</button>
            <Badge tone="warning">{row.remainingCount} à assigner</Badge>
          </div>
        )}</div>}
      </SectionCard>
      <SectionCard title="Demandes nécessitant attention" priority={stats.attention.length > 0 ? 'high' : 'default'} icon={AlertCircle}>
        {stats.attention.length === 0 ? <EmptyState title="Aucune situation prioritaire détectée." /> : <div className="space-y-3">{stats.attention.map(row =>
          <div key={row.id} className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" className="font-medium text-[#6d3f1f] underline decoration-[#d9b591] underline-offset-2 hover:decoration-[#9b6a3d]" onClick={() => onNavigate('professionals', { professional: row.id })}>{row.name}</button>
              <div className="flex flex-wrap gap-2">
                {row.noResponseClients >= 3 && <Badge tone="danger">{row.noResponseClients} service non pris</Badge>}
                {row.pendingClients > 0 && <Badge tone="warning">{row.pendingClients} à confirmer</Badge>}
              </div>
            </div>
            <AssignmentRequestComment comment={row.requestComment} />
          </div>
        )}</div>}
      </SectionCard>
    </div>
  </div>
}
