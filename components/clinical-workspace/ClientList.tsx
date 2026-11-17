'use client'

import { useMemo, useRef, useState } from 'react'
import { canAdmin } from '@/lib/clinical-core/capabilities'
import { Plus, Search } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import type { ClientAdminProjection, WorkspaceView } from '@/lib/clinical-core/types'
import type { ClientOverview } from '@/lib/clinical-workspace/clientDetails'
import { EntityForm } from './EntityForm'
import { ClientLifecycleSection } from './ClientFileNotes'
import { clinicalCard, clinicalInput } from './styles'
import { useClinicalNavigation } from './NavigationGuard'
import { clientDirectoryRows, clientIsArchived, clientResponsibleNames, clientServiceLabel, type ClientDirectoryStatus } from './clientFileModel'

export function ClientList({ workspace, selectedId, onSelect, onCreated, search, page, onSearchChange, onPageChange, status = 'active', onStatusChange, onUpdated }: {
  workspace: WorkspaceView; selectedId: string | null; onSelect: (id: string) => void; onCreated: (client: ClientAdminProjection) => Promise<void>; search: string; page: number; onSearchChange: (value: string) => void; onPageChange: (value: number) => void;
  status?: ClientDirectoryStatus; onStatusChange?: (value: ClientDirectoryStatus) => void; onUpdated?: () => Promise<void>
}) {
  const navigation = useClinicalNavigation(), [creating, setCreating] = useState(false)
  const [lifecycleClientId, setLifecycleClientId] = useState<string | null>(null)
  const [lifecycle, setLifecycle] = useState<ClientOverview | null>(null)
  const [lifecycleError, setLifecycleError] = useState('')
  const lifecycleRequest = useRef(0)
  const [reasonView, setReasonView] = useState<{ clientId: string; reason: string | null; error: string }>({ clientId: '', reason: null, error: '' })
  const reasonRequest = useRef(0)
  const openReason = async (client: ClientAdminProjection) => {
    const request = ++reasonRequest.current
    if (reasonView.clientId === client.id) { setReasonView({ clientId: '', reason: null, error: '' }); return }
    setReasonView({ clientId: client.id, reason: null, error: '' })
    if (!workspace.durable) {
      setReasonView({ clientId: client.id, reason: client.requests.at(-1)?.administrativeReason ?? '', error: '' })
      return
    }
    try {
      const result = await clinicalRequest<{ overview: ClientOverview }>({ actorId: workspace.actor.id, context: workspace.context }, `/clients/${client.id}/overview`, undefined, 'GET')
      if (result.overview.clientId !== client.id) throw new Error('Le motif de ce dossier est indisponible.')
      if (request === reasonRequest.current) setReasonView({ clientId: client.id, reason: result.overview.profile.consultationReason, error: '' })
    } catch (cause) {
      if (request === reasonRequest.current) setReasonView({ clientId: client.id, reason: null, error: cause instanceof Error ? cause.message : 'Le motif de ce dossier est indisponible.' })
    }
  }
  const openLifecycle = async (id: string) => {
    const request = ++lifecycleRequest.current
    if (lifecycleClientId === id) { setLifecycleClientId(null); setLifecycle(null); return }
    setLifecycleClientId(id); setLifecycle(null); setLifecycleError('')
    try {
      const result = await clinicalRequest<{ overview: ClientOverview }>({ actorId: workspace.actor.id, context: workspace.context }, `/clients/${id}/overview`, undefined, 'GET')
      if (result.overview.clientId !== id) throw new Error('Le suivi de ce dossier est indisponible.')
      if (request === lifecycleRequest.current) setLifecycle(result.overview)
    } catch (cause) { if (request === lifecycleRequest.current) setLifecycleError(cause instanceof Error ? cause.message : 'Le suivi de ce dossier est indisponible.') }
  }
  const clients = useMemo(() => clientDirectoryRows(workspace, search, status), [workspace, search, status])
  const pages = Math.max(1, Math.ceil(clients.length / 15)), current = Math.min(Math.max(0, page), pages - 1), administrative = canAdmin(workspace.actor)
  return <section className={clinicalCard} aria-label="Répertoire des clients">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Répertoire des clients</h2><p className="mt-1 text-sm text-[#8a6f5d]">Ouvrez une fiche pour retrouver ses activités et ses documents.</p></div>{administrative && <button type="button" className={buttonClass('secondary')} onClick={async () => { if (!creating || await navigation.canLeave()) setCreating(value => !value) }} aria-expanded={creating}><Plus size={17} />Nouveau client</button>}</div>
    {creating && <div className="mb-5 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-4"><h3 className="mb-2 font-medium">Nouvelle identité fictive</h3><p className="mb-3 text-xs text-[#7a6859]">Les homonymes restent des personnes distinctes.</p><EntityForm submitLabel="Créer le client" fields={[{ name: 'firstName', label: 'Prénom', required: true }, { name: 'lastName', label: 'Nom', required: true }, { name: 'birthDate', label: 'Date de naissance', type: 'date' }, { name: 'sex', label: 'Sexe', type: 'select', options: [{ value: 'Femme', label: 'Femme' }, { value: 'Homme', label: 'Homme' }, { value: 'Autre', label: 'Autre' }], includeEmpty: true }]} onSubmit={async values => { const payload = await clinicalRequest<{ client: ClientAdminProjection }>({ actorId: workspace.actor.id, context: workspace.context }, '/clients', values, 'POST'); await onCreated(payload.client); setCreating(false) }} /></div>}
    <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]"><label className="relative block"><span className="sr-only">Rechercher un client</span><Search className="absolute left-3 top-3 h-4 w-4 text-[#8a6f5d]" /><input value={search} maxLength={120} onChange={event => onSearchChange(event.target.value)} type="search" placeholder="Rechercher un nom…" className={clinicalInput + ' !pl-9'} /></label><label><span className="sr-only">Statut des dossiers</span><select aria-label="Statut des dossiers" className={clinicalInput} value={status} onChange={event => onStatusChange?.(event.target.value as ClientDirectoryStatus)}><option value="active">Dossiers actifs</option><option value="archived">Dossiers archivés</option><option value="all">Tous les dossiers</option></select></label></div>
    <p role="status" className="mb-3 text-xs text-[#8a6f5d]">{clients.length} client(s) · {current + 1} / {pages}</p><div className="grid gap-2">{clients.slice(current * 15, (current + 1) * 15).map(client => <div key={client.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[#eadfd2] bg-white p-1"><button type="button" onClick={() => onSelect(client.id)} aria-pressed={selectedId === client.id} className="grid min-w-0 flex-1 gap-2 rounded-lg p-3 text-left hover:bg-[#f7f1e9] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><span className="min-w-0"><strong className="block break-words">{client.firstName} {client.lastName}</strong>{client.caseNumber && <span className="mt-1 block text-xs font-semibold text-[#795b80]">Dossier nº {client.caseNumber}</span>}{client.birthDate && <span className="mt-1 block text-xs text-[#8a6f5d]">Naissance : {client.birthDate}</span>}</span><span className="min-w-0 text-sm"><span className="block break-words">{clientServiceLabel(client)}</span><span className="mt-1 block break-words text-xs text-[#8a6f5d]">{clientResponsibleNames(workspace, client).join(' · ') || 'Responsable à préciser'}</span></span><span className={"self-start whitespace-nowrap rounded-full px-2 py-1 text-xs " + (clientIsArchived(workspace, client) ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-900")}>{clientIsArchived(workspace, client) ? 'Dossier archivé' : 'Suivi actif'}</span></button><button type="button" className={buttonClass('ghost') + ' !px-2 text-xs'} aria-expanded={reasonView.clientId === client.id} aria-label={(reasonView.clientId === client.id ? 'Masquer' : 'Afficher') + ' le motif de consultation de ' + client.firstName + ' ' + client.lastName} onClick={() => void openReason(client)}>{reasonView.clientId === client.id ? 'Masquer le motif' : 'Voir le motif'}</button>{workspace.durable && client.episodes.length > 0 && <button type="button" className={buttonClass('ghost') + ' !px-2 text-xs'} aria-expanded={lifecycleClientId === client.id} onClick={() => void openLifecycle(client.id)}>Statut / fermer</button>}{reasonView.clientId === client.id && <div className="w-full rounded-lg bg-[#fbf6ef] px-3 py-2 text-sm"><strong>Motif de consultation</strong>{reasonView.error ? <p role="alert" className="mt-1 text-red-800">{reasonView.error}</p> : reasonView.reason === null ? <p role="status" className="mt-1">Chargement du motif…</p> : <p className="mt-1 whitespace-pre-wrap break-words">{reasonView.reason || 'Aucun motif précisé.'}</p>}</div>}{lifecycleClientId === client.id && <div className="w-full px-2 pb-2">{lifecycleError && <p role="alert" className="text-sm text-red-800">{lifecycleError}</p>}{lifecycle ? <ClientLifecycleSection overview={lifecycle} workspace={workspace} embedded onCommitted={async () => { setLifecycle(null); setLifecycleClientId(null); await onUpdated?.() }} onAccessDenied={cause => { setLifecycle(null); setLifecycleError(cause instanceof Error ? cause.message : 'Accès retiré.') }} /> : !lifecycleError && <p role="status" className="p-2 text-sm">Chargement du suivi…</p>}</div>}</div>)}</div>
    {!clients.length && <p className="py-5 text-sm text-[#8a6f5d]">Aucun dossier accessible pour ces filtres.</p>}{pages > 1 && <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm"><button type="button" onClick={() => onPageChange(current - 1)} disabled={current === 0} className={buttonClass('ghost')}>Précédent</button><span>{current + 1} / {pages}</span><button type="button" onClick={() => onPageChange(current + 1)} disabled={current === pages - 1} className={buttonClass('ghost')}>Suivant</button></div>}
  </section>
}
