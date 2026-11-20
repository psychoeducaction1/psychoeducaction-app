'use client'

import { useCallback, useState } from 'react'
import { buttonClass, Badge } from '@/components/Ui'
import { IntakeCalendar } from '@/components/intake/IntakeCalendar'
import { ProspectAppointments } from '@/components/intake/ProspectAppointments'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { useClinicalFormGuard } from '@/components/clinical-workspace/NavigationGuard'
import { clinicalInput, clinicalLabel } from '@/components/clinical-workspace/styles'
import { isClinicalAccessDenied } from '@/lib/clinical-workspace/api'
import { fetchAdmission } from '@/lib/clinical-admission/client'
import type { AdmissionProspect } from '@/lib/clinical-admission/types'
import { prospectStatusLabels } from './presentation'
import { addLocalDays, buildIntakeSlots, dateKeyInToronto, dateTimeInputValueInToronto, torontoLocalToUtc } from '@/lib/publicIntakeSchedule'
import { buildDailyProspectQueue, historyStatuses, prospectCallLabel, type IntakeAppointment } from '@/lib/prospectsWorkspace'
import { ActionForm, AdmissionHistory, Details, Fold, Pager, Search, dateTime, lines, pageRows, panelClass, priorityOptions, serviceOptions, services, text, utc, type AdmissionUi } from './shared'

function queueRows(prospects: AdmissionProspect[]) {
  return prospects.map(value => ({ ...value, status: value.status, created_at: value.receivedAt, contact_request_type: value.contactRequestType === 'rapid_callback' ? 'rapid_callback' : 'scheduled_call', rapid_callback_requested_at: value.rapidCallbackRequestedAt }))
}
function callLabel(prospect: AdmissionProspect, appointments: IntakeAppointment[] = prospect.appointments) {
  return prospectCallLabel({ contact_request_type: prospect.contactRequestType, appointments })
}
const fullDay = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'full', timeZone: 'America/Toronto' })
export function CallsPanel({ ui }: { ui: AdmissionUi }) {
  const tab = ['calendar', 'history'].includes(ui.query.get('tab') ?? '') ? ui.query.get('tab')! : 'active'
  const day = /^\d{4}-\d{2}-\d{2}$/.test(ui.query.get('day') ?? '') ? ui.query.get('day')! : dateKeyInToronto(new Date())
  const queue = buildDailyProspectQueue(queueRows(ui.data.prospects), day, new Date())
  const selected = ui.data.prospects.find(item => item.id === ui.query.get('prospect'))
  const search = (ui.query.get('recherche') ?? '').toLocaleLowerCase('fr')
  const rows = (tab === 'history' ? ui.data.prospects.filter(item => historyStatuses.has(item.status)) : queue.rows.filter(item => item.prospect.id !== queue.priority?.prospect.id).map(item => item.prospect))
    .filter(item => [item.firstName, item.lastName, ...item.emails, ...item.phones].join(' ').toLocaleLowerCase('fr').includes(search))
  const selectedRapid = selected?.contactRequestType === 'rapid_callback' && !historyStatuses.has(selected.status)
    && !selected.appointments.some(appointment => appointment.status === 'scheduled')
  const calendarFetch = useCallback(async (url: string, init?: RequestInit) => {
    try {
      if (!init?.method || init.method === 'GET') {
        const latest = await fetchAdmission({ actorId: ui.data.actorId, context: ui.data.context })
        const parsed = new URL(url, 'http://127.0.0.1:3100'), from = parsed.searchParams.get('from') ?? '', to = parsed.searchParams.get('to') ?? ''
        const appointments = latest.prospects.flatMap(prospect => prospect.appointments.map(appointment => ({ ...appointment, prospect: { first_name: prospect.firstName, last_name: prospect.lastName, phone: prospect.phones[0] ?? '', potential_duplicate: false } }))).filter(item => item.start_at >= from && item.start_at < to)
        const rapidCallbacks = latest.prospects.filter(item => item.contactRequestType === 'rapid_callback' && !historyStatuses.has(item.status) && !item.appointments.some(appointment => appointment.status === 'scheduled')).map(item => ({ id: item.id, first_name: item.firstName, last_name: item.lastName, phone: item.phones[0] ?? '', rapid_callback_requested_at: item.rapidCallbackRequestedAt ?? item.receivedAt, potential_duplicate: false }))
        return Response.json({ appointments, rapidCallbacks, blocks: latest.calendarBlocks.filter(item => item.active && item.start_at < to && item.end_at > from) })
      }
      if (init.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { startAt: string; endAt: string; reason: string }
        await ui.run('calendar.block', null, body)
      } else if (init.method === 'DELETE') {
        const id = url.split('/').at(-1), block = ui.data.calendarBlocks.find(item => item.id === id)
        if (!block) throw new Error('Blocage introuvable. Actualisez le calendrier.')
        await ui.run('calendar.unblock', block.id, { expectedVersion: block.version })
      } else throw new Error('Action de calendrier non disponible.')
      return Response.json({ success: true })
    } catch (cause) { if (isClinicalAccessDenied(cause)) ui.invalidate(cause); return Response.json({ error: cause instanceof Error ? cause.message : 'Calendrier indisponible.' }, { status: 409 }) }
  }, [ui])
  return <div className="grid gap-5">
    <div className="flex flex-wrap gap-2">{[['calendar', 'Calendrier'], ['active', 'À traiter'], ['history', 'Historique']].map(([value, label]) => <button key={value} className={buttonClass(tab === value ? 'primary' : 'secondary')} onClick={() => void ui.select({ tab: value, page: null, prospect: null })}>{label}</button>)}</div>
    <Fold title="Créer une demande d’appel fictive"><ActionForm fields={[{ name: 'firstName', label: 'Prénom fictif', required: true, maxLength: 100 }, { name: 'lastName', label: 'Nom fictif', required: true, maxLength: 100 }, { name: 'birthDate', label: 'Date de naissance', type: 'date' }, { name: 'service', label: 'Service', type: 'select', options: serviceOptions, initial: services[0] }, { name: 'consultationReason', label: 'Motif de la demande', type: 'textarea', maxLength: 1000 }, { name: 'emails', label: 'Courriels fictifs (un par ligne)', type: 'textarea' }, { name: 'phones', label: 'Téléphones fictifs (un par ligne)', type: 'textarea' }, { name: 'contactRequestType', label: 'Type de rappel', type: 'select', required: true, options: [{ value: 'rapid_callback', label: 'Rappel dès que possible' }, { value: 'appointment', label: 'Appel planifié' }], initial: 'rapid_callback' }, { name: 'startAt', label: 'Date et heure si appel planifié (Toronto)', type: 'datetime-local' }]} submitLabel="Créer l’appel fictif" reset onSubmit={async values => {
      if (values.contactRequestType === 'appointment' && !text(values.startAt)) throw new Error('Choisissez le créneau de l’appel planifié.')
      const result = await ui.run('prospects.create', null, { firstName: text(values.firstName), lastName: text(values.lastName), ...(text(values.birthDate) ? { birthDate: text(values.birthDate) } : {}), service: text(values.service), consultationReason: text(values.consultationReason), emails: lines(values.emails), phones: lines(values.phones), contactRequestType: values.contactRequestType, ...(text(values.startAt) ? { startAt: utc(values.startAt) } : {}), sourceLabel: 'Création fictive locale' })
      return () => ui.select({ prospect: result.result.id })
    }} /><p className="mt-3 text-xs">Aucun client permanent n’est créé avant le transfert. Appel de 15 minutes, créneaux de 30 minutes et deux heures de préavis.</p></Fold>
    {tab === 'calendar' ? <IntakeCalendar authenticatedFetch={calendarFetch} onSelectProspect={(id, appointment) => void ui.select({ prospect: id, appointment: appointment ?? null })} refreshVersion={ui.data.events.length} /> : <>
      {tab === 'active' && <section className={panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold capitalize">{fullDay.format(torontoLocalToUtc(day, 12, 0))}</h2><div className="flex gap-2">{[0, 1].map(offset => { const value = addLocalDays(dateKeyInToronto(new Date()), offset); return <button key={offset} type="button" aria-pressed={day === value} className={buttonClass(day === value ? 'primary' : 'secondary')} onClick={() => void ui.select({ day: value, page: null })}>{offset ? 'Demain' : 'Aujourd’hui'}</button> })}</div></div>
        {queue.priority ? <button type="button" className="mt-4 w-full rounded-xl border border-[#d8b992] bg-[#fff5e9] p-4 text-left hover:bg-[#ffefda]" onClick={() => void ui.select({ prospect: queue.priority!.prospect.id, appointment: queue.priority!.appointment?.id ?? null })}><span className="block font-semibold">{queue.priority.isRapid ? 'Rappel rapide prioritaire' : 'Prochain appel planifié'}</span><span className="mt-2 block text-lg font-semibold">{queue.priority.prospect.firstName} {queue.priority.prospect.lastName}</span><span className="mt-1 block text-sm">{queue.priority.isRapid ? 'Rappel dès que possible' : dateTime(queue.priority.appointment!.start_at)}</span><span className="mt-2 block text-sm font-semibold text-[#8a5633]">Ouvrir la fiche →</span></button> : <p className="mt-4 text-sm text-[#7a6859]">Aucun prochain appel planifié pour cette journée.</p>}
      </section>}
      <section className={panelClass}><Search ui={ui} /></section>
      <section className={panelClass}>
        <h2 className="text-lg font-semibold">{tab === 'history' ? 'Historique des prospects' : queue.priority ? 'Autres appels à traiter' : 'Appels à traiter'} ({rows.length})</h2>
        <div className="mt-4 divide-y divide-[#eadfd2]">{pageRows(rows, ui.query).map(item => { const queued = queue.rows.find(value => value.prospect.id === item.id); return <button key={item.id} type="button" className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-4 text-left hover:bg-[#fff5e9]" onClick={() => void ui.select({ prospect: item.id, appointment: tab === 'active' ? queued?.appointment?.id ?? null : null })}>
          <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{item.firstName} {item.lastName}</span><Badge tone={item.status === 'transferred_to_waiting_list' ? 'success' : item.status === 'service_not_taken' ? 'danger' : 'muted'}>{queued?.isRapid ? 'Rappel prioritaire' : prospectStatusLabels[item.status]}</Badge></span><span className="mt-1 block text-sm">{callLabel(item, tab === 'active' ? queued?.appointment ? [queued.appointment] : [] : item.appointments)}</span><span className="mt-1 block text-xs text-[#8a6f5d]">Demande reçue le {dateTime(item.receivedAt)}</span></span><span className="shrink-0 text-sm font-semibold text-[#8a5633]">Ouvrir la fiche →</span>
        </button> })}{!rows.length && <p className="py-5 text-sm">{tab === 'active' && queue.priority ? 'Aucun autre appel à traiter pour cette journée.' : 'Aucune demande dans cette vue.'}</p>}</div>
        <Pager total={rows.length} query={ui.query} select={ui.select} />
      </section>
    </>}
    {selected && <ProspectDialog title={selected.firstName + ' ' + selected.lastName} onClose={() => void ui.select({ prospect: null, appointment: null })}>
      <Badge tone="neutral">{prospectStatusLabels[selected.status]}</Badge>
      <div className="mt-4 grid gap-1 text-sm">{selected.phones.map(phone => <p key={phone}>{phone}</p>)}{selected.emails.map(email => <p key={email} className="break-all">{email}</p>)}</div>
      <p className="mt-3 text-xs text-[#8a6f5d]">Demande reçue le {dateTime(selected.receivedAt)}</p>
      {selectedRapid && <p className="mt-4 rounded-xl bg-[#fff5e9] p-3 font-semibold">Rappel dès que possible · prioritaire</p>}
      {selected.appointments.length > 0 ? selectedRapid ? <details className="mt-3"><summary className="cursor-pointer text-sm text-[#7a6859]">Anciens rendez-vous</summary><ProspectAppointments appointments={selected.appointments} appointmentId={ui.query.get('appointment') ?? undefined} /></details> : <ProspectAppointments appointments={selected.appointments} appointmentId={ui.query.get('appointment') ?? undefined} /> : !selectedRapid && <p className="mt-4 rounded-xl bg-[#fff5e9] p-4 text-sm">{callLabel(selected)}</p>}
      <div className="mt-5"><h3 className="text-sm font-semibold text-[#8a6f5d]">Motif de consultation</h3><p className="mt-1 whitespace-pre-wrap text-sm">{selected.consultationReason || 'Non précisé'}</p></div>
      {selected.outcomeDetails && <div className="mt-5 rounded-xl border border-[#eadfd2] bg-white p-4"><h3 className="text-sm font-semibold text-[#8a6f5d]">Note de suivi</h3><p className="mt-1 whitespace-pre-wrap text-sm">{selected.outcomeDetails}</p></div>}
      {selected.admissionId ? <div className="mt-5"><button className={buttonClass('secondary')} onClick={() => void ui.navigate('waiting', { admission: selected.admissionId!, tab: ui.data.admissions.find(item => item.id === selected.admissionId)?.stage === 'waiting' ? 'waiting' : 'history' })}>Ouvrir la demande transférée</button></div> : <CallOutcome key={selected.id + ':' + selected.version} prospect={selected} ui={ui} />}
      {selected.clientId && <button className={buttonClass('ghost')} onClick={() => void ui.openClient(selected.clientId!)}>Ouvrir l’identité permanente</button>}
      <details className="mt-5 border-t border-[#eadfd2] pt-4"><summary className="cursor-pointer text-sm font-semibold text-[#8a5633]">Voir tous les renseignements</summary><div className="mt-4"><Details value={selected} administrative /><p className="mt-3 text-sm"><span className="font-semibold">Source : </span>{selected.sourceLabel || 'Non précisée'}</p></div></details>
      <div className="mt-5"><AdmissionHistory ui={ui} prospectId={selected.id} /></div>
    </ProspectDialog>}
  </div>
}
function CallOutcome({ prospect, ui }: { prospect: AdmissionProspect; ui: AdmissionUi }) {
  const [outcome, setOutcome] = useState(['service_taken', 'service_not_taken', 'other'].includes(prospect.status) ? prospect.status : ''), [details, setDetails] = useState(prospect.outcomeDetails), [reason, setReason] = useState(prospect.consultationReason), [service, setService] = useState(prospect.service || services[0]), [priority, setPriority] = useState('normal'), [followup, setFollowup] = useState(false), [startAt, setStartAt] = useState(() => { const slot = buildIntakeSlots(dateKeyInToronto(new Date()), 7)[0]; return slot ? dateTimeInputValueInToronto(new Date(slot.startAt)) : '' }), [dirty, setDirty] = useState(false), [error, setError] = useState('')
  const guard = useClinicalFormGuard(dirty, ui.busy)
  return <form className="mt-5 grid gap-4 border-t pt-5" onChange={() => setDirty(true)} onSubmit={async event => {
    event.preventDefault(); guard.markPending(); setError('')
    try {
      const result = outcome === 'service_taken' ? await ui.run('prospects.transfer', prospect.id, { expectedVersion: prospect.version, priority, service, consultationReason: reason })
        : followup ? await ui.run('prospects.followup', prospect.id, { expectedVersion: prospect.version, startAt: utc(startAt), details })
          : await ui.run('prospects.outcome', prospect.id, { expectedVersion: prospect.version, outcome, details })
      guard.markSaved(); setDirty(false)
      if (outcome === 'service_taken') await ui.navigate('waiting', { admission: result.result.id, tab: 'waiting' })
      else if (!followup) await ui.select({ prospect: null, appointment: null })
    } catch (cause) { guard.markSettled(); setError(cause instanceof Error ? cause.message : 'Résultat non confirmé.') }
  }}>
    <h3 className="font-semibold">Résultat de l’appel</h3><div className="flex flex-wrap gap-2">{[['service_taken', 'Service pris'], ['service_not_taken', 'Service non pris'], ['other', 'Autre']].map(([value, label]) => <label key={value} className={buttonClass(outcome === value ? 'primary' : 'secondary')}><input type="radio" name="outcome" required checked={outcome === value} value={value} onChange={() => { setOutcome(value); setFollowup(false) }} />{label}</label>)}</div>
    {outcome === 'service_taken' ? <><label className={clinicalLabel}>Service<select className={clinicalInput} value={service} onChange={event => setService(event.target.value)}>{serviceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className={clinicalLabel}>Motif de consultation<textarea className={clinicalInput} required value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /></label><label className={clinicalLabel}>Priorité<select className={clinicalInput} value={priority} onChange={event => setPriority(event.target.value)}>{priorityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></>
      : outcome && <label className={clinicalLabel}>{outcome === 'other' ? 'Précisez la situation' : 'Motif du service non pris'}<textarea className={clinicalInput} required value={details} maxLength={1000} onChange={event => setDetails(event.target.value)} /></label>}
    {outcome === 'other' && <>{!followup && <button type="button" className={buttonClass('secondary')} disabled={!details.trim() || ui.busy} onClick={() => setFollowup(true)}>Créer un autre rendez-vous avec ce client</button>}{followup && <div className="rounded-xl border border-[#d8b992] bg-[#fff8ef] p-4"><h4 className="font-semibold">Nouveau rendez-vous avec ce client</h4><p className="mt-1 text-sm text-[#7a6859]">La précision et le nouveau rendez-vous seront enregistrés ensemble sur cette fiche.</p><label className={`${clinicalLabel} mt-3`}>Date et heure (Toronto)<input type="datetime-local" className={clinicalInput} required value={startAt} onChange={event => setStartAt(event.target.value)} /></label><p className="mt-2 text-xs text-[#8a6f5d]">Appel de 15 minutes. Créneaux aux 30 minutes, avec au moins deux heures de préavis.</p><button type="button" className={buttonClass('secondary')} disabled={ui.busy} onClick={() => setFollowup(false)}>Annuler le nouveau rendez-vous</button></div>}</>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}<button className={buttonClass('primary')} disabled={ui.busy || !outcome}>{outcome === 'service_taken' ? 'Ajouter à la liste d’attente' : followup ? 'Enregistrer et créer le nouveau rendez-vous' : 'Enregistrer le résultat'}</button>
  </form>
}
