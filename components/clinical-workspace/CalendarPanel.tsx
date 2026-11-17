'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { canAdmin } from '@/lib/clinical-core/capabilities'
import type { ClinicalAccessContext } from '@/lib/clinical-core/types'
import { Building2, Camera, ChevronLeft, ChevronRight, Home, Phone, Plus, RefreshCw } from 'lucide-react'
import type { AppointmentModality, CalendarAppointmentView, CalendarWorkspace } from '@/lib/clinical-calendar/types'
import { calendarWeekday, localDateTime, shiftCalendarDate, validCalendarDate } from '@/lib/clinical-calendar/time'

const field = 'w-full rounded-lg border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820]'
const button = 'rounded-lg border border-[#dfd0bf] bg-white px-3 py-2 text-sm font-medium text-[#5d4a3d] disabled:cursor-not-allowed disabled:opacity-50'
const primary = `${button} !border-[#8a5633] !bg-[#8a5633] !text-white`
const modalities: Record<AppointmentModality, string> = { office: 'Au bureau', home: 'À domicile', phone: 'Téléphone', video: 'Visioconférence' }
const statusLabels = { planned: 'Planifié', completed: 'Rencontre effectuée', cancelled: 'Annulé', no_show: 'Absence' }
const weekdays = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const clock = (value: string) => localDateTime(value).slice(11)
const minutesLabel = (value: number) => `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, '0')}`
function freshForm(date: string) {
  return { caseId: '', professionalId: '', startLocal: `${date}T09:00`, hours: '1', minutes: '0', modality: 'office' as AppointmentModality,
    officeId: '', travelBefore: '0', travelAfter: '0', repeat: false, count: '3', disambiguation: '' as '' | 'earlier' | 'later' }
}

export function CalendarPanel({ actorId, context }: { actorId: string; context: ClinicalAccessContext }) {
  const actorRef = useRef(actorId)
  useEffect(() => { actorRef.current = actorId }, [actorId])
  const [date, setDate] = useState('2026-10-19')
  const [view, setView] = useState<'day' | 'week'>('week')
  const [workspace, setWorkspace] = useState<CalendarWorkspace | null>(null)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [professionalFilter, setProfessionalFilter] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const [form, setForm] = useState(() => freshForm(date))
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CalendarAppointmentView | null>(null)
  const [cancelling, setCancelling] = useState<CalendarAppointmentView | null>(null)
  const [cancelReason, setCancelReason] = useState<'client' | 'professional' | 'clinic'>('client')
  const [cancelFuture, setCancelFuture] = useState(false)
  const [availabilityProfessional, setAvailabilityProfessional] = useState('')
  const [availabilityDay, setAvailabilityDay] = useState('1')
  const [availabilityStart, setAvailabilityStart] = useState('08:00')
  const [availabilityEnd, setAvailabilityEnd] = useState('18:00')
  const from = validCalendarDate(date) ? view === 'week' ? shiftCalendarDate(date, 1 - calendarWeekday(date)) : date : ''
  const to = from ? view === 'week' ? shiftCalendarDate(from, 6) : from : ''

  useEffect(() => {
    const controller = new AbortController()
    setWorkspace(null); setError(''); setShowForm(false); setCancelling(null); setEditing(null)
    if (!from || !to) { setError('Choisissez une date valide.'); return }
    void fetch(`/api/clinical-calendar?from=${from}&to=${to}`, { headers: { 'X-Clinical-Fixture-Actor': actorId, 'X-Clinical-Context': context }, cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? 'Le calendrier ne peut pas être chargé.')
        if (controller.signal.aborted || actorRef.current !== actorId) return
        const next = body.workspace as CalendarWorkspace
        setWorkspace(next)
        setClientFilter(value => next.clients.some(client => client.clientId === value) || next.appointments.some(appointment => appointment.clientId === value) ? value : '')
        const preferred = !canAdmin(next.actor) ? actorId : next.professionals[0]?.id ?? ''
        setForm(current => ({ ...freshForm(date), professionalId: current.professionalId && next.professionals.some(value => value.id === current.professionalId) ? current.professionalId : preferred,
          officeId: next.offices.find(value => value.active)?.id ?? '' }))
        setAvailabilityProfessional(preferred)
      }).catch(caught => { if (!controller.signal.aborted && actorRef.current === actorId) setError(caught instanceof Error ? caught.message : 'Chargement impossible.') })
    return () => controller.abort()
  }, [actorId, context, from, to, revision, date])

  useEffect(() => { setProfessionalFilter(''); setClientFilter(''); setMessage(''); setPending(false) }, [actorId])
  const current = workspace?.actor.id === actorId ? workspace : null
  const administrative = Boolean(current && canAdmin(current.actor))
  const professionals = current?.professionals.filter(value => administrative || value.id === actorId) ?? []
  const choices = current?.clients.filter(value => value.professionalIds.includes(form.professionalId)) ?? []
  const clientOptions = [...new Map([...(current?.clients.map(value => [value.clientId, value.name] as const) ?? []),
    ...(current?.appointments.map(value => [value.clientId, value.clientName] as const) ?? [])]).entries()]
  const days = useMemo(() => from ? Array.from({ length: view === 'week' ? 7 : 1 }, (_, index) => shiftCalendarDate(from, index)) : [], [from, view])

  async function mutate(command: unknown, success: string) {
    const capturedActor = actorId
    setPending(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/clinical-calendar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clinical-Fixture-Actor': capturedActor, 'X-Clinical-Context': context }, body: JSON.stringify(command) })
      const body = await response.json()
      if (actorRef.current !== capturedActor) return
      if (!response.ok) throw new Error(body.error ?? 'Cette opération n’a pas pu être effectuée.')
      setMessage(success); setRevision(value => value + 1)
    } catch (caught) { if (actorRef.current === capturedActor) setError(caught instanceof Error ? caught.message : 'Opération impossible.') }
    finally { if (actorRef.current === capturedActor) setPending(false) }
  }
  function openForm(appointment?: CalendarAppointmentView) {
    setEditing(appointment ?? null); setCancelling(null); setError('')
    if (appointment) {
      const minutes = (Date.parse(appointment.endAt) - Date.parse(appointment.startAt)) / 60_000
      setForm({ ...freshForm(date), caseId: appointment.caseId, professionalId: appointment.professionalId, startLocal: localDateTime(appointment.startAt),
        hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60), modality: appointment.modality, officeId: appointment.officeId ?? '',
        travelBefore: String(appointment.travelBeforeMinutes), travelAfter: String(appointment.travelAfterMinutes) })
    } else {
      const professionalId = professionalFilter && professionals.some(value => value.id === professionalFilter) ? professionalFilter : professionals[0]?.id ?? ''
      setForm({ ...freshForm(date), professionalId, officeId: current?.offices.find(value => value.active)?.id ?? '' })
    }
    setShowForm(true)
  }
  function submitAppointment() {
    const input = { startLocal: form.startLocal, durationMinutes: Number(form.hours) * 60 + Number(form.minutes), modality: form.modality,
      officeId: form.modality === 'office' ? form.officeId : null, travelBeforeMinutes: Number(form.travelBefore), travelAfterMinutes: Number(form.travelAfter),
      ...(form.disambiguation ? { disambiguation: form.disambiguation } : {}) }
    if (editing) void mutate({ action: 'reschedule', appointmentId: editing.id, input: { ...input, expectedVersion: editing.version } }, 'Le rendez-vous a été déplacé dans le calendrier fictif.')
    else void mutate({ action: 'create', input: { ...input, caseId: form.caseId, professionalId: form.professionalId,
      ...(form.repeat ? { recurrence: { frequency: 'weekly', count: Number(form.count) } } : {}) } }, form.repeat ? 'La série fictive a été créée intégralement.' : 'Le rendez-vous fictif a été créé.')
  }
  const availability = current?.availability.filter(value => value.professionalId === availabilityProfessional) ?? []
  const noIds = (value: typeof availability[number]) => ({ weekday: value.weekday, startMinute: value.startMinute, endMinute: value.endMinute, validFrom: value.validFrom, validTo: value.validTo })

  return <section className="space-y-5 text-[#332820]">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-2xl font-semibold">Agenda et bureaux</h2><p className="mt-1 text-sm text-[#7a6859]">Heures de Montréal · rencontres fictives · aucun rappel envoyé</p></div>
      <div className="flex gap-2"><button className={button} onClick={() => setRevision(value => value + 1)} disabled={pending} aria-label="Actualiser le calendrier"><RefreshCw className="h-4 w-4" /></button><button className={primary} disabled={!current || pending} onClick={() => openForm()}><Plus className="mr-1 inline h-4 w-4" />Rendez-vous</button></div>
    </div>
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#eadfd2] bg-white p-4">
      <div className="flex gap-1"><button className={button} aria-label="Période précédente" onClick={() => setDate(shiftCalendarDate(date, view === 'week' ? -7 : -1))} disabled={!from}><ChevronLeft className="h-4 w-4" /></button><button className={button} aria-label="Période suivante" onClick={() => setDate(shiftCalendarDate(date, view === 'week' ? 7 : 1))} disabled={!from}><ChevronRight className="h-4 w-4" /></button></div>
      <label className="text-sm">Date<input type="date" className={field} value={date} onChange={event => setDate(event.target.value)} /></label>
      <label className="text-sm">Vue<select className={field} value={view} onChange={event => setView(event.target.value as 'day' | 'week')}><option value="week">Semaine</option><option value="day">Jour</option></select></label>
      <label className="min-w-48 flex-1 text-sm">Agenda<select className={field} value={professionalFilter} onChange={event => setProfessionalFilter(event.target.value)}><option value="">Tous les agendas</option>{current?.professionals.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <label className="min-w-48 flex-1 text-sm">Client<select className={field} value={clientFilter} onChange={event => setClientFilter(event.target.value)}><option value="">Tous les clients autorisés</option>{clientOptions.map(([id, name]) => <option key={id} value={id}>{name} · {id.slice(-4)}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showCancelled} onChange={event => setShowCancelled(event.target.checked)} />Voir les annulations</label>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">{message}</p>}
    {!current && !error && <p className="text-sm text-[#7a6859]">Chargement du calendrier…</p>}
    {current && <>
      <div className="flex flex-wrap gap-3 text-sm">{current.offices.map(office => <span key={office.id} className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: office.color }} />{office.name}</span>)}</div>
      {showForm && <form className="rounded-xl border border-[#eadfd2] bg-[#fffaf3] p-5" onSubmit={event => { event.preventDefault(); submitAppointment() }}>
        <h3 className="mb-4 text-lg font-semibold">{editing ? 'Déplacer cette rencontre' : 'Planifier une rencontre fictive'}</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm">Professionnel<select required className={field} disabled={Boolean(editing)} value={form.professionalId} onChange={event => setForm({ ...form, professionalId: event.target.value, caseId: '' })}>{professionals.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
          <label className="text-sm">Client et dossier autorisé<select required className={field} disabled={Boolean(editing)} value={form.caseId} onChange={event => setForm({ ...form, caseId: event.target.value })}><option value="">Choisir un dossier</option>{choices.map(value => <option key={value.caseId} value={value.caseId}>{value.name} · {value.caseId.slice(-4)}</option>)}</select></label>
          <label className="text-sm">Début à Montréal<input required className={field} type="datetime-local" value={form.startLocal} onChange={event => setForm({ ...form, startLocal: event.target.value })} /></label>
          <fieldset className="text-sm"><legend>Durée</legend><div className="flex items-center gap-2"><input aria-label="Durée en heures" type="number" min="0" max="12" required className={field} value={form.hours} onChange={event => setForm({ ...form, hours: event.target.value })} /><span>h</span><input aria-label="Durée en minutes" type="number" min="0" max="59" required className={field} value={form.minutes} onChange={event => setForm({ ...form, minutes: event.target.value })} /><span>min</span></div></fieldset>
          <label className="text-sm">Modalité<select className={field} value={form.modality} onChange={event => setForm({ ...form, modality: event.target.value as AppointmentModality })}>{Object.entries(modalities).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {form.modality === 'office' && <label className="text-sm">Bureau partagé<select required className={field} value={form.officeId} onChange={event => setForm({ ...form, officeId: event.target.value })}>{current.offices.filter(value => value.active).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>}
          <label className="text-sm">Déplacement avant, en minutes<input type="number" min="0" max="180" className={field} value={form.travelBefore} onChange={event => setForm({ ...form, travelBefore: event.target.value })} /></label>
          <label className="text-sm">Déplacement après, en minutes<input type="number" min="0" max="180" className={field} value={form.travelAfter} onChange={event => setForm({ ...form, travelAfter: event.target.value })} /></label>
          {!editing && <div className="text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={form.repeat} onChange={event => setForm({ ...form, repeat: event.target.checked })} />Répéter chaque semaine</label>{form.repeat && <label className="mt-2 block">Nombre total de rencontres<input type="number" min="2" max="12" className={field} value={form.count} onChange={event => setForm({ ...form, count: event.target.value })} /></label>}</div>}
        </div>
        <details className="mt-4 text-sm"><summary className="cursor-pointer">Si l’heure se répète lors du changement d’heure</summary><select aria-label="Occurrence lors du changement d’heure" className={`${field} mt-2 max-w-sm`} value={form.disambiguation} onChange={event => setForm({ ...form, disambiguation: event.target.value as typeof form.disambiguation })}><option value="">Demander une précision si nécessaire</option><option value="earlier">Première occurrence</option><option value="later">Deuxième occurrence</option></select></details>
        <p className="mt-4 text-sm text-[#7a6859]">Toute la série sera refusée si un seul créneau est occupé. Les déplacements réservent du temps dans l’agenda du professionnel.</p>
        <div className="mt-4 flex gap-2"><button type="submit" className={primary} disabled={pending || !choices.length}>{pending ? 'Vérification…' : editing ? 'Déplacer' : 'Créer'}</button><button type="button" className={button} onClick={() => setShowForm(false)}>Fermer</button></div>
        {!choices.length && <p className="mt-3 text-sm">Aucun dossier ouvert n’est autorisé pour ce professionnel. L’administration doit d’abord créer le dossier et ses accès.</p>}
      </form>}
      {cancelling && <section className="rounded-xl border border-red-200 bg-red-50 p-4"><h3 className="font-semibold">Annuler la rencontre de {cancelling.clientName}</h3><p className="mt-1 text-sm">Le rendez-vous restera dans l’historique.</p><div className="mt-3 flex flex-wrap items-center gap-3"><select aria-label="Origine de l’annulation" className={`${field} !w-auto`} value={cancelReason} onChange={event => setCancelReason(event.target.value as typeof cancelReason)}><option value="client">À la demande du client</option><option value="professional">À la demande du professionnel</option><option value="clinic">À la demande de la clinique</option></select>{cancelling.seriesId && <label className="text-sm"><input type="checkbox" checked={cancelFuture} onChange={event => setCancelFuture(event.target.checked)} /> Cette occurrence et les suivantes</label>}<button className={primary} disabled={pending} onClick={() => void mutate({ action: 'cancel', appointmentId: cancelling.id, input: { expectedVersion: cancelling.version, reason: cancelReason, scope: cancelFuture ? 'future' : 'one' } }, 'Annulation conservée dans l’historique fictif.')}>Confirmer l’annulation</button><button className={button} onClick={() => setCancelling(null)}>Garder le rendez-vous</button></div></section>}
      <div className={`grid gap-3 ${view === 'week' ? 'md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-7' : ''}`}>
        {days.map(day => {
          const rows = current.appointments.filter(value => localDateTime(value.startAt).slice(0, 10) === day && (!professionalFilter || value.professionalId === professionalFilter) && (!clientFilter || value.clientId === clientFilter) && (showCancelled || value.status !== 'cancelled')).sort((a, b) => a.startAt.localeCompare(b.startAt))
          const busy = current.busy.filter(value => value.resource === 'professional' && localDateTime(value.startAt).slice(0, 10) === day && (!professionalFilter || value.professionalId === professionalFilter))
          return <section key={day} className="min-w-0 rounded-xl border border-[#eadfd2] bg-[#fffdf9] p-3"><h3 className="mb-3 font-semibold">{new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))}</h3><div className="space-y-3">{rows.map(appointment => {
            const office = current.offices.find(value => value.id === appointment.officeId)
            const Icon = { office: Building2, home: Home, phone: Phone, video: Camera }[appointment.modality]
            return <article key={appointment.id} className={`rounded-lg border border-[#eadfd2] border-l-4 bg-white p-3 ${appointment.status === 'cancelled' ? 'opacity-60' : ''}`} style={{ borderLeftColor: office?.color ?? '#64748b' }}>
              <p className="font-semibold">{clock(appointment.startAt)}–{clock(appointment.endAt)}</p><p className="mt-1 break-words font-medium">{appointment.clientName}</p><p className="mt-1 text-xs text-[#7a6859]">{current.professionals.find(value => value.id === appointment.professionalId)?.name}</p><p className="mt-2 flex items-center gap-1 text-xs"><Icon className="h-3.5 w-3.5 shrink-0" />{modalities[appointment.modality]}</p><p className="mt-1 text-xs">{statusLabels[appointment.status]}{appointment.seriesId ? ' · série' : ''}</p>{(appointment.travelBeforeMinutes > 0 || appointment.travelAfterMinutes > 0) && <p className="mt-1 text-xs text-[#7a6859]">Déplacements : {appointment.travelBeforeMinutes} min avant / {appointment.travelAfterMinutes} min après</p>}
              {appointment.canManage && <div className="mt-3 flex flex-wrap gap-2 text-xs"><button className="underline" disabled={pending} onClick={() => openForm(appointment)}>Déplacer</button><button className="text-red-800 underline" disabled={pending} onClick={() => { setCancelling(appointment); setCancelFuture(false); setShowForm(false) }}>Annuler</button>{Date.parse(appointment.startAt) <= Date.parse(current.currentTime) && <><button className="underline" disabled={pending} onClick={() => void mutate({ action: 'outcome', appointmentId: appointment.id, input: { expectedVersion: appointment.version, status: 'completed' } }, 'Rencontre marquée effectuée.')}>Effectuée</button><button className="underline" disabled={pending} onClick={() => void mutate({ action: 'outcome', appointmentId: appointment.id, input: { expectedVersion: appointment.version, status: 'no_show' } }, 'Absence enregistrée.')}>Absence</button></>}</div>}
            </article>
          })}{busy.map((value, index) => <article key={index} className="rounded-lg border border-slate-200 bg-slate-100 p-3 text-sm text-slate-700"><p className="font-medium">{clock(value.startAt)}–{clock(value.endAt)}</p><p>Occupé</p><p className="mt-1 text-xs">{current.professionals.find(professional => professional.id === value.professionalId)?.name}</p></article>)}{!rows.length && !busy.length && <p className="py-4 text-center text-xs text-[#8a7a6e]">Aucune rencontre</p>}</div></section>
        })}
      </div>
      <details className="rounded-xl border border-[#eadfd2] bg-white p-4"><summary className="cursor-pointer font-semibold">Disponibilités du professionnel</summary><div className="mt-4 grid gap-3 sm:grid-cols-4"><label className="text-sm">Professionnel<select className={field} value={availabilityProfessional} onChange={event => setAvailabilityProfessional(event.target.value)}>{professionals.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label><label className="text-sm">Jour<select className={field} value={availabilityDay} onChange={event => setAvailabilityDay(event.target.value)}>{weekdays.map((value, index) => <option key={value} value={index + 1}>{value}</option>)}</select></label><label className="text-sm">Début<input type="time" className={field} value={availabilityStart} onChange={event => setAvailabilityStart(event.target.value)} /></label><label className="text-sm">Fin<input type="time" className={field} value={availabilityEnd} onChange={event => setAvailabilityEnd(event.target.value)} /></label></div><button className={`${button} mt-3`} disabled={pending} onClick={() => { const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)); void mutate({ action: 'availability', professionalId: availabilityProfessional, expectedRevision: current.availabilityRevisions[availabilityProfessional] ?? 0, input: [...availability.map(noIds), { weekday: Number(availabilityDay), startMinute: minute(availabilityStart), endMinute: minute(availabilityEnd), validFrom: date, validTo: null }] }, 'Disponibilité fictive ajoutée.') }}>Ajouter cette disponibilité à partir du {date}</button><ul className="mt-3 divide-y text-sm">{availability.map(value => <li key={value.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{weekdays[value.weekday - 1]} · {minutesLabel(value.startMinute)}–{minutesLabel(value.endMinute)} · depuis {value.validFrom}</span><button className="text-red-800 underline" disabled={pending} onClick={() => void mutate({ action: 'availability', professionalId: availabilityProfessional, expectedRevision: current.availabilityRevisions[availabilityProfessional] ?? 0, input: availability.filter(item => item.id !== value.id).map(noIds) }, 'Disponibilité retirée sans déplacer les rendez-vous existants.')}>Retirer</button></li>)}</ul><p className="mt-2 text-xs text-[#7a6859]">Ces plages sont facultatives et ne bloquent pas la création des rencontres.</p></details>
      <details className="rounded-xl border border-[#eadfd2] bg-white p-4"><summary className="cursor-pointer font-semibold">Occupation des bureaux partagés</summary><p className="mt-2 text-sm text-[#7a6859]">Les dossiers des collègues restent masqués. Seules les plages occupées sont partagées.</p><ul className="mt-3 space-y-2 text-sm">{current.busy.filter(value => value.resource === 'office').map((value, index) => <li key={index}>{current.offices.find(office => office.id === value.officeId)?.name} · {localDateTime(value.startAt).replace('T', ' ')}–{clock(value.endAt)} · Occupé</li>)}{!current.busy.some(value => value.resource === 'office') && <li>Aucune autre occupation masquée sur cette période.</li>}</ul></details>
    </>}
  </section>
}

export default CalendarPanel
