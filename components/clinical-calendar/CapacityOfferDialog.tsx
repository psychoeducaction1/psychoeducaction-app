'use client'

import { useEffect, useMemo, useState, type PointerEvent } from 'react'
import { buttonClass } from '@/components/Ui'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { submitCapacityOffer } from '@/lib/clinical-unification/capacityClient'
import type { ClinicalActorInput } from '@/lib/clinical-core/types'
import { loadCalendar } from '@/lib/clinical-calendar/durableClient'
import type { DurableCalendarEvent } from '@/lib/clinical-calendar/durableTypes'
import { calendarWeekday, localDateTime, shiftCalendarDate } from '@/lib/clinical-calendar/time'
import { capacityNoticeMessage, meetsCapacityNotice } from '@/lib/clinical-calendar/capacityNotice'

type OfferSlot = { day: string; startMinute: number; endMinute: number }
type Preference = 'grouped' | 'spread' | 'flexible' | 'other'
const preferences: { value: Preference; label: string }[] = [
  { value: 'grouped', label: 'Plages collées, sur les mêmes journées si possible' },
  { value: 'spread', label: 'Rencontres séparées, réparties sur plusieurs jours' },
  { value: 'flexible', label: 'Aucune préférence' },
  { value: 'other', label: 'Autre commentaire' },
]
const startOfWeek = (day: string) => shiftCalendarDate(day, 1 - calendarWeekday(day))
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')} h ${String(minute % 60).padStart(2, '0')}`
const slotKey = (slot: OfferSlot) => `${slot.day}:${slot.startMinute}:${slot.endMinute}`
const overlaps = (a: OfferSlot, b: OfferSlot) => a.day === b.day && a.startMinute < b.endMinute && b.startMinute < a.endMinute
const eventOverlaps = (slot: OfferSlot, event: DurableCalendarEvent) => event.status !== 'cancelled'
  && `${slot.day}T${String(Math.floor(slot.startMinute / 60)).padStart(2, '0')}:00` < localDateTime(event.endAt)
  && localDateTime(event.startAt) < `${slot.day}T${String(Math.floor(slot.endMinute / 60)).padStart(2, '0')}:00`

export function CapacityOfferDialog({ actor, initialDay, onClose, onSaved }: { actor: ClinicalActorInput; initialDay: string; onClose: () => void; onSaved: (clients: number) => void }) {
  const [now, setNow] = useState(Date.now)
  const today = localDateTime(new Date(now)).slice(0, 10)
  const lastDay = shiftCalendarDate(today, 180)
  const [week, setWeek] = useState(startOfWeek(initialDay < today || initialDay > lastDay ? today : initialDay))
  const [dragMode, setDragMode] = useState<'add' | 'remove' | null>(null)
  const [slots, setSlots] = useState<OfferSlot[]>([])
  const [events, setEvents] = useState<DurableCalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailure, setLoadFailure] = useState(false)
  const [step, setStep] = useState<'selection' | 'review'>('selection')
  const [requestedCount, setRequestedCount] = useState(1)
  const [preference, setPreference] = useState<Preference>('flexible')
  const [comment, setComment] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftCalendarDate(week, index)), [week])
  const offeredHours = slots.reduce((sum, slot) => sum + (slot.endMinute - slot.startMinute) / 60, 0)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setLoadFailure(false); setError('')
    void loadCalendar(week, shiftCalendarDate(week, 6), actor, controller.signal).then(result => {
      if (!controller.signal.aborted) setEvents(result.appointments)
    }).catch(cause => {
      if (!controller.signal.aborted) { setEvents([]); setLoadFailure(true); setError(cause instanceof Error ? cause.message : 'Le calendrier ne peut pas être vérifié.') }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [actor, week])
  useEffect(() => {
    const stop = () => setDragMode(null)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => { window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop) }
  }, [])
  const close = () => {
    if (pending) return
    if (slots.length && !window.confirm('Abandonner les plages sélectionnées sans envoyer la demande ?')) return
    onClose()
  }
  const choose = (day: string, startMinute: number, mode: 'add' | 'remove') => {
    if (loading || loadFailure || pending || day < today || day > lastDay) return
    if (mode === 'add' && !meetsCapacityNotice(day, startMinute, Date.now())) { setError(capacityNoticeMessage); return }
    const candidate = { day, startMinute, endMinute: startMinute + 60 }
    if (candidate.endMinute > 22 * 60) return
    if (events.some(event => eventOverlaps(candidate, event))) { setError('Cette plage chevauche une activité du calendrier. Choisissez une autre plage.'); return }
    if (mode === 'add' && slots.length >= 60) { setError('La demande est limitée à 60 plages.'); return }
    setError('')
    setSlots(current => {
      const same = current.some(slot => slotKey(slot) === slotKey(candidate))
      if (mode === 'remove') return current.filter(slot => slotKey(slot) !== slotKey(candidate))
      if (same) return current
      if (current.length >= 60) return current
      if (current.some(slot => overlaps(slot, candidate))) return current
      return [...current, candidate].sort((a, b) => slotKey(a).localeCompare(slotKey(b)))
    })
  }
  const beginDrag = (event: PointerEvent<HTMLButtonElement>, day: string, minute: number, chosen: boolean) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const mode = chosen ? 'remove' : 'add'
    setDragMode(mode)
    choose(day, minute, mode)
  }
  const extendDrag = (day: string, minute: number) => {
    if (dragMode) choose(day, minute, dragMode)
  }
  const send = async () => {
    if (pending) return
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > offeredHours) { setError('Le nombre de clients doit être compris entre 1 et le nombre d’heures offertes.'); return }
    if (preference === 'other' && !comment.trim()) { setError('Écrivez votre préférence dans le commentaire.'); return }
    // Keep the idempotent server replay possible after a response is lost.
    setPending(true); setError('')
    try {
      await submitCapacityOffer(actor, { requestedCount, offerSlots: slots, schedulePreference: preference, comment: preference === 'other' ? comment.trim() : '' })
      onSaved(requestedCount)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'La demande n’a pas pu être confirmée. Conservez votre sélection.') }
    finally { setPending(false) }
  }
  return <ProspectDialog compactHeader title="Proposer mes dispos" onClose={close}>
    <div className="grid gap-4 text-sm">
      <p>Offrez des plages pour de nouveaux clients. Chaque client demandé correspond à un premier rendez-vous d’une heure. Les plages proposées ne réservent pas votre calendrier.</p>
      {step === 'selection' ? <>
        <div className="flex flex-wrap items-center gap-2"><button type="button" className={buttonClass('secondary')} disabled={loading || week <= startOfWeek(today)} onClick={() => setWeek(shiftCalendarDate(week, -7))}>Semaine précédente</button><strong>{days[0]} au {days[6]}</strong><button type="button" className={buttonClass('secondary')} disabled={loading || days[6] >= lastDay} onClick={() => setWeek(shiftCalendarDate(week, 7))}>Semaine suivante</button></div>
        <p>Chaque plage dure une heure. {capacityNoticeMessage}</p>
        <div className="overflow-x-auto rounded-xl border border-[#eadfd2]"><div className="grid min-w-[650px] grid-cols-7 gap-1 p-2 select-none">{days.map(day => <div key={day} className="text-center font-semibold">{new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(day + 'T12:00Z'))}</div>)}{Array.from({ length: 14 }, (_, index) => index + 8).flatMap(hour => days.map(day => {
          const candidate = { day, startMinute: hour * 60, endMinute: (hour + 1) * 60 }
          const chosen = slots.some(slot => slotKey(slot) === slotKey(candidate))
          const occupied = events.some(event => eventOverlaps(candidate, event))
          const disabled = loading || loadFailure || pending || day < today || day > lastDay || candidate.endMinute > 22 * 60 || !chosen && (occupied || !meetsCapacityNotice(day, candidate.startMinute, now))
          return <button key={`${day}:${hour}`} type="button" aria-pressed={chosen} disabled={disabled}
            onPointerDown={event => beginDrag(event, day, hour * 60, chosen)}
            onPointerEnter={() => extendDrag(day, hour * 60)}
            onClick={event => { if (event.detail === 0) choose(day, hour * 60, chosen ? 'remove' : 'add') }}
            className={'rounded border px-1 py-2 text-xs focus-visible:outline-2 ' + (chosen ? 'border-[#6b7c4a] bg-[#e8f1d7] font-semibold' : 'border-[#eadfd2] bg-white hover:bg-[#f8ead7]') + (disabled ? ' opacity-40' : '')} title={occupied ? 'Une activité existe déjà sur cette plage' : `${clock(hour * 60)} à ${clock(candidate.endMinute)}`}>{clock(hour * 60)}{chosen ? ' ✓' : ''}</button>
        }))}</div></div>
        <p>{slots.length} plage{slots.length > 1 ? 's' : ''} sélectionnée{slots.length > 1 ? 's' : ''} · {offeredHours} heure{offeredHours > 1 ? 's' : ''} possible{offeredHours > 1 ? 's' : ''} pour les premiers rendez-vous</p>
        <button type="button" className={buttonClass('primary')} disabled={!slots.length || loading || loadFailure || pending} onClick={() => { setRequestedCount(Math.min(requestedCount, offeredHours)); setStep('review'); setError('') }}>Continuer</button>
      </> : <>
        <h3 className="font-semibold">Vérifier la demande</h3><p>{slots.length} plage{slots.length > 1 ? 's' : ''} · {offeredHours} heure{offeredHours > 1 ? 's' : ''} offertes</p>
        <label className="grid gap-1 font-medium">Combien de nouveaux clients souhaitez-vous que la clinique vous assigne ?<input type="number" min={1} max={offeredHours} step={1} value={requestedCount} onChange={event => setRequestedCount(Number(event.target.value))} className="rounded-lg border border-[#d8c5b4] p-2" /></label>
        <label className="grid gap-1 font-medium">Préférence pour les assignations<select value={preference} onChange={event => setPreference(event.target.value as Preference)} className="rounded-lg border border-[#d8c5b4] bg-white p-2">{preferences.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {preference === 'other' && <label className="grid gap-1 font-medium">Votre commentaire<textarea rows={3} maxLength={300} value={comment} onChange={event => setComment(event.target.value)} className="rounded-lg border border-[#d8c5b4] p-2" placeholder="Précisez comment répartir les rencontres ou les modalités de rencontre souhaitées." /></label>}
        <p className="text-[#765e49]">La direction verra ces plages et votre préférence. Elle confirmera les assignations; les rendez-vous seront fixés séparément.</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass('secondary')} disabled={pending} onClick={() => { setStep('selection'); setError('') }}>Modifier les plages</button><button type="button" className={buttonClass('primary')} disabled={pending || requestedCount < 1 || requestedCount > offeredHours} onClick={() => void send()}>{pending ? 'Envoi…' : 'Envoyer à la clinique'}</button></div>
      </>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    </div>
  </ProspectDialog>
}
