'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ShieldAlert, Trash2 } from 'lucide-react'
import { Badge, buttonClass, EmptyState, SectionCard } from '@/components/ui/index'
import {
  addLocalDays,
  dateKeyInToronto,
  dateTimeInputToUtcInToronto,
  startOfLocalWeek,
  torontoLocalToUtc,
} from '@/lib/publicIntakeSchedule'
import { appointmentStatusLabels, prospectDateTime as dateTime, type IntakeAppointment } from '@/lib/prospectsWorkspace'

type Appointment = IntakeAppointment & {
  prospect: {
    first_name: string | null
    last_name: string | null
    phone: string | null
    potential_duplicate: boolean
  } | null
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
const timeOnly = new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' })
const dayTitle = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Toronto' })

export function IntakeCalendar({ authenticatedFetch, onSelectProspect, refreshVersion }: {
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>
  onSelectProspect: (id: string, appointmentId?: string) => void
  refreshVersion: number
}) {
  const [mode, setMode] = useState<'day' | 'week'>('week')
  const [cursorDate, setCursorDate] = useState(() => dateKeyInToronto(new Date()))
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [blocks, setBlocks] = useState<CalendarBlock[]>([])
  const [callbacks, setCallbacks] = useState<RapidCallback[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showBlockForm, setShowBlockForm] = useState(false)
  const tomorrowDate = addLocalDays(dateKeyInToronto(new Date()), 1)
  const [blockForm, setBlockForm] = useState({
    startAt: `${tomorrowDate}T09:00`,
    endAt: `${tomorrowDate}T09:30`,
    reason: '',
  })

  const range = useMemo(() => {
    const fromDate = mode === 'week' ? startOfLocalWeek(cursorDate) : cursorDate
    const toDate = addLocalDays(fromDate, mode === 'week' ? 7 : 1)
    return {
      fromDate,
      toDate,
      from: torontoLocalToUtc(fromDate, 0, 0),
      to: torontoLocalToUtc(toDate, 0, 0),
    }
  }, [cursorDate, mode])
  const days = useMemo(
    () => Array.from({ length: mode === 'week' ? 7 : 1 }, (_, index) => addLocalDays(range.fromDate, index)),
    [mode, range.fromDate]
  )

  const loadCalendar = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chargement impossible.')
    } finally { setLoading(false) }
  }, [authenticatedFetch, range.from, range.to])

  useEffect(() => { void loadCalendar() }, [loadCalendar, refreshVersion])

  const createBlock = async () => {
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await authenticatedFetch('/api/direction/intake-calendar/blocks', {
        method: 'POST',
        body: JSON.stringify({
          startAt: dateTimeInputToUtcInToronto(blockForm.startAt).toISOString(),
          endAt: dateTimeInputToUtcInToronto(blockForm.endAt).toISOString(),
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
    try {
      const response = await authenticatedFetch(`/api/direction/intake-calendar/blocks/${id}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) setError(payload.error ?? 'Suppression impossible.')
      else { setMessage('Le blocage a été retiré.'); await loadCalendar() }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Suppression impossible.')
    } finally { setSaving(false) }
  }

  return (
    <>
      <div className="mb-5 flex justify-end"><button type="button" className={buttonClass('primary')} onClick={() => setShowBlockForm(true)}>Bloquer une plage</button></div>
      {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {message && <div className="mb-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</div>}

      <SectionCard title="Rappels rapides" description="Demandes prioritaires qui n’ont pas encore été traitées." icon={ShieldAlert} priority={callbacks.length ? 'high' : 'default'}>
        {callbacks.length === 0 ? <EmptyState title="Aucun rappel rapide en attente" /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {callbacks.map((callback) => (
              <div key={callback.id} className="rounded-xl border border-[#e0b98c] bg-[#fff6e9] p-4">
                <div className="flex items-start justify-between gap-3"><p className="font-semibold text-[#332820]">{[callback.first_name, callback.last_name].filter(Boolean).join(' ') || 'Prospect sans nom'}</p><Badge tone="warning">Prioritaire</Badge></div>
                <p className="mt-2 text-sm text-[#6c5a4d]">{callback.phone || 'Téléphone non indiqué'}</p>
                <p className="mt-1 text-xs text-[#8a6f5d]">Rappel dès que possible</p><p className="mt-1 text-xs text-[#8a6f5d]">Demande reçue le {callback.rapid_callback_requested_at ? dateTime.format(new Date(callback.rapid_callback_requested_at)) : 'Date inconnue'}</p>
                {callback.potential_duplicate && <p className="mt-2 text-xs font-semibold text-[#a34d2f]">Doublon potentiel à vérifier</p>}
                <button type="button" onClick={() => onSelectProspect(callback.id)} className="mt-3 inline-flex text-sm font-semibold text-[#8a5633] underline">Ouvrir la fiche prospect</button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <section className="mt-6 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2"><button type="button" className={buttonClass(mode === 'day' ? 'primary' : 'secondary')} onClick={() => setMode('day')}>Jour</button><button type="button" className={buttonClass(mode === 'week' ? 'primary' : 'secondary')} onClick={() => setMode('week')}>Semaine</button></div>
          <div className="flex gap-2"><button type="button" title="Période précédente" className={buttonClass('secondary')} onClick={() => setCursorDate(addLocalDays(cursorDate, mode === 'week' ? -7 : -1))}><ChevronLeft className="h-4 w-4" /></button><button type="button" className={buttonClass('secondary')} onClick={() => setCursorDate(dateKeyInToronto(new Date()))}>Aujourd’hui</button><button type="button" title="Période suivante" className={buttonClass('secondary')} onClick={() => setCursorDate(addLocalDays(cursorDate, mode === 'week' ? 7 : 1))}><ChevronRight className="h-4 w-4" /></button></div>
        </div>

        {loading ? <p className="py-12 text-center text-sm text-[#8a6f5d]">Chargement...</p> : (
          <div className={`mt-5 grid gap-3 ${mode === 'week' ? 'lg:grid-cols-7' : ''}`}>
            {days.map((day) => {
              const nextDay = addLocalDays(day, 1)
              const dayStart = torontoLocalToUtc(day, 0, 0)
              const dayEnd = torontoLocalToUtc(nextDay, 0, 0)
              const dayAppointments = appointments.filter((item) => dateKeyInToronto(new Date(item.start_at)) === day)
              const dayBlocks = blocks.filter((item) => new Date(item.start_at) < dayEnd && new Date(item.end_at) > dayStart)
              return <div key={day} className="min-h-56 rounded-xl border border-[#eadfd2] bg-white p-3">
                <h2 className="text-sm font-semibold capitalize text-[#5d4a3d]">{dayTitle.format(torontoLocalToUtc(day, 12, 0))}</h2>
                <div className="mt-3 space-y-2">
                  {dayAppointments.map((appointment) => <button key={appointment.id} type="button" onClick={() => onSelectProspect(appointment.prospect_id, appointment.id)} className={`w-full rounded-lg border p-3 text-left text-sm ${appointment.status === 'scheduled' ? 'border-[#d8b992] bg-[#fff8ef]' : 'border-[#e4ddd5] bg-[#f5f2ee] opacity-70'}`}><span className="font-semibold text-[#332820]">{timeOnly.format(new Date(appointment.start_at))}</span><span className="ml-2 text-xs">{appointmentStatusLabels[appointment.status]}</span><span className="mt-1 block break-words text-[#6c5a4d]">{[appointment.prospect?.first_name, appointment.prospect?.last_name].filter(Boolean).join(' ') || 'Prospect'}</span>{appointment.prospect?.potential_duplicate && <span className="mt-1 block text-xs font-semibold text-[#a34d2f]">Doublon potentiel</span>}</button>)}
                  {dayBlocks.map((block) => <div key={block.id} className="rounded-lg border border-dashed border-[#9a8b80] bg-[#f4f0ec] p-3 text-sm text-[#5d4a3d]"><div className="flex items-start justify-between gap-2"><span className="font-semibold">Bloqué</span><button type="button" title="Retirer" onClick={() => void deleteBlock(block.id)}><Trash2 className="h-4 w-4" /></button></div><p className="mt-1">{timeOnly.format(new Date(block.start_at))} à {timeOnly.format(new Date(block.end_at))}</p>{block.reason && <p className="mt-1 text-xs">{block.reason}</p>}</div>)}
                  {!dayAppointments.length && !dayBlocks.length && <p className="py-6 text-center text-xs text-[#9a887a]">Aucun élément</p>}
                </div>
              </div>
            })}
          </div>
        )}
      </section>

      {showBlockForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-xl">
        <><h2 className="text-xl font-semibold text-[#332820]">Bloquer une plage</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-[#5d4a3d]">Début<input type="datetime-local" className={`${inputClass} mt-2`} value={blockForm.startAt} onChange={(event) => setBlockForm({ ...blockForm, startAt: event.target.value })} /></label><label className="text-sm font-semibold text-[#5d4a3d]">Fin<input type="datetime-local" className={`${inputClass} mt-2`} value={blockForm.endAt} onChange={(event) => setBlockForm({ ...blockForm, endAt: event.target.value })} /></label></div><label className="mt-4 block text-sm font-semibold text-[#5d4a3d]">Motif facultatif<input className={`${inputClass} mt-2`} value={blockForm.reason} onChange={(event) => setBlockForm({ ...blockForm, reason: event.target.value })} /></label><div className="mt-6 flex justify-end gap-2"><button type="button" className={buttonClass('secondary')} onClick={() => setShowBlockForm(false)}>Annuler</button><button type="button" disabled={saving} className={buttonClass('primary')} onClick={() => void createBlock()}>Enregistrer</button></div></>
      </div></div>}
    </>
  )
}
