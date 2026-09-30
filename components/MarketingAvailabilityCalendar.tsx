'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/index'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'

type CalendarMode = 'week' | 'month'
type AvailabilitySlot = {
  id: string
  staff_id: string
  start_at: string
  end_at: string
  note: string | null
}

const inputClass =
  'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

const dayFormatter = new Intl.DateTimeFormat('fr-CA', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const monthFormatter = new Intl.DateTimeFormat('fr-CA', {
  month: 'long',
  year: 'numeric',
})
const timeFormatter = new Intl.DateTimeFormat('fr-CA', {
  hour: '2-digit',
  minute: '2-digit',
})
const selectedDateFormatter = new Intl.DateTimeFormat('fr-CA', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

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
  const day = result.getDay() || 7
  return addDays(result, 1 - day)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function toDateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function dateKey(date: Date) {
  return toDateInputValue(startOfDay(date))
}

function toTimeInputValue(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function durationHours(slot: AvailabilitySlot) {
  return Math.max(
    0,
    (new Date(slot.end_at).getTime() - new Date(slot.start_at).getTime()) /
      3_600_000
  )
}

function formatHours(hours: number) {
  return new Intl.NumberFormat('fr-CA', {
    minimumFractionDigits: hours % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  }).format(hours)
}

export function MarketingAvailabilityCalendar({
  staffId,
  canEdit,
}: {
  staffId: string
  canEdit: boolean
}) {
  const [mode, setMode] = useState<CalendarMode>('week')
  const [cursor, setCursor] = useState(() => new Date())
  const [slots, setSlots] = useState<AvailabilitySlot[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingSlot, setEditingSlot] = useState<AvailabilitySlot | null>(null)
  const [form, setForm] = useState({
    date: toDateInputValue(new Date()),
    startTime: '09:00',
    endTime: '10:00',
    note: '',
  })

  const visibleRange = useMemo(() => {
    if (mode === 'week') {
      const start = startOfWeek(cursor)
      return { start, end: addDays(start, 7) }
    }

    const monthStart = startOfMonth(cursor)
    const start = startOfWeek(monthStart)
    return { start, end: addDays(start, 42) }
  }, [cursor, mode])

  const loadSlots = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: queryError } = await supabase
      .from('marketing_availability_slots')
      .select('id, staff_id, start_at, end_at, note')
      .eq('staff_id', staffId)
      .gte('start_at', visibleRange.start.toISOString())
      .lt('start_at', visibleRange.end.toISOString())
      .order('start_at', { ascending: true })

    if (queryError) setError(queryError.message)
    else setSlots((data ?? []) as AvailabilitySlot[])
    setLoading(false)
  }, [staffId, visibleRange.end, visibleRange.start])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSlots()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadSlots])

  const slotsByDay = useMemo(() => {
    const grouped = new Map<string, AvailabilitySlot[]>()
    slots.forEach((slot) => {
      const key = dateKey(new Date(slot.start_at))
      grouped.set(key, [...(grouped.get(key) ?? []), slot])
    })
    return grouped
  }, [slots])

  const weekStart = startOfWeek(cursor)
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const weeklySlots = slots.filter((slot) => {
    const start = new Date(slot.start_at)
    return start >= weekStart && start < addDays(weekStart, 7)
  })
  const weeklyHours = weeklySlots.reduce(
    (total, slot) => total + durationHours(slot),
    0
  )

  const monthStart = startOfMonth(cursor)
  const monthGridStart = startOfWeek(monthStart)
  const monthDays = Array.from({ length: 42 }, (_, index) =>
    addDays(monthGridStart, index)
  )

  const moveCursor = (direction: -1 | 1) => {
    const next = new Date(cursor)
    if (mode === 'week') next.setDate(next.getDate() + direction * 7)
    else next.setMonth(next.getMonth() + direction)
    setCursor(next)
  }

  const selectDateForEntry = (date: Date) => {
    if (!canEdit) return
    setEditingSlot(null)
    setError('')
    setForm((current) => ({ ...current, date: toDateInputValue(date) }))
    setShowForm(true)
  }

  const editSlot = (slot: AvailabilitySlot) => {
    if (!canEdit) return
    const start = new Date(slot.start_at)
    const end = new Date(slot.end_at)
    setEditingSlot(slot)
    setError('')
    setForm({
      date: toDateInputValue(start),
      startTime: toTimeInputValue(start),
      endTime: toTimeInputValue(end),
      note: slot.note ?? '',
    })
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingSlot(null)
    setError('')
  }

  const saveSlot = async () => {
    const start = new Date(`${form.date}T${form.startTime}`)
    const end = new Date(`${form.date}T${form.endTime}`)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setError("L'heure de fin doit être après l'heure de début.")
      return
    }

    const overlaps = slots.some((slot) => {
      if (slot.id === editingSlot?.id) return false
      const existingStart = new Date(slot.start_at)
      const existingEnd = new Date(slot.end_at)
      return start < existingEnd && end > existingStart
    })
    if (overlaps) {
      setError('Cette plage chevauche une disponibilité déjà inscrite.')
      return
    }

    setSaving(true)
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    const values = {
      staff_id: staffId,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      note: form.note.trim() || null,
    }
    const response = editingSlot
      ? await supabase
          .from('marketing_availability_slots')
          .update(values)
          .eq('id', editingSlot.id)
          .select('id, staff_id, start_at, end_at, note')
          .single()
      : await supabase
          .from('marketing_availability_slots')
          .insert({ ...values, created_by: user?.id ?? null })
          .select('id, staff_id, start_at, end_at, note')
          .single()

    if (response.error) {
      setError(
        response.error.code === '42501'
          ? "Les permissions du calendrier ne sont pas encore à jour dans Supabase. Exécutez le script marketing-calendar-permissions.sql."
          : response.error.message
      )
    }
    else {
      const savedSlot = response.data as AvailabilitySlot
      setSlots((current) => [
        ...current.filter((slot) => slot.id !== savedSlot.id),
        savedSlot,
      ].sort((left, right) => left.start_at.localeCompare(right.start_at)))
      setForm((current) => ({ ...current, note: '' }))
      closeForm()
    }
    setSaving(false)
  }

  const removeSlot = async (slot: AvailabilitySlot) => {
    setSaving(true)
    setError('')
    const { error: deleteError } = await supabase
      .from('marketing_availability_slots')
      .delete()
      .eq('id', slot.id)
    if (deleteError) setError(deleteError.message)
    else setSlots((current) => current.filter((item) => item.id !== slot.id))
    setSaving(false)
  }

  const renderSlot = (slot: AvailabilitySlot) => (
    <div
      key={slot.id}
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onClick={(event) => {
        event.stopPropagation()
        editSlot(slot)
      }}
      onKeyDown={(event) => {
        if (canEdit && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          event.stopPropagation()
          editSlot(slot)
        }
      }}
      className={`rounded-lg border border-[#dfd0bf] bg-[#fbf1e7] p-2 text-xs outline-none ${canEdit ? 'cursor-pointer hover:border-[#c98b52] focus:ring-2 focus:ring-[#d9b591]' : ''}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="flex items-center gap-1 font-semibold text-[#5d4a3d]">
          {canEdit && <Pencil className="h-3 w-3 shrink-0" />}
          {timeFormatter.format(new Date(slot.start_at))} à {timeFormatter.format(new Date(slot.end_at))}
        </span>
        {canEdit && (
          <button
            type="button"
            disabled={saving}
            onClick={(event) => {
              event.stopPropagation()
              void removeSlot(slot)
            }}
            className="shrink-0 p-1 text-[#9b6a3d] hover:text-red-700 disabled:opacity-50"
            title="Retirer cette disponibilité"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {slot.note && <p className="mt-1 break-words text-[#8a6f5d]">{slot.note}</p>}
    </div>
  )

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-[#eadfd2] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-[#9b6a3d]" />
            <h2 className="text-xl font-semibold text-[#332820]">
              Calendrier de disponibilités
            </h2>
          </div>
          <p className="mt-2 text-sm text-[#7a6859]">
            Heures de travail planifiées de Camille pour la semaine ou le mois.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setMode('week')} className={buttonClass(mode === 'week' ? 'primary' : 'secondary')}>Semaine</button>
          <button type="button" onClick={() => setMode('month')} className={buttonClass(mode === 'month' ? 'primary' : 'secondary')}>Mois</button>
          {canEdit && (
            <button type="button" onClick={() => selectDateForEntry(new Date())} className={buttonClass('secondary')}>
              <Plus className="h-4 w-4" /> Ajouter une plage
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {showForm && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div className="w-full max-w-2xl overflow-hidden rounded-lg border-2 border-[#c98b52] bg-[#fffdf9] shadow-xl" role="dialog" aria-modal="true" aria-labelledby="availability-dialog-title">
            <div className="border-b border-[#dfd0bf] bg-[#f6eee4] px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="availability-dialog-title" className="text-lg font-semibold text-[#332820]">{editingSlot ? 'Modifier la plage de travail' : 'Ajouter une plage de travail'}</h3>
                <p className="mt-1 text-sm capitalize text-[#7a6859]">{selectedDateFormatter.format(new Date(`${form.date}T12:00`))}</p>
              </div>
              <button type="button" onClick={closeForm} className="p-2 text-[#7a6859] hover:text-[#332820]" title="Fermer"><X className="h-5 w-5" /></button>
            </div>
            </div>
            <div className="p-5">
            <p className="rounded-lg border border-[#ead2bd] bg-[#fbf6ef] px-4 py-3 text-sm text-[#6c5a4d]">
              Cette plage représente les heures de travail planifiées de Camille.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-[#5d4a3d]">Date<input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} className={`${inputClass} mt-2`} /></label>
              <label className="text-sm font-medium text-[#5d4a3d]">Note facultative<input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} className={`${inputClass} mt-2`} /></label>
              <label className="text-sm font-medium text-[#5d4a3d]">Début<input type="time" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} className={`${inputClass} mt-2`} /></label>
              <label className="text-sm font-medium text-[#5d4a3d]">Fin<input type="time" value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} className={`${inputClass} mt-2`} /></label>
            </div>
            {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={closeForm} className={buttonClass('secondary')}>Annuler</button>
              <button type="button" disabled={saving} onClick={() => void saveSlot()} className={buttonClass('primary')}>{editingSlot ? 'Enregistrer les modifications' : 'Ajouter la plage'}</button>
            </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => moveCursor(-1)} className={`${buttonClass('secondary')} w-10 px-0`} title="Période précédente"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setCursor(new Date())} className={buttonClass('secondary')}>Aujourd’hui</button>
          <button type="button" onClick={() => moveCursor(1)} className={`${buttonClass('secondary')} w-10 px-0`} title="Période suivante"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-semibold capitalize text-[#332820]">
            {mode === 'week'
              ? `${dayFormatter.format(weekStart)} au ${dayFormatter.format(addDays(weekStart, 6))}`
              : monthFormatter.format(monthStart)}
          </p>
          {mode === 'week' && (
            <Badge tone={weeklyHours >= 10 ? 'success' : 'warning'}>
              {formatHours(weeklyHours)} h sur 10 h planifiées
            </Badge>
          )}
        </div>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-[#7a6859]">Chargement du calendrier...</p>
      ) : mode === 'week' ? (
        <div className="overflow-x-auto rounded-lg border border-[#eadfd2] bg-[#fffdf9]">
          <div className="grid min-w-[980px] grid-cols-7 divide-x divide-[#eadfd2]">
            {weekDays.map((day) => {
              const daySlots = slotsByDay.get(dateKey(day)) ?? []
              const isToday = dateKey(day) === dateKey(new Date())
              return (
                <div
                  key={dateKey(day)}
                  role={canEdit ? 'button' : undefined}
                  tabIndex={canEdit ? 0 : undefined}
                  onClick={() => selectDateForEntry(day)}
                  onKeyDown={(event) => {
                    if (canEdit && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault()
                      selectDateForEntry(day)
                    }
                  }}
                  className={`min-h-64 p-3 outline-none ${canEdit ? 'cursor-pointer hover:bg-[#fbf6ef] focus:ring-2 focus:ring-inset focus:ring-[#d9b591]' : ''}`}
                >
                  <div className="w-full text-left">
                    <p className={`text-sm font-semibold capitalize ${isToday ? 'text-[#8a5633]' : 'text-[#5d4a3d]'}`}>{dayFormatter.format(day)}</p>
                    <p className="mt-1 text-xs text-[#8a6f5d]">{formatHours(daySlots.reduce((total, slot) => total + durationHours(slot), 0))} h de travail</p>
                  </div>
                  <div className="mt-4 space-y-3">{daySlots.length ? daySlots.map(renderSlot) : <p className="text-xs text-[#a08d7e]">Aucune plage</p>}</div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#eadfd2] bg-[#fffdf9]">
          <div className="grid min-w-[840px] grid-cols-7 border-b border-[#eadfd2] bg-[#f6eee4] text-xs font-semibold uppercase text-[#6c5a4d]">
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((label) => <div key={label} className="px-3 py-2">{label}</div>)}
          </div>
          <div className="grid min-w-[840px] grid-cols-7">
            {monthDays.map((day) => {
              const daySlots = slotsByDay.get(dateKey(day)) ?? []
              const inMonth = day.getMonth() === monthStart.getMonth()
              return (
                <div
                  key={dateKey(day)}
                  role={canEdit ? 'button' : undefined}
                  tabIndex={canEdit ? 0 : undefined}
                  onClick={() => selectDateForEntry(day)}
                  onKeyDown={(event) => {
                    if (canEdit && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault()
                      selectDateForEntry(day)
                    }
                  }}
                  className={`min-h-32 border-b border-r border-[#eadfd2] p-3 text-left outline-none ${canEdit ? 'cursor-pointer hover:bg-[#fbf6ef] focus:ring-2 focus:ring-inset focus:ring-[#d9b591]' : ''} ${inMonth ? 'bg-white' : 'bg-[#fbf7f1] text-[#aa998b]'}`}
                >
                  <span className="text-sm font-semibold">{day.getDate()}</span>
                  {daySlots.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {daySlots.map((slot) => (
                        <div
                          key={slot.id}
                          onClick={(event) => {
                            event.stopPropagation()
                            editSlot(slot)
                          }}
                          className={`rounded-md border border-[#dfd0bf] bg-[#fbf1e7] px-2 py-1.5 text-xs font-semibold text-[#5d4a3d] ${canEdit ? 'hover:border-[#c98b52]' : ''}`}
                        >
                          {timeFormatter.format(new Date(slot.start_at))} à {timeFormatter.format(new Date(slot.end_at))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
