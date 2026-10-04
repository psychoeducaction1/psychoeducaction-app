'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, PhoneCall, ShieldAlert, Trash2 } from 'lucide-react'
import { AppNav } from '@/components/AppNav'
import { Badge, buttonClass, EmptyState, PageHeader, SectionCard } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'

type Appointment = {
  id: string
  prospect_id: string
  start_at: string
  end_at: string
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  prospect: {
    first_name: string | null
    last_name: string | null
    phone: string | null
    potential_duplicate: boolean
  } | null
  events: Array<{
    id: string
    event_type: string
    previous_start_at: string | null
    new_start_at: string | null
    note: string | null
    actor_name: string | null
    created_at: string
  }>
}
type CalendarBlock = { id: string; start_at: string; end_at: string; reason: string | null }
type RapidCallback = {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  rapid_callback_requested_at: string | null
  potential_duplicate: boolean
}

const inputClass = 'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'
const dateTime = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' })
const timeOnly = new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' })
const dayTitle = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Toronto' })

function startOfDay(date: Date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}
function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}
function startOfWeek(date: Date) {
  const result = startOfDay(date)
  return addDays(result, 1 - (result.getDay() || 7))
}
function localInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

export default function IntakeCalendarPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'day' | 'week'>('week')
  const [cursor, setCursor] = useState(() => new Date())
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [blocks, setBlocks] = useState<CalendarBlock[]>([])
  const [callbacks, setCallbacks] = useState<RapidCallback[]>([])
  const [selected, setSelected] = useState<Appointment | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showBlockForm, setShowBlockForm] = useState(false)
  const [rescheduleAt, setRescheduleAt] = useState('')
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const [blockForm, setBlockForm] = useState({
    startAt: localInputValue(tomorrow),
    endAt: localInputValue(new Date(tomorrow.getTime() + 30 * 60_000)),
    reason: '',
  })

  const range = useMemo(() => {
    const from = mode === 'week' ? startOfWeek(cursor) : startOfDay(cursor)
    return { from, to: addDays(from, mode === 'week' ? 7 : 1) }
  }, [cursor, mode])
  const days = useMemo(
    () => Array.from({ length: mode === 'week' ? 7 : 1 }, (_, index) => addDays(range.from, index)),
    [mode, range.from]
  )

  const authenticatedFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Session expirée.')
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  }, [])

  const loadCalendar = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const response = await authenticatedFetch(
      `/api/direction/intake-calendar?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`
    )
    const payload = await response.json()
    if (!response.ok) setError(payload.error ?? 'Chargement impossible.')
    else {
      setAppointments(payload.appointments ?? [])
      setBlocks(payload.blocks ?? [])
      setCallbacks(payload.rapidCallbacks ?? [])
    }
    setLoading(false)
  }, [authenticatedFetch, range.from, range.to, router])

  useEffect(() => { void loadCalendar() }, [loadCalendar])

  const createBlock = async () => {
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await authenticatedFetch('/api/direction/intake-calendar/blocks', {
        method: 'POST',
        body: JSON.stringify({
          startAt: new Date(blockForm.startAt).toISOString(),
          endAt: new Date(blockForm.endAt).toISOString(),
          reason: blockForm.reason,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Blocage impossible.')
      setShowBlockForm(false)
      setMessage('La plage est maintenant bloquée.')
      await loadCalendar()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Blocage impossible.')
    }
    setSaving(false)
  }

  const deleteBlock = async (id: string) => {
    if (!window.confirm('Retirer ce blocage du calendrier?')) return
    setSaving(true); setError('')
    const response = await authenticatedFetch(`/api/direction/intake-calendar/blocks/${id}`, { method: 'DELETE' })
    const payload = await response.json()
    if (!response.ok) setError(payload.error ?? 'Suppression impossible.')
    else { setMessage('Le blocage a été retiré.'); await loadCalendar() }
    setSaving(false)
  }

  const updateAppointment = async (action: 'cancel' | 'reschedule') => {
    if (!selected) return
    if (action === 'cancel' && !window.confirm('Annuler ce rendez-vous téléphonique?')) return
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await authenticatedFetch(`/api/direction/intake-appointments/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action,
          ...(action === 'reschedule' ? { startAt: new Date(rescheduleAt).toISOString() } : {}),
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Modification impossible.')
      setMessage(action === 'cancel' ? 'Le rendez-vous est annulé.' : 'Le rendez-vous a été déplacé.')
      setSelected(null)
      await loadCalendar()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Modification impossible.')
    }
    setSaving(false)
  }

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Direction"
            title="Calendrier des appels"
            description="Rendez-vous téléphoniques du site web et rappels rapides à traiter."
            actions={<button type="button" className={buttonClass('primary')} onClick={() => setShowBlockForm(true)}>Bloquer une plage</button>}
          />
          {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {message && <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</div>}

          <SectionCard title="Rappels rapides" description="Demandes prioritaires qui n’ont pas encore été traitées." icon={ShieldAlert} priority={callbacks.length ? 'high' : 'default'}>
            {callbacks.length === 0 ? <EmptyState title="Aucun rappel rapide en attente" /> : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {callbacks.map((callback) => (
                  <div key={callback.id} className="rounded-xl border border-[#e0b98c] bg-[#fff6e9] p-4">
                    <div className="flex items-start justify-between gap-3"><p className="font-semibold text-[#332820]">{[callback.first_name, callback.last_name].filter(Boolean).join(' ') || 'Prospect sans nom'}</p><Badge tone="warning">Prioritaire</Badge></div>
                    <p className="mt-2 text-sm text-[#6c5a4d]">{callback.phone || 'Téléphone non indiqué'}</p>
                    <p className="mt-1 text-xs text-[#8a6f5d]">{callback.rapid_callback_requested_at ? dateTime.format(new Date(callback.rapid_callback_requested_at)) : 'Date inconnue'}</p>
                    {callback.potential_duplicate && <p className="mt-2 text-xs font-semibold text-[#a34d2f]">Doublon potentiel à vérifier</p>}
                    <Link href={`/direction/prospects?prospect=${callback.id}`} className="mt-3 inline-flex text-sm font-semibold text-[#8a5633] underline">Ouvrir la fiche prospect</Link>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <section className="mt-6 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2"><button type="button" className={buttonClass(mode === 'day' ? 'primary' : 'secondary')} onClick={() => setMode('day')}>Jour</button><button type="button" className={buttonClass(mode === 'week' ? 'primary' : 'secondary')} onClick={() => setMode('week')}>Semaine</button></div>
              <div className="flex gap-2"><button type="button" title="Période précédente" className={buttonClass('secondary')} onClick={() => setCursor(addDays(cursor, mode === 'week' ? -7 : -1))}><ChevronLeft className="h-4 w-4" /></button><button type="button" className={buttonClass('secondary')} onClick={() => setCursor(new Date())}>Aujourd’hui</button><button type="button" title="Période suivante" className={buttonClass('secondary')} onClick={() => setCursor(addDays(cursor, mode === 'week' ? 7 : 1))}><ChevronRight className="h-4 w-4" /></button></div>
            </div>

            {loading ? <p className="py-12 text-center text-sm text-[#8a6f5d]">Chargement...</p> : (
              <div className={`mt-5 grid gap-3 ${mode === 'week' ? 'lg:grid-cols-7' : ''}`}>
                {days.map((day) => {
                  const nextDay = addDays(day, 1)
                  const dayAppointments = appointments.filter((item) => new Date(item.start_at) >= day && new Date(item.start_at) < nextDay)
                  const dayBlocks = blocks.filter((item) => new Date(item.start_at) < nextDay && new Date(item.end_at) > day)
                  return <div key={day.toISOString()} className="min-h-56 rounded-xl border border-[#eadfd2] bg-white p-3">
                    <h2 className="text-sm font-semibold capitalize text-[#5d4a3d]">{dayTitle.format(day)}</h2>
                    <div className="mt-3 space-y-2">
                      {dayAppointments.map((appointment) => <button key={appointment.id} type="button" onClick={() => { setSelected(appointment); setRescheduleAt(localInputValue(new Date(appointment.start_at))) }} className={`w-full rounded-lg border p-3 text-left text-sm ${appointment.status === 'scheduled' ? 'border-[#d8b992] bg-[#fff8ef]' : 'border-[#e4ddd5] bg-[#f5f2ee] opacity-70'}`}><span className="font-semibold text-[#332820]">{timeOnly.format(new Date(appointment.start_at))}</span><span className="mt-1 block break-words text-[#6c5a4d]">{[appointment.prospect?.first_name, appointment.prospect?.last_name].filter(Boolean).join(' ') || 'Prospect'}</span>{appointment.prospect?.potential_duplicate && <span className="mt-1 block text-xs font-semibold text-[#a34d2f]">Doublon potentiel</span>}</button>)}
                      {dayBlocks.map((block) => <div key={block.id} className="rounded-lg border border-dashed border-[#9a8b80] bg-[#f4f0ec] p-3 text-sm text-[#5d4a3d]"><div className="flex items-start justify-between gap-2"><span className="font-semibold">Bloqué</span><button type="button" title="Retirer" onClick={() => void deleteBlock(block.id)}><Trash2 className="h-4 w-4" /></button></div><p className="mt-1">{timeOnly.format(new Date(block.start_at))} à {timeOnly.format(new Date(block.end_at))}</p>{block.reason && <p className="mt-1 text-xs">{block.reason}</p>}</div>)}
                      {!dayAppointments.length && !dayBlocks.length && <p className="py-6 text-center text-xs text-[#9a887a]">Aucun élément</p>}
                    </div>
                  </div>
                })}
              </div>
            )}
          </section>
        </div>
      </main>

      {(showBlockForm || selected) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-xl">
        {showBlockForm ? <><h2 className="text-xl font-semibold text-[#332820]">Bloquer une plage</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-[#5d4a3d]">Début<input type="datetime-local" className={`${inputClass} mt-2`} value={blockForm.startAt} onChange={(event) => setBlockForm({ ...blockForm, startAt: event.target.value })} /></label><label className="text-sm font-semibold text-[#5d4a3d]">Fin<input type="datetime-local" className={`${inputClass} mt-2`} value={blockForm.endAt} onChange={(event) => setBlockForm({ ...blockForm, endAt: event.target.value })} /></label></div><label className="mt-4 block text-sm font-semibold text-[#5d4a3d]">Motif facultatif<input className={`${inputClass} mt-2`} value={blockForm.reason} onChange={(event) => setBlockForm({ ...blockForm, reason: event.target.value })} /></label><div className="mt-6 flex justify-end gap-2"><button type="button" className={buttonClass('secondary')} onClick={() => setShowBlockForm(false)}>Annuler</button><button type="button" disabled={saving} className={buttonClass('primary')} onClick={() => void createBlock()}>Enregistrer</button></div></> : selected && <><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-[#332820]">{[selected.prospect?.first_name, selected.prospect?.last_name].filter(Boolean).join(' ') || 'Rendez-vous'}</h2><p className="mt-1 text-sm text-[#7a6859]">{dateTime.format(new Date(selected.start_at))}</p></div><Badge tone={selected.status === 'scheduled' ? 'success' : 'muted'}>{selected.status === 'scheduled' ? 'Planifié' : selected.status}</Badge></div><p className="mt-5 rounded-xl border border-[#eadfd2] bg-white p-4 text-sm"><PhoneCall className="mr-2 inline h-4 w-4" />{selected.prospect?.phone || 'Téléphone non indiqué'}</p><Link href={`/direction/prospects?prospect=${selected.prospect_id}`} className="mt-4 inline-flex font-semibold text-[#8a5633] underline">Ouvrir la fiche prospect</Link>{selected.events.length > 0 && <details className="mt-4 rounded-xl border border-[#eadfd2] bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-[#5d4a3d]">Historique ({selected.events.length})</summary><div className="mt-3 space-y-3">{selected.events.map((event) => <div key={event.id} className="border-l-2 border-[#d8b992] pl-3 text-xs text-[#6c5a4d]"><p className="font-semibold">{event.event_type === 'scheduled' ? 'Rendez-vous créé' : event.event_type === 'rescheduled' ? 'Rendez-vous déplacé' : event.event_type === 'cancelled' ? 'Rendez-vous annulé' : event.event_type}</p><p>{dateTime.format(new Date(event.created_at))}{event.actor_name ? ` · ${event.actor_name}` : ''}</p>{event.note && <p className="mt-1">{event.note}</p>}</div>)}</div></details>}{selected.status === 'scheduled' ? <><label className="mt-5 block text-sm font-semibold text-[#5d4a3d]">Déplacer à<input type="datetime-local" className={`${inputClass} mt-2`} value={rescheduleAt} onChange={(event) => setRescheduleAt(event.target.value)} /></label><div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" className={buttonClass('secondary')} onClick={() => setSelected(null)}>Fermer</button><button type="button" disabled={saving || !rescheduleAt} className={buttonClass('secondary')} onClick={() => void updateAppointment('reschedule')}>Déplacer</button><button type="button" disabled={saving} className={buttonClass('danger')} onClick={() => void updateAppointment('cancel')}>Annuler le rendez-vous</button></div></> : <div className="mt-6 flex justify-end"><button type="button" className={buttonClass('secondary')} onClick={() => setSelected(null)}>Fermer</button></div>}</>}
      </div></div>}
    </>
  )
}
