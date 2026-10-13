'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, CalendarRange, DollarSign, RefreshCw } from 'lucide-react'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
  buttonClass,
  EmptyState,
  PageHeader,
  StatCard,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeaderClass,
  tableRowClass,
  tableShellClass,
} from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import { acquisitionAttributionFor } from '@/lib/acquisitionAttribution'

type ProspectRow = {
  created_at: string
  status: string
  contact_request_type: string
  source: string
  utm: Record<string, string> | null
  conversion_event_id: string
}

type ExpenseRow = {
  id: string
  name: string
  amount: number
  expense_date: string
  notes: string | null
  ad_platform: 'google_ads' | 'meta_ads'
  expense_month: string
}

type AcquisitionEventRow = {
  created_at: string
  event_type: 'contact_form_submitted' | 'phone_click'
  source: string
  utm: Record<string, string> | null
  conversion_event_id: string
}

type BreakdownRow = {
  key: string
  platform: string
  campaign: string
  prospects: number
  bookings: number
  callbacks: number
  servicesTaken: number
  contactForms: number
  phoneClicks: number
}

const inputClass =
  'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

function localDate(offsetDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(value)
}

function platformLabel(platform: string) {
  if (platform === 'google_ads') return 'Google Ads'
  if (platform === 'meta_ads') return 'Meta Ads'
  if (platform === 'google') return 'Google'
  if (['facebook', 'instagram', 'meta', 'fb', 'ig'].includes(platform)) return 'Meta'
  return platform === 'direct' ? 'Origine non déterminée' : platform
}

function attributionFor(prospect: ProspectRow) {
  return acquisitionAttributionFor(prospect)
}

function eventAttribution(event: AcquisitionEventRow) {
  return attributionFor({
    ...event,
    status: '',
    contact_request_type: '',
  })
}

export default function AcquisitionPage() {
  const router = useRouter()
  const [from, setFrom] = useState(localDate(-29))
  const [to, setTo] = useState(localDate())
  const [prospects, setProspects] = useState<ProspectRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [events, setEvents] = useState<AcquisitionEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [platform, setPlatform] = useState<'google_ads' | 'meta_ads'>('google_ads')
  const [expenseMonth, setExpenseMonth] = useState(localDate().slice(0, 7))
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseNotes, setExpenseNotes] = useState('')

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

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await authenticatedFetch(`/api/direction/acquisition?from=${from}&to=${to}`)
      const payload = await response.json()
      if (response.status === 401) { setAuthorized(false); router.push('/login'); return }
      if (response.status === 403) { setAuthorized(false); router.push('/direction'); return }
      if (!response.ok) throw new Error(payload.error ?? 'Chargement impossible.')
      setAuthorized(true)
      setProspects(payload.prospects ?? [])
      setEvents(payload.events ?? [])
      setExpenses((payload.expenses ?? []).map((item: ExpenseRow) => ({
        ...item,
        amount: Number(item.amount ?? 0),
      })))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }, [authenticatedFetch, from, router, to])

  useEffect(() => { void load() }, [load])

  const breakdown = useMemo(() => {
    const grouped = new Map<string, BreakdownRow>()
    for (const prospect of prospects) {
      const attribution = attributionFor(prospect)
      const key = `${attribution.platform}|${attribution.campaign}`
      const current = grouped.get(key) ?? {
        key,
        platform: attribution.platform,
        campaign: attribution.campaign,
        prospects: 0,
        bookings: 0,
        callbacks: 0,
        servicesTaken: 0,
        contactForms: 0,
        phoneClicks: 0,
      }
      current.prospects += 1
      current.bookings += prospect.contact_request_type === 'scheduled_call' ? 1 : 0
      current.callbacks += prospect.contact_request_type === 'rapid_callback' ? 1 : 0
      current.servicesTaken += ['service_taken', 'transferred_to_waiting_list'].includes(prospect.status) ? 1 : 0
      grouped.set(key, current)
    }
    for (const event of events) {
      const attribution = eventAttribution(event)
      const key = `${attribution.platform}|${attribution.campaign}`
      const current = grouped.get(key) ?? {
        key,
        platform: attribution.platform,
        campaign: attribution.campaign,
        prospects: 0,
        bookings: 0,
        callbacks: 0,
        servicesTaken: 0,
        contactForms: 0,
        phoneClicks: 0,
      }
      current.contactForms += event.event_type === 'contact_form_submitted' ? 1 : 0
      current.phoneClicks += event.event_type === 'phone_click' ? 1 : 0
      grouped.set(key, current)
    }
    return [...grouped.values()].sort((a, b) => b.prospects - a.prospects)
  }, [events, prospects])

  const totalSpend = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const bookingCount = prospects.filter((item) => item.contact_request_type === 'scheduled_call').length
  const callbackCount = prospects.filter((item) => item.contact_request_type === 'rapid_callback').length
  const serviceTakenCount = prospects.filter((item) => ['service_taken', 'transferred_to_waiting_list'].includes(item.status)).length
  const attributedCount = prospects.filter((item) => attributionFor(item).platform !== 'direct').length
  const contactFormCount = events.filter((item) => item.event_type === 'contact_form_submitted').length
  const phoneClickCount = events.filter((item) => item.event_type === 'phone_click').length

  const saveExpense = async () => {
    const amount = Number(expenseAmount.replace(',', '.'))
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Indiquez un montant valide.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await authenticatedFetch('/api/direction/acquisition', {
        method: 'POST',
        body: JSON.stringify({ platform, month: expenseMonth, amount, notes: expenseNotes }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Enregistrement impossible.')
      setMessage(payload.replaced
        ? 'La dépense publicitaire du mois a été remplacée dans le budget.'
        : 'La dépense publicitaire a été ajoutée aux dépenses variables du budget.')
      setExpenseAmount('')
      setExpenseNotes('')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Enregistrement impossible.')
    } finally {
      setSaving(false)
    }
  }

  const syncExpenses = async () => {
    setSyncing(true)
    setError('')
    setMessage('')
    try {
      const response = await authenticatedFetch('/api/direction/acquisition/sync', {
        method: 'POST',
        body: JSON.stringify({ days: 90 }),
      })
      const payload = await response.json() as {
        results?: Array<{ platform: string; status: string; amount: number; currency: string | null; message: string }>
        error?: string
      }
      if (!response.ok && response.status !== 207) {
        throw new Error(payload.error ?? 'Synchronisation impossible.')
      }
      const summary = (payload.results ?? []).map((item) =>
        `${platformLabel(item.platform)} : ${item.status === 'success'
          ? formatCurrency(item.amount)
          : item.message}`
      ).join(' · ')
      if ((payload.results ?? []).some((item) => item.status === 'error')) {
        setError(summary || 'Une plateforme n’a pas pu être synchronisée.')
      } else {
        setMessage(summary || 'Synchronisation terminée.')
      }
      await load()
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Synchronisation impossible.')
    } finally {
      setSyncing(false)
    }
  }

  if (!authorized) return <>
    <AppNav />
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
      <p className="text-sm text-[#7a6859]">{error || 'Vérification de l’accès...'}</p>
    </main>
  </>

  return <>
    <AppNav />
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader eyebrow="Direction" title="Acquisition" description="Comparez les prospects réellement reçus, leur origine et les dépenses publicitaires." />
        {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {message && <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</div>}

        <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5">
          <div className="flex items-center gap-2"><CalendarRange className="h-5 w-5 text-[#8a5633]" /><h2 className="font-semibold text-[#332820]">Période analysée</h2></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="text-sm font-semibold text-[#5d4a3d]">Du<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={`${inputClass} mt-2`} /></label>
            <label className="text-sm font-semibold text-[#5d4a3d]">Au<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={`${inputClass} mt-2`} /></label>
            <button type="button" onClick={() => void load()} className={buttonClass('secondary')}><RefreshCw className="h-4 w-4" />Actualiser</button>
          </div>
        </section>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Prospects reçus" value={prospects.length} helper="Tous les formulaires publics" />
          <StatCard label="Réservations" value={bookingCount} helper="Appels planifiés" />
          <StatCard label="Rappels rapides" value={callbackCount} helper="Demandes sans créneau" />
          <StatCard label="Formulaires de contact" value={contactFormCount} helper="Soumissions réussies" />
          <StatCard label="Clics téléphoniques" value={phoneClickCount} helper="Intention secondaire" />
          <StatCard label="Services pris" value={serviceTakenCount} helper="Confirmés ou transférés" />
          <StatCard label="Dépenses publicitaires" value={formatCurrency(totalSpend)} helper={prospects.length ? `${formatCurrency(totalSpend / prospects.length)} / prospect` : 'Aucun prospect'} />
        </div>

        <section className="mt-6 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5">
          <div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-[#8a5633]" /><h2 className="font-semibold text-[#332820]">Origines et campagnes</h2></div>
          <p className="mt-1 text-sm text-[#7a6859]">Une origine inconnue signifie que le visiteur est arrivé directement ou que les paramètres publicitaires n’ont pas été conservés.</p>
          <p className="mt-2 text-sm font-semibold text-[#5d4a3d]">{attributedCount} demande{attributedCount > 1 ? 's' : ''} avec une provenance sur {prospects.length}. Les demandes sans provenance ne peuvent pas être attribuées rétroactivement aux publicités.</p>
          <div className={`${tableShellClass} mt-4`}>
            <table className={`${tableClass} w-full`}>
              <thead className={tableHeaderClass}><tr><th className={tableHeadCellClass}>Plateforme</th><th className={tableHeadCellClass}>Campagne</th><th className={tableHeadCellClass}>Prospects</th><th className={tableHeadCellClass}>Réservations</th><th className={tableHeadCellClass}>Rappels</th><th className={tableHeadCellClass}>Contacts</th><th className={tableHeadCellClass}>Clics tél.</th><th className={tableHeadCellClass}>Services pris</th></tr></thead>
              <tbody className={tableBodyClass}>
                {breakdown.length === 0 ? <tr><td colSpan={8} className="p-6"><EmptyState title={loading ? 'Chargement...' : 'Aucune acquisition pour cette période'} /></td></tr> : breakdown.map((row) => <tr key={row.key} className={tableRowClass}><td className={tableCellClass}><Badge tone={row.platform === 'direct' ? 'muted' : 'neutral'}>{platformLabel(row.platform)}</Badge></td><td className={tableCellClass}>{row.campaign}</td><td className={tableCellClass}>{row.prospects}</td><td className={tableCellClass}>{row.bookings}</td><td className={tableCellClass}>{row.callbacks}</td><td className={tableCellClass}>{row.contactForms}</td><td className={tableCellClass}>{row.phoneClicks}</td><td className={tableCellClass}>{row.servicesTaken}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-[#8a5633]" /><h2 className="font-semibold text-[#332820]">Dépenses publicitaires mensuelles</h2></div>
            <button type="button" disabled={syncing} onClick={() => void syncExpenses()} className={buttonClass('secondary')}>
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Synchronisation...' : 'Synchroniser Meta et Google'}
            </button>
          </div>
          <p className="mt-1 text-sm text-[#7a6859]">Les dépenses sont synchronisées quotidiennement depuis les plateformes et remplacent le total du mois dans le budget. La saisie manuelle reste disponible comme solution de secours.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.4fr_auto] md:items-end">
            <label className="text-sm font-semibold text-[#5d4a3d]">Plateforme<select value={platform} onChange={(event) => setPlatform(event.target.value as typeof platform)} className={`${inputClass} mt-2`}><option value="google_ads">Google Ads</option><option value="meta_ads">Meta Ads</option></select></label>
            <label className="text-sm font-semibold text-[#5d4a3d]">Mois<input type="month" value={expenseMonth} onChange={(event) => setExpenseMonth(event.target.value)} className={`${inputClass} mt-2`} /></label>
            <label className="text-sm font-semibold text-[#5d4a3d]">Montant CAD<input type="number" min="0" step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} className={`${inputClass} mt-2`} /></label>
            <label className="text-sm font-semibold text-[#5d4a3d]">Note<input value={expenseNotes} onChange={(event) => setExpenseNotes(event.target.value)} placeholder="Période ou référence" className={`${inputClass} mt-2`} /></label>
            <button type="button" disabled={saving || !expenseMonth || !expenseAmount} onClick={() => void saveExpense()} className={buttonClass('primary')}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">{expenses.map((expense) => <Badge key={expense.id} tone="muted">{platformLabel(expense.ad_platform)} · {expense.expense_month.slice(0, 7)} · {formatCurrency(expense.amount)}</Badge>)}</div>
        </section>
      </div>
    </main>
  </>
}
