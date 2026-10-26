'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppNav } from '@/components/AppNav'
import { Badge, EmptyState, PageHeader, SectionCard, StatCard } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import { buildClinicalDashboard, type ClinicalOverviewData, type ClinicalOverviewView, type OverviewProfessional } from '@/lib/clinicalOverview'
import { clientGroupOptions, formatAgeRanges, getOptionLabels, languageOptions, meetingModeOptions, motifOptions, officeLocationOptions, serviceTypeOptions } from '@/lib/professionalPreferences'

const inputClass = 'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820]'
const titles = { dashboard: 'Tableau de bord clinique', 'waiting-list': 'Liste d’attente', preferences: 'Préférences des professionnels' }
const priorityLabels: Record<string, string> = { urgent: 'Urgent', existing_or_transfer: 'Client existant / transfert', normal: 'Normale', regular: 'Normale' }
const text = (value: string | null | undefined) => value?.trim() || 'Non renseigné'
const labels = (values: string[] | null, options: typeof languageOptions) => getOptionLabels(values, options).join(', ') || 'Non renseigné'

export function ProfessionalPreferenceSummary({ professional: p }: { professional: OverviewProfessional }) {
  const fields = [
    ['Services', labels(p.pref_service_types, serviceTypeOptions)],
    ['Âges', p.pref_age_ranges?.length ? formatAgeRanges(p.pref_age_ranges) : 'Non renseignés'],
    ['Clientèles', labels(p.pref_client_groups, clientGroupOptions)],
    ['Modalités', labels(p.pref_meeting_modes, meetingModeOptions)],
    ['Bureaux', labels(p.pref_office_locations, officeLocationOptions)],
    ['Langues', labels(p.pref_languages, languageOptions)],
    ['Motifs', labels(p.pref_motifs, motifOptions)],
    ['Exclusions', text(p.pref_exclusions)], ['Précisions', text(p.pref_matching_notes)],
  ]
  return <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">{fields.map(([label, value]) => <div key={label}><dt className="font-semibold text-[#76543a]">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-[#493a2e]">{value}</dd></div>)}</dl>
}

export function ClinicalOverview({ view }: { view: ClinicalOverviewView }) {
  const [data, setData] = useState<ClinicalOverviewData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [service, setService] = useState('')
  const [mode, setMode] = useState('')
  const [office, setOffice] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true); setData(null); setError('')
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error('Veuillez vous connecter pour consulter cette page.')
        const response = await fetch(`/api/clinical-overview?view=${view}`, { cache: 'no-store', signal: controller.signal, headers: { Authorization: `Bearer ${session.access_token}` } })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Consultation indisponible.')
        if (!cancelled) setData(payload)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Consultation indisponible.')
      } finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true; controller.abort() }
  }, [view])
  const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const professionals = useMemo(() => (data?.professionals ?? []).filter(p =>
    normalized([p.full_name, p.professional_title, ...getOptionLabels(p.pref_motifs, motifOptions), p.pref_exclusions, p.pref_matching_notes].filter(Boolean).join(' ')).includes(normalized(search))
    && (!service || p.pref_service_types?.includes(service)) && (!mode || p.pref_meeting_modes?.includes(mode)) && (!office || p.pref_office_locations?.includes(office))
  ), [data, search, service, mode, office])
  const clients = useMemo(() => (data?.waitingList ?? []).filter(c =>
    normalized([c.client_name, c.city, c.service_requested, c.consultation_reason, c.availability, ...(c.meeting_modality ?? [])].filter(Boolean).join(' ')).includes(normalized(search))
  ), [data, search])
  const dashboard = useMemo(() => buildClinicalDashboard(data ?? {}), [data])
  const pages = Math.max(1, Math.ceil(clients.length / 20))
  const currentPage = Math.min(page, pages)
  return <><AppNav /><main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10"><div className="mx-auto max-w-7xl space-y-6">
    <PageHeader eyebrow="Consultation clinique" title={titles[view]} description={view === 'preferences' ? 'Préférences des professionnels actifs, regroupées pour faciliter la coordination clinique.' : 'Suivi des demandes et des capacités pour la coordination clinique.'} />
    <Badge tone="neutral">Lecture seule</Badge>
    {loading && <p role="status">Chargement…</p>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</p>}
    {data && !loading && !error && <>
      {view !== 'dashboard' && <SectionCard title="Rechercher et filtrer"><div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm">{view === 'preferences' ? 'Nom, motif ou précision' : 'Client, service, ville ou motif'}<input className={inputClass} value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Rechercher" /></label>
        {view === 'preferences' && <>{([['Services', service, setService, serviceTypeOptions], ['Modalités', mode, setMode, meetingModeOptions], ['Bureaux', office, setOffice, officeLocationOptions]] as const).map(([label, value, setter, options]) => <label className="text-sm" key={label}>{label}<select className={inputClass} value={value} onChange={e => setter(e.target.value)}><option value="">Tous</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>)}</>}
      </div></SectionCard>}
      {view === 'preferences' && <><p className="text-sm text-[#7a6859]">{professionals.length} professionnel{professionals.length > 1 ? 's' : ''} actif{professionals.length > 1 ? 's' : ''}</p>{professionals.map(p => <SectionCard key={p.id} title={p.full_name || 'Nom non renseigné'}><p className="mb-4 text-sm text-[#7a6859]">{text(p.professional_title)}</p><ProfessionalPreferenceSummary professional={p} /></SectionCard>)}{!professionals.length && <EmptyState title="Aucun professionnel ne correspond aux filtres." />}</>}
      {view === 'waiting-list' && <><p className="text-sm text-[#7a6859]">{clients.length} dossier{clients.length > 1 ? 's' : ''} en attente</p>{clients.slice((currentPage - 1) * 20, currentPage * 20).map(c => <SectionCard key={c.id} title={text(c.client_name)}><div className="mb-3 flex flex-wrap gap-2"><Badge tone={c.priority_level === 'urgent' ? 'warning' : 'neutral'}>{priorityLabels[c.priority_level ?? ''] || text(c.priority_level)}</Badge><Badge tone="neutral">{text(c.service_requested)}</Badge></div><dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">{[
        ['Date de demande', c.contact_date || c.created_at?.slice(0, 10)], ['Date de naissance', c.birth_date], ['Ville', c.city], ['Modalités', c.meeting_modality?.join(', ')], ['Disponibilités', c.availability], ['Motif de consultation', c.consultation_reason],
      ].map(([label, value]) => <div key={label}><dt className="font-semibold text-[#76543a]">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{text(value)}</dd></div>)}</dl></SectionCard>)}{!clients.length && <EmptyState title="Aucun dossier en attente ne correspond à la recherche." />}{pages > 1 && <nav aria-label="Pagination de la liste d’attente" className="flex items-center gap-4"><button className={inputClass + ' w-auto disabled:opacity-40'} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Précédent</button><span>{currentPage} / {pages}</span><button className={inputClass + ' w-auto disabled:opacity-40'} disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Suivant</button></nav>}</>}
      {view === 'dashboard' && <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Clients en attente" value={data.waitingStats?.waiting ?? 0} /><StatCard label="Urgences / transferts" value={data.waitingStats?.urgent ?? 0} /><StatCard label="Places à combler" value={dashboard.reduce((n, r) => n + r.remaining, 0)} /><StatCard label="Services pris" value={dashboard.reduce((n, r) => n + r.active, 0)} /></section><SectionCard title="Demandes des professionnels"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Professionnel', 'Demande', 'Places demandées', 'Places restantes', 'Services pris', 'À confirmer', 'Non pris', 'Commentaire'].map(h => <th className="border-b p-3" key={h}>{h}</th>)}</tr></thead><tbody>{dashboard.map(r => <tr key={r.id}><td className="border-b p-3 font-semibold">{r.name}</td><td className="border-b p-3">{r.status}</td><td className="border-b p-3">{r.requested}</td><td className="border-b p-3">{r.remaining}</td><td className="border-b p-3">{r.active}</td><td className="border-b p-3">{r.pending}</td><td className="border-b p-3">{r.refused}</td><td className="min-w-52 whitespace-pre-wrap border-b p-3">{r.comment || '—'}</td></tr>)}</tbody></table></div>{!dashboard.length && <EmptyState title="Aucun professionnel actif." />}</SectionCard></>}
    </>}
  </div></main></>
}
