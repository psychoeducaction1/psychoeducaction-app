'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, UserCheck } from 'lucide-react'
import { AppNav } from '@/components/AppNav'
import { Badge, buttonClass, EmptyState, PageHeader, SectionCard } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'

type ProspectStatus =
  | 'new'
  | 'scheduled'
  | 'callback_requested'
  | 'contacted'
  | 'service_taken'
  | 'service_not_taken'
  | 'other'
  | 'transferred_to_waiting_list'

type Prospect = {
  id: string
  status: ProspectStatus
  first_name: string
  last_name: string
  birth_date: string | null
  phone: string
  email: string
  request_type: string
  requester_names: string[]
  modalities: string[]
  service_address: string | null
  service_city: string | null
  service_postal_code: string | null
  consultation_reason: string | null
  contact_request_type: string
  rapid_callback_requested_at: string | null
  source: string
  potential_duplicate: boolean
  outcome_reason: string | null
  waiting_list_client_id: string | null
  created_at: string
}

const statusLabels: Record<ProspectStatus, string> = {
  new: 'À contacter',
  scheduled: 'À contacter',
  callback_requested: 'À contacter',
  contacted: 'Contacté',
  service_taken: 'Service pris',
  service_not_taken: 'Service non pris',
  other: 'Autre',
  transferred_to_waiting_list: 'Transféré en liste d’attente',
}
const editableStatuses: Array<{ value: ProspectStatus; label: string }> = [
  { value: 'contacted', label: 'Contacté' },
  { value: 'service_taken', label: 'Service pris' },
  { value: 'service_not_taken', label: 'Service non pris' },
  { value: 'other', label: 'Autre' },
]
const historyStatuses = new Set<ProspectStatus>([
  'service_taken',
  'service_not_taken',
  'transferred_to_waiting_list',
])
const pendingStatuses = new Set<ProspectStatus>(['new', 'scheduled', 'callback_requested'])
const inputClass = 'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'
const dateTime = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' })

function editableStatusFor(status: ProspectStatus): ProspectStatus {
  if (status === 'transferred_to_waiting_list') return 'service_taken'
  return pendingStatuses.has(status) ? 'contacted' : status
}

export default function ProspectsPage() {
  const router = useRouter()
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'active' | 'history'>('active')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftStatus, setDraftStatus] = useState<ProspectStatus>('contacted')
  const [outcomeReason, setOutcomeReason] = useState('')
  const [priority, setPriority] = useState('normal')

  const authenticatedFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Session expirée.')
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  }, [])

  const loadProspects = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const response = await authenticatedFetch('/api/direction/prospects')
    const payload = await response.json()
    if (!response.ok) setError(payload.error ?? 'Chargement impossible.')
    else {
      const rows = (payload.prospects ?? []) as Prospect[]
      setProspects(rows)
      const queryId = new URLSearchParams(window.location.search).get('prospect')
      const queryProspect = rows.find((item) => item.id === queryId)
      if (queryProspect) {
        setSelectedId(queryProspect.id)
        setDraftStatus(editableStatusFor(queryProspect.status))
        setOutcomeReason(queryProspect.outcome_reason ?? '')
        setViewMode(historyStatuses.has(queryProspect.status) ? 'history' : 'active')
      }
    }
    setLoading(false)
  }, [authenticatedFetch, router])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProspects() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadProspects])

  const selected = prospects.find((prospect) => prospect.id === selectedId) ?? null

  const selectProspect = (prospect: Prospect) => {
    setSelectedId(prospect.id)
    setDraftStatus(editableStatusFor(prospect.status))
    setOutcomeReason(prospect.outcome_reason ?? '')
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return prospects.filter((prospect) => {
      const matchesSearch = !query || [prospect.first_name, prospect.last_name, prospect.email, prospect.phone]
        .join(' ')
        .toLowerCase()
        .includes(query)
      const isHistorical = historyStatuses.has(prospect.status)
      const matchesView = viewMode === 'history' ? isHistorical : !isHistorical
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'pending' && pendingStatuses.has(prospect.status))
        || prospect.status === statusFilter
      return matchesSearch && matchesView && matchesStatus
    })
  }, [prospects, search, statusFilter, viewMode])

  const saveStatus = async () => {
    if (!selected) return
    setSaving(true); setError(''); setMessage('')
    const response = await authenticatedFetch(`/api/direction/prospects/${selected.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: draftStatus, outcomeReason }),
    })
    const payload = await response.json()
    if (!response.ok) setError(payload.error ?? 'Mise à jour impossible.')
    else {
      setMessage('Le statut du prospect a été mis à jour.')
      if (historyStatuses.has(draftStatus)) setViewMode('history')
      await loadProspects()
    }
    setSaving(false)
  }

  const transferToWaitingList = async () => {
    if (!selected || !window.confirm('Envoyer ce prospect vers la liste d’attente?')) return
    setSaving(true); setError(''); setMessage('')
    const response = await authenticatedFetch(`/api/direction/prospects/${selected.id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ priorityLevel: priority }),
    })
    const payload = await response.json()
    if (!response.ok) setError(payload.error ?? 'Transfert impossible.')
    else { setMessage('Le client a été ajouté à la liste d’attente.'); await loadProspects() }
    setSaving(false)
  }

  return <>
    <AppNav />
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader eyebrow="Direction" title="Prospects" description="Demandes reçues du site web à qualifier avant une éventuelle entrée dans la liste d’attente." />
        {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {message && <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</div>}

        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Classement des prospects">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'active'}
            className={viewMode === 'active' ? buttonClass('primary') : buttonClass('secondary')}
            onClick={() => {
              setViewMode('active')
              setStatusFilter('all')
              setSelectedId(null)
            }}
          >
            Prospects à traiter
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'history'}
            className={viewMode === 'history' ? buttonClass('primary') : buttonClass('secondary')}
            onClick={() => {
              setViewMode('history')
              setStatusFilter('all')
              setSelectedId(null)
            }}
          >
            Historique
          </button>
        </div>

        <SectionCard title="Recherche et filtres" icon={Search}>
          <div className="grid gap-4 md:grid-cols-[1fr_280px]">
            <label className="text-sm font-semibold text-[#5d4a3d]">Recherche<input className={`${inputClass} mt-2`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom, téléphone ou courriel" /></label>
            <label className="text-sm font-semibold text-[#5d4a3d]">Statut<select className={`${inputClass} mt-2`} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Tous les statuts</option>{viewMode === 'active' ? <><option value="pending">À contacter</option><option value="contacted">Contacté</option><option value="other">Autre</option></> : <><option value="service_taken">Service pris</option><option value="service_not_taken">Service non pris</option><option value="transferred_to_waiting_list">Transféré en liste d’attente</option></>}</select></label>
          </div>
        </SectionCard>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.85fr)]">
          <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5">
            <h2 className="text-lg font-semibold text-[#332820]">{viewMode === 'history' ? 'Historique des prospects' : 'Prospects à traiter'} ({filtered.length})</h2>
            {loading ? <p className="py-10 text-center text-sm text-[#8a6f5d]">Chargement...</p> : filtered.length === 0 ? <div className="mt-5"><EmptyState title="Aucun prospect ne correspond aux filtres" /></div> : <div className="mt-4 space-y-3">{filtered.map((prospect) => <button key={prospect.id} type="button" onClick={() => selectProspect(prospect)} className={`w-full rounded-xl border p-4 text-left transition ${selectedId === prospect.id ? 'border-[#b67a47] bg-[#fff5e9]' : 'border-[#eadfd2] bg-white hover:border-[#d8b992]'}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-[#332820]">{prospect.first_name} {prospect.last_name}</p><p className="mt-1 text-sm text-[#7a6859]">{prospect.phone} · {prospect.email}</p></div><Badge tone={prospect.status === 'service_taken' || prospect.status === 'transferred_to_waiting_list' ? 'success' : prospect.status === 'service_not_taken' ? 'danger' : prospect.status === 'other' ? 'muted' : 'warning'}>{statusLabels[prospect.status]}</Badge></div><div className="mt-2 flex flex-wrap gap-3 text-xs text-[#8a6f5d]"><span>{prospect.contact_request_type === 'rapid_callback' ? 'Demande de rappel' : 'Rendez-vous téléphonique demandé'}</span><span>{dateTime.format(new Date(prospect.created_at))}</span>{prospect.potential_duplicate && <span className="font-semibold text-[#a34d2f]">Doublon potentiel</span>}</div>{prospect.outcome_reason && <p className="mt-3 border-l-2 border-[#d8b992] pl-3 text-sm text-[#6c5a4d]">{prospect.outcome_reason}</p>}</button>)}</div>}
          </section>

          <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 xl:sticky xl:top-6 xl:self-start">
            {!selected ? <EmptyState title="Sélectionnez un prospect" description="La fiche complète et les actions apparaîtront ici." /> : <>
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-[#332820]">{selected.first_name} {selected.last_name}</h2><p className="mt-1 text-sm text-[#7a6859]">{selected.source}</p></div>{selected.potential_duplicate && <Badge tone="danger">Doublon potentiel</Badge>}</div>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="font-semibold text-[#8a6f5d]">Coordonnées</dt><dd className="mt-1 text-[#332820]">{selected.email}<br />{selected.phone}</dd></div><div><dt className="font-semibold text-[#8a6f5d]">Date de naissance</dt><dd className="mt-1 text-[#332820]">{selected.birth_date || '-'}</dd></div><div><dt className="font-semibold text-[#8a6f5d]">Modalités</dt><dd className="mt-1 text-[#332820]">{selected.modalities.join(', ') || '-'}</dd></div><div><dt className="font-semibold text-[#8a6f5d]">Requérant</dt><dd className="mt-1 text-[#332820]">{selected.requester_names.join(' / ') || 'Pour soi-même'}</dd></div><div className="sm:col-span-2"><dt className="font-semibold text-[#8a6f5d]">Adresse</dt><dd className="mt-1 text-[#332820]">{[selected.service_address, selected.service_city, selected.service_postal_code].filter(Boolean).join(', ') || '-'}</dd></div><div className="sm:col-span-2"><dt className="font-semibold text-[#8a6f5d]">Motif de consultation</dt><dd className="mt-1 whitespace-pre-wrap text-[#332820]">{selected.consultation_reason || '-'}</dd></div></dl>

              {selected.outcome_reason && <div className="mt-5 rounded-xl border border-[#eadfd2] bg-white p-4"><p className="text-sm font-semibold text-[#8a6f5d]">Note de suivi</p><p className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">{selected.outcome_reason}</p></div>}

              {selected.status !== 'transferred_to_waiting_list' && <div className="mt-6 border-t border-[#eadfd2] pt-5"><h3 className="font-semibold text-[#332820]">Résultat de l’appel</h3><label className="mt-4 block text-sm font-semibold text-[#5d4a3d]">Statut<select className={`${inputClass} mt-2`} value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as ProspectStatus)}>{editableStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>{(draftStatus === 'service_not_taken' || draftStatus === 'other') && <label className="mt-4 block text-sm font-semibold text-[#5d4a3d]">{draftStatus === 'other' ? 'Précisez la situation' : 'Pourquoi le service n’a-t-il pas été pris?'}<textarea className={`${inputClass} mt-2 min-h-24`} value={outcomeReason} onChange={(event) => setOutcomeReason(event.target.value)} required /></label>}<button type="button" disabled={saving || ((draftStatus === 'service_not_taken' || draftStatus === 'other') && !outcomeReason.trim())} className={`${buttonClass('primary')} mt-4`} onClick={() => void saveStatus()}>Enregistrer le résultat</button></div>}

              {selected.status === 'service_taken' && !selected.waiting_list_client_id && <div className="mt-6 rounded-xl border border-[#d8b992] bg-[#fff8ef] p-4"><h3 className="font-semibold text-[#332820]">Envoyer vers la liste d’attente</h3><p className="mt-1 text-sm text-[#7a6859]">Cette action créera la fiche client uniquement maintenant.</p><label className="mt-4 block text-sm font-semibold text-[#5d4a3d]">Priorité<select className={`${inputClass} mt-2`} value={priority} onChange={(event) => setPriority(event.target.value)}><option value="normal">Normale</option><option value="urgent">Urgente</option><option value="existing_or_transfer">Client existant / transfert</option></select></label><button type="button" disabled={saving} className={`${buttonClass('primary')} mt-4`} onClick={() => void transferToWaitingList()}><UserCheck className="h-4 w-4" />Ajouter à la liste d’attente</button></div>}
              {selected.waiting_list_client_id && <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">Ce prospect a été transféré vers la liste d’attente.</div>}
            </>}
          </section>
        </div>
      </div>
    </main>
  </>
}
