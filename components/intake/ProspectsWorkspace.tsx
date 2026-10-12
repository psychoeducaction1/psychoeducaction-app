'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Search, UserCheck } from 'lucide-react'
import { AppNav } from '@/components/AppNav'
import { Badge, buttonClass, EmptyState, PageHeader, SectionCard } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import { IntakeCalendar } from '@/components/intake/IntakeCalendar'
import { ProspectAppointments } from '@/components/intake/ProspectAppointments'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { ProspectFollowupForm } from '@/components/intake/ProspectFollowupForm'
import { addLocalDays, dateKeyInToronto, torontoLocalToUtc } from '@/lib/publicIntakeSchedule'
import { buildDailyProspectQueue, historyStatuses, prospectCallLabel, prospectsTab, splitProspectAppointments, prospectDateTime as dateTime, type IntakeAppointment, type ProspectStatus, type ProspectsTab } from '@/lib/prospectsWorkspace'

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
  is_test?: boolean
  appointments: IntakeAppointment[]
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
  { value: 'service_taken', label: 'Service pris' },
  { value: 'service_not_taken', label: 'Service non pris' },
  { value: 'other', label: 'Autre' },
]
const inputClass = 'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

function editableStatusFor(status: ProspectStatus): ProspectStatus | '' {
  if (status === 'transferred_to_waiting_list') return 'service_taken'
  return status === 'service_taken' || status === 'service_not_taken' || status === 'other' ? status : ''
}

export function ProspectsWorkspace({ initialTab, initialProspectId, hasExplicitTab }: {
  initialTab: ProspectsTab
  initialProspectId?: string
  hasExplicitTab: boolean
}) {
  const router = useRouter()
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ProspectsTab>(initialTab)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | undefined>()
  const [draftStatus, setDraftStatus] = useState<ProspectStatus | ''>('')
  const [outcomeReason, setOutcomeReason] = useState('')
  const [consultationReason, setConsultationReason] = useState('')
  const [priority, setPriority] = useState('normal')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [showFollowup, setShowFollowup] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [dayOffset, setDayOffset] = useState<0 | 1>(0)
  const selectedDay = addLocalDays(dateKeyInToronto(now), dayOffset)

  const authenticatedFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Session expirée.')
    return fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  }, [])

  const loadProspects = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError('') }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const response = await authenticatedFetch('/api/direction/prospects')
      const payload = await response.json()
      if (!response.ok) setError(payload.error ?? 'Chargement impossible.')
      else {
        const rows = (payload.prospects ?? []) as Prospect[]
        setProspects(rows)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chargement impossible.')
    } finally { setLoading(false) }
  }, [authenticatedFetch, router])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProspects() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadProspects])

  useEffect(() => {
    if (selectedId) return
    const timer = window.setInterval(() => { void loadProspects(true) }, 60_000)
    return () => window.clearInterval(timer)
  }, [selectedId, loadProspects])

  const selected = prospects.find((prospect) => prospect.id === selectedId) ?? null
  const selectedCall = selected ? splitProspectAppointments(selected.appointments, selectedAppointmentId).primary : null
  const currentAppointmentId = selectedCall?.status === 'scheduled' ? selectedCall.id : null

  const selectProspect = (prospect: Prospect) => {
    setSelectedId(prospect.id)
    setDraftStatus(editableStatusFor(prospect.status))
    setOutcomeReason(prospect.outcome_reason ?? '')
    setConsultationReason(prospect.consultation_reason ?? '')
    setPriority('normal'); setShowFollowup(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setViewMode(initialTab)
      setSelectedId(initialProspectId ?? null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initialTab, initialProspectId])

  useEffect(() => {
    if (!selected) return
    const timer = window.setTimeout(() => {
      setDraftStatus(editableStatusFor(selected.status))
      setOutcomeReason(selected.outcome_reason ?? '')
      setConsultationReason(selected.consultation_reason ?? '')
      setPriority('normal')
      if (!hasExplicitTab && selected.id === initialProspectId) {
        setViewMode(prospectsTab(undefined, selected.status))
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selected, hasExplicitTab, initialProspectId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const closeProspect = () => {
    setSelectedId(null)
    setSelectedAppointmentId(undefined); setShowFollowup(false)
    router.replace('/direction/prospects?tab=' + viewMode, { scroll: false })
  }

  const changeTab = (tab: ProspectsTab) => {
    setViewMode(tab)
    setSelectedId(null)
    setSelectedAppointmentId(undefined)
    router.replace('/direction/prospects?tab=' + tab, { scroll: false })
  }

  const refresh = async () => {
    await loadProspects()
    setRefreshVersion((version) => version + 1)
  }

  const queue = useMemo(() => buildDailyProspectQueue(prospects, selectedDay, now), [prospects, selectedDay, now])
  const featured = viewMode === 'active' ? queue.priority : null
  const selectedRapid = selected?.contact_request_type === 'rapid_callback'
    && !historyStatuses.has(selected.status) && !selected.appointments.some((appointment) => appointment.status === 'scheduled')
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return prospects.filter((prospect) => {
      const matchesSearch = !query || [prospect.first_name, prospect.last_name, prospect.email, prospect.phone]
        .join(' ')
        .toLowerCase()
        .includes(query)
      const isHistorical = historyStatuses.has(prospect.status)
      const matchesView = viewMode === 'history' ? isHistorical : !isHistorical
      const matchesDay = viewMode !== 'active' || queue.rows.some((row) => row.prospect.id === prospect.id)
      return matchesSearch && matchesView && matchesDay && (viewMode !== 'active' || prospect.id !== featured?.prospect.id)
    })
      .sort((a, b) => viewMode === 'active' ? queue.rows.findIndex((row) => row.prospect.id === a.id) - queue.rows.findIndex((row) => row.prospect.id === b.id) : 0)
  }, [prospects, search, viewMode, queue, featured])

  const saveStatus = async () => {
    if (!selected || !draftStatus) return
    if (draftStatus === 'service_taken') {
      await transferToWaitingList()
      return
    }
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await authenticatedFetch(`/api/direction/prospects/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: draftStatus, outcomeReason, appointmentId: currentAppointmentId }),
      })
      const payload = await response.json()
      if (!response.ok) setError(payload.error ?? 'Mise à jour impossible.')
      else {
        setMessage('Le résultat de l’appel a été enregistré.')
        closeProspect()
        await refresh()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Modification impossible.')
    } finally { setSaving(false) }
  }

  const transferToWaitingList = async () => {
    if (!selected) return
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await authenticatedFetch(`/api/direction/prospects/${selected.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({
          priorityLevel: priority,
          consultationReason,
        }),
      })
      const payload = await response.json()
      if (!response.ok) setError(payload.error ?? 'Transfert impossible.')
      else {
        router.push(
          `/direction/liste-attente?client=${encodeURIComponent(payload.waitingListClientId)}`
        )
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Transfert impossible.')
    } finally { setSaving(false) }
  }

  return <>
    <AppNav />
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader eyebrow="Direction" title="Prospects et appels" description="Les appels du jour, avec les rappels rapides en priorité." />
        {!selectedId && error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {!selectedId && message && <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</div>}

        <div className="mb-6 flex flex-wrap gap-2" aria-label="Vues des prospects et appels">
          {([['calendar', 'Calendrier'], ['active', 'À traiter'], ['history', 'Historique']] as const).map(([tab, label]) => (
            <button key={tab} type="button" aria-pressed={viewMode === tab} className={buttonClass(viewMode === tab ? 'primary' : 'secondary')} onClick={() => changeTab(tab)}>{label}</button>
          ))}
        </div>

        {viewMode === 'calendar' && <IntakeCalendar authenticatedFetch={authenticatedFetch} refreshVersion={refreshVersion} onSelectProspect={(id, appointmentId) => {
          setSelectedAppointmentId(appointmentId)
          setError(''); setMessage('')
          const prospect = prospects.find((item) => item.id === id)
          if (prospect) selectProspect(prospect)
          router.replace('/direction/prospects?tab=calendar&prospect=' + encodeURIComponent(id), { scroll: false })
        }} />}

        {viewMode === 'active' && <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-[#332820]">{new Intl.DateTimeFormat('fr-CA', { dateStyle: 'full', timeZone: 'America/Toronto' }).format(torontoLocalToUtc(selectedDay, 12, 0))}</h2>
            <div className="flex gap-2">{([0, 1] as const).map((offset) => <button key={offset} type="button" aria-pressed={dayOffset === offset} onClick={() => setDayOffset(offset)} className={buttonClass(dayOffset === offset ? 'primary' : 'secondary')}>{offset === 0 ? 'Aujourd’hui' : 'Demain'}</button>)}</div>
          </div>
          {!loading && featured && <SectionCard title={featured.isRapid ? 'Rappel rapide prioritaire' : 'Prochain appel planifié'} priority="high">
            <button type="button" className="w-full text-left" onClick={() => {
              setSelectedAppointmentId(featured.appointment?.id)
              selectProspect(featured.prospect); setError(''); setMessage('')
              router.replace('/direction/prospects?tab=active&prospect=' + featured.prospect.id, { scroll: false })
            }}>
              <p className="text-lg font-semibold text-[#332820]">{featured.prospect.first_name} {featured.prospect.last_name}</p>
              <p className="mt-1 text-sm font-semibold text-[#8a5633]">{featured.isRapid ? 'Rappel dès que possible' : dateTime.format(new Date(featured.appointment!.start_at))}</p>
              <p className="mt-2 text-sm text-[#8a5633]">Ouvrir la fiche →</p>
            </button>
          </SectionCard>}
          {!loading && !featured && <p className="mb-4 text-sm text-[#7a6859]">Aucun prochain appel planifié pour cette journée.</p>}
        </>}
        {viewMode !== 'calendar' && <SectionCard title="Recherche" icon={Search}>
          <div>
            <label className="text-sm font-semibold text-[#5d4a3d]">Recherche<input className={`${inputClass} mt-2`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom, téléphone ou courriel" /></label>
          </div>
        </SectionCard>}

        <div className="mt-6">
          {viewMode !== 'calendar' && <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5">
            <h2 className="text-lg font-semibold text-[#332820]">{viewMode === 'history' ? 'Historique des prospects' : featured ? 'Autres appels à traiter' : 'Appels à traiter'} ({filtered.length})</h2>
            {loading ? <p className="py-10 text-center text-sm text-[#8a6f5d]">Chargement...</p> : filtered.length === 0 ? <div className="mt-5"><EmptyState title={viewMode === 'active' && !search.trim() ? featured ? 'Aucun autre appel à traiter pour cette journée' : 'Aucun appel à traiter pour cette journée' : 'Aucun prospect ne correspond à la recherche'} /></div> : <div className="mt-4 divide-y divide-[#eadfd2]">{filtered.map((prospect) => (
              <button key={prospect.id} type="button" onClick={() => {
                setSelectedAppointmentId(queue.rows.find((row) => row.prospect.id === prospect.id)?.appointment?.id)
                selectProspect(prospect)
                setError(''); setMessage('')
                router.replace('/direction/prospects?tab=' + viewMode + '&prospect=' + prospect.id, { scroll: false })
              }} className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-4 text-left transition hover:bg-[#fff5e9]">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-[#332820]">{prospect.first_name} {prospect.last_name}</p><Badge tone={prospect.status === 'transferred_to_waiting_list' ? 'success' : prospect.status === 'service_not_taken' ? 'danger' : 'muted'}>{queue.rows.find((row) => row.prospect.id === prospect.id)?.isRapid ? 'Rappel prioritaire' : statusLabels[prospect.status]}</Badge>{prospect.potential_duplicate && <Badge tone="danger">Doublon potentiel</Badge>}</div>
                  <p className="mt-1 text-sm font-medium text-[#5d4a3d]">{prospectCallLabel({ ...prospect, appointments: viewMode === 'active' ? [queue.rows.find((row) => row.prospect.id === prospect.id)?.appointment].filter((appointment): appointment is IntakeAppointment => Boolean(appointment)) : prospect.appointments })}</p>
                  <p className="mt-1 text-xs text-[#8a6f5d]">Demande reçue le {dateTime.format(new Date(prospect.created_at))}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-[#8a5633]"><span className="hidden sm:inline">Ouvrir la fiche</span><ChevronRight className="h-4 w-4" /></span>
              </button>
            ))}</div>}
          </section>}

          {selectedId && <ProspectDialog key={selectedId} title={selected ? selected.first_name + ' ' + selected.last_name : 'Fiche prospect'} onClose={closeProspect}>
            {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {message && <p role="status" className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}
            {!selected ? <EmptyState title={loading ? 'Chargement de la fiche…' : selectedId ? 'Prospect introuvable' : 'Sélectionnez un prospect'} description="La fiche complète et les actions apparaîtront ici." /> : <>
              <div className="flex flex-wrap items-center gap-2"><Badge tone="muted">{statusLabels[selected.status]}</Badge>{selected.potential_duplicate && <Badge tone="danger">Doublon potentiel</Badge>}{selected.is_test && <Badge tone="muted">Test</Badge>}</div>
              <div className="mt-4 space-y-1 text-sm text-[#332820]"><p>{selected.phone}</p><p className="break-all">{selected.email}</p></div>
              <p className="mt-3 text-xs text-[#8a6f5d]">Demande reçue le {dateTime.format(new Date(selected.created_at))}</p>
              {selectedRapid && <p className="mt-4 rounded-xl bg-[#fff5e9] p-3 font-semibold text-[#5d4a3d]">Rappel dès que possible · prioritaire</p>}
              {selected.appointments.length > 0 ? selectedRapid ? <details className="mt-3"><summary className="cursor-pointer text-sm text-[#7a6859]">Anciens rendez-vous</summary><ProspectAppointments appointments={selected.appointments} /></details> : <ProspectAppointments key={selected.id} appointments={selected.appointments} appointmentId={selectedAppointmentId} /> : !selectedRapid && <p className="mt-5 rounded-xl bg-[#fff5e9] p-4 font-semibold text-[#5d4a3d]">{prospectCallLabel(selected)}</p>}
              <div className="mt-5"><h3 className="text-sm font-semibold text-[#8a6f5d]">Motif de consultation</h3><p className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">{selected.consultation_reason || 'Non précisé'}</p></div>

              {selected.outcome_reason && <div className="mt-5 rounded-xl border border-[#eadfd2] bg-white p-4"><p className="text-sm font-semibold text-[#8a6f5d]">Note de suivi</p><p className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">{selected.outcome_reason}</p></div>}

              {selected.status !== 'transferred_to_waiting_list' && !selected.waiting_list_client_id && (
                <div className="mt-6 border-t border-[#eadfd2] pt-5">
                  <h3 className="font-semibold text-[#332820]">Résultat de l’appel</h3>
                  <div className="mt-3 flex flex-wrap gap-2">{editableStatuses.map((status) => <label key={status.value} className={`${buttonClass(draftStatus === status.value ? 'primary' : 'secondary')} cursor-pointer`}><input type="radio" name="call-result" checked={draftStatus === status.value} disabled={saving} value={status.value} onChange={() => { setDraftStatus(status.value); setShowFollowup(false) }} />{status.label}</label>)}</div>

                  {(draftStatus === 'service_not_taken' || draftStatus === 'other') && (
                    <label className="mt-4 block text-sm font-semibold text-[#5d4a3d]">
                      {draftStatus === 'other' ? 'Précisez la situation' : 'Pourquoi le service n’a-t-il pas été pris?'}
                      <textarea className={`${inputClass} mt-2 min-h-24`} value={outcomeReason} onChange={(event) => setOutcomeReason(event.target.value)} required />
                    </label>
                  )}

                  {draftStatus === 'service_taken' && (
                    <div className="mt-4 rounded-xl border border-[#d8b992] bg-[#fff8ef] p-4">
                      <p className="text-sm font-semibold text-[#5d4a3d]">Ajouter directement à la liste d’attente</p>
                      <p className="mt-1 text-sm text-[#7a6859]">Le prospect sera classé dans l’historique seulement après la création de sa fiche client.</p>
                      <label className="mt-4 block text-sm font-semibold text-[#5d4a3d]">
                        Motif de consultation
                        <textarea
                          className={`${inputClass} mt-2 min-h-24`}
                          value={consultationReason}
                          onChange={(event) => setConsultationReason(event.target.value)}
                          placeholder="Décrivez brièvement la demande et les besoins du client."
                          required
                        />
                      </label>
                      <label className="mt-4 block text-sm font-semibold text-[#5d4a3d]">
                        Priorité
                        <select className={`${inputClass} mt-2`} value={priority} onChange={(event) => setPriority(event.target.value)}>
                          <option value="normal">Normale</option>
                          <option value="urgent">Urgente</option>
                          <option value="existing_or_transfer">Client existant / transfert</option>
                        </select>
                      </label>
                    </div>
                  )}

                  {draftStatus === 'other' && !showFollowup && <button type="button" disabled={saving || !outcomeReason.trim()} className={`${buttonClass('secondary')} mt-4`} onClick={() => setShowFollowup(true)}>Créer un autre rendez-vous avec ce client</button>}
                  {draftStatus === 'other' && showFollowup && <ProspectFollowupForm key={selected.id} prospectId={selected.id} appointmentId={currentAppointmentId} outcomeReason={outcomeReason} authenticatedFetch={authenticatedFetch} saving={saving} onSavingChange={setSaving} onCancel={() => setShowFollowup(false)} onCreated={async () => {
                    setMessage('La précision et le nouveau rendez-vous ont été enregistrés.')
                    setSelectedAppointmentId(undefined); setShowFollowup(false)
                    await refresh()
                  }} />}
                  {!showFollowup && <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={
                      saving || !draftStatus ||
                      ((draftStatus === 'service_not_taken' || draftStatus === 'other') && !outcomeReason.trim()) ||
                      (draftStatus === 'service_taken' && !consultationReason.trim())
                    }
                    className={buttonClass('primary')}
                    onClick={() => void saveStatus()}
                  >
                    {draftStatus === 'service_taken' ? <><UserCheck className="h-4 w-4" />Ajouter à la liste d’attente</> : 'Enregistrer le résultat'}
                  </button></div>}
                </div>
              )}
              {selected.waiting_list_client_id && <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">Ce prospect a été transféré vers la liste d’attente.</div>}
              <details className="mt-4 border-t border-[#eadfd2] pt-4">
                <summary className="cursor-pointer text-sm font-semibold text-[#8a5633]">Voir tous les renseignements</summary>
                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <div><dt className="font-semibold text-[#8a6f5d]">Date de naissance</dt><dd className="mt-1 text-[#332820]">{selected.birth_date || 'Non précisée'}</dd></div>
                  <div><dt className="font-semibold text-[#8a6f5d]">Modalités</dt><dd className="mt-1 text-[#332820]">{selected.modalities.join(', ') || 'Non précisées'}</dd></div>
                  <div><dt className="font-semibold text-[#8a6f5d]">Requérant</dt><dd className="mt-1 text-[#332820]">{selected.requester_names.join(' / ') || 'Pour soi-même'}</dd></div>
                  <div><dt className="font-semibold text-[#8a6f5d]">Source</dt><dd className="mt-1 text-[#332820]">{selected.source}</dd></div>
                  <div className="sm:col-span-2"><dt className="font-semibold text-[#8a6f5d]">Adresse</dt><dd className="mt-1 text-[#332820]">{[selected.service_address, selected.service_city, selected.service_postal_code].filter(Boolean).join(', ') || 'Non précisée'}</dd></div>
                </dl>
              </details>
            </>}
          </ProspectDialog>}
        </div>
      </div>
    </main>
  </>
}
