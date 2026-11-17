'use client'

import { useEffect, useRef, useState } from 'react'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import { professionalClientRows, professionalClientLabels, type ProfessionalClientStatus, type ProfessionalClientRow } from '@/lib/clinical-admission/professionalClients'
import { buttonClass, Badge } from '@/components/Ui'
import { clinicalInput } from '@/components/clinical-workspace/styles'
import { AssignmentCase } from './ProfessionalPanel'
import OperationalProfessionalPage from '@/components/OperationalProfessionalPage'
import { panelClass, type AdmissionUi } from './shared'

export function ProfessionalClientsPanel({ ui, workspace, professionalId }: { ui: AdmissionUi; workspace: WorkspaceView; professionalId: string }) {
  const [search, setSearch] = useState(''), [filter, setFilter] = useState<ProfessionalClientStatus | 'current' | 'all'>('current')
  const [selectedKey, setSelectedKey] = useState<string | null>(null), [assigning, setAssigning] = useState(false)
  const detail = useRef<HTMLElement>(null)
  const all = professionalClientRows(workspace, ui.data.assignments, professionalId)
  const matches = all.filter(row => `${row.firstName} ${row.lastName}`.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')))
  const rows = matches.filter(row => (filter === 'all' || filter === 'current') ? row.status !== 'archived' : row.status === filter)
  const archives = matches.filter(row => row.status === 'archived')
  const selected = all.find(row => selectedKey ? row.key === selectedKey : row.assignments.some(item => item.id === ui.query.get('assignment')))
  useEffect(() => { if (selectedKey) { detail.current?.focus({preventScroll:true}); detail.current?.scrollIntoView({block:'start', behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}) } }, [selectedKey])
  const list = (items: ProfessionalClientRow[]) => <div className="grid gap-2">{items.map(row => <div key={row.key} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eadfd2] p-4">
    <button type="button" className="text-left font-semibold underline decoration-[#c5a987] underline-offset-4 hover:text-[#8a5633]" onClick={() => row.clientId ? void ui.openClient(row.clientId) : setSelectedKey(row.key)}>{row.firstName} {row.lastName}</button>
    <div className="flex flex-wrap items-center gap-3"><Badge tone={row.status === 'taken' ? 'success' : row.status === 'archived' ? 'neutral' : 'warning'}>{professionalClientLabels[row.status]}</Badge>{row.assignments.length > 0 && <button type="button" aria-expanded={selected?.key === row.key} className={buttonClass('secondary')} onClick={() => setSelectedKey(row.key)}>Détails de la prise en charge</button>}</div>
  </div>)}{!items.length && <p className="py-3 text-sm">Aucun client pour ces filtres.</p>}</div>
  return <div className="grid gap-4">
    <section className={panelClass}>
      <div className="mb-4 flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold">Clients</h2>{workspace.context === 'administration' && <button type="button" className={buttonClass('primary')} onClick={() => setAssigning(value => !value)} aria-expanded={assigning}>Assigner un client de la liste d’attente</button>}</div>
      {assigning && <OperationalProfessionalPage professionalIdOverride={professionalId} assignmentOnly onAssigned={ui.refresh} />}
      <div className="mb-4 grid gap-3 sm:grid-cols-2"><label>Rechercher un client<input type="search" className={clinicalInput} value={search} onChange={event => setSearch(event.target.value)} /></label><label>Statut du suivi<select className={clinicalInput} value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="current">Tous les clients en cours</option>{Object.entries(professionalClientLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="all">Tous, y compris les archives</option></select></label></div>
      {list(rows)}
      {(filter === 'current' || filter === 'all') && <details className="mt-5" open={filter === 'all' ? true : undefined}><summary className="cursor-pointer font-medium">Clients archivés ({archives.length})</summary><div className="mt-3">{list(archives)}</div></details>}
    </section>
    {selected && <section ref={detail} tabIndex={-1} className={panelClass + " scroll-mt-24"} aria-label="Client sélectionné"><div className="mb-4 flex flex-wrap justify-between gap-3"><h3 className="text-lg font-semibold">{selected.firstName} {selected.lastName}</h3><button type="button" className={buttonClass('secondary')} onClick={() => { setSelectedKey(null); void ui.select({ assignment: null }) }}>Fermer</button></div>{selected.clientId && <button type="button" className={buttonClass('primary') + ' mb-4'} onClick={() => void ui.openClient(selected.clientId!)}>Ouvrir la fiche client</button>}{selected.assignments.map(item => <details key={item.id} open={selected.assignments.length === 1 || undefined} className="mt-3"><summary className="cursor-pointer">Prise en charge · {new Date(item.assignedAt).toLocaleDateString('fr-CA')} {item.refusalReason ? '· ' + item.refusalReason : ''}</summary><div className="mt-3"><AssignmentCase ui={ui} assignment={item} clientAccessible={Boolean(selected.clientId)} /></div></details>)}</section>}
  </div>
}
