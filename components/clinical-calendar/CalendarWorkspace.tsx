'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { canAdmin } from '@/lib/clinical-core/capabilities'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import type { CalendarCommand, CalendarCommandAck, CalendarEventKind, DurableCalendarWorkspace } from '@/lib/clinical-calendar/durableTypes'
import { loadCalendar, runCalendarCommand } from '@/lib/clinical-calendar/durableClient'
import { localDateTime, shiftCalendarDate, validCalendarDate } from '@/lib/clinical-calendar/time'
import { isClinicalAccessDenied } from '@/lib/clinical-workspace/api'
import { workspaceHref, type WorkspaceSection } from '@/lib/clinical-workspace/navigation'
import { useClinicalFormGuard, useClinicalNavigation } from '@/components/clinical-workspace/NavigationGuard'
import { clinicalCard } from '@/components/clinical-workspace/styles'
import { AppointmentEditor, type NewCalendarSlot } from './AppointmentEditor'
import { MonthGrid, TimeGrid, type CalendarColumn } from './CalendarGrids'
import { EventDetail } from './EventDetail'
import { ActivityInvoiceDialog } from './ActivityInvoiceDialog'
import { OfficeCalendarGrid } from './OfficeCalendarGrid'
import { CalendarDateNavigation } from './CalendarNavigation'
import { CapacityOfferDialog } from './CapacityOfferDialog'
import { officeDisplayColors, officeOccupations, officeReservationProfessional } from './officeModel'
import { Field, inputClass, type CalendarUi, type CalendarFormHandle } from './primitives'
import { calendarClientName, calendarSavedFocusPatch, confirmCalendarWrite, filterCalendarEvents, frenchDay, periodFor, refreshBeforeCalendarLink, shiftMonth, primaryActivityColors, type CalendarDisplayScope, type CalendarView } from './model'

export type CalendarWorkspaceProps = { workspace: WorkspaceView; onNavigate: (section: WorkspaceSection, query?: Record<string, string | null>) => Promise<void>; onUpdated: () => Promise<void>; embeddedClientId?: string; embeddedProfessionalId?: string; officesOnly?: boolean }
export function OfficeCalendarWorkspace(props: Omit<CalendarWorkspaceProps, 'embeddedClientId' | 'officesOnly'>) { return <CalendarWorkspace {...props} officesOnly /> }
export function CalendarWorkspace({ workspace, onNavigate, onUpdated, embeddedClientId, embeddedProfessionalId, officesOnly: dedicatedOffices = false }: CalendarWorkspaceProps) {
  const params = useSearchParams(), query = useMemo(() => new URLSearchParams(params.toString()), [params])
  const officesOnly = !embeddedClientId && !embeddedProfessionalId && (dedicatedOffices || query.get('scope') === 'offices')
  const simpleProfessional = Boolean(embeddedProfessionalId)
  const actor = useMemo(() => ({ actorId: workspace.actor.id, context: workspace.context }), [workspace.actor.id, workspace.context])
  const navigation = useClinicalNavigation(), administrative = canAdmin(workspace.actor)
  const day = validCalendarDate(query.get('day') ?? '') ? query.get('day')! : localDateTime(new Date()).slice(0, 10)
  const view: CalendarView = officesOnly ? query.get('view') === 'day' ? 'day' : 'week' : ['day', 'week', 'month'].includes(query.get('view') ?? '') ? query.get('view') as CalendarView : embeddedClientId || embeddedProfessionalId ? 'month' : administrative ? 'month' : 'week'
  const requestedScope = query.get('scope'), scope: CalendarDisplayScope = officesOnly ? 'offices' : embeddedClientId ? 'client' : embeddedProfessionalId ? 'professional' : ['professional', 'client', 'offices', ...(administrative ? ['team'] : [])].includes(requestedScope ?? '') ? requestedScope as CalendarDisplayScope : query.get('client') ? 'client' : 'professional'
  const range = useMemo(() => periodFor(day, view), [day, view])
  const [data, setData] = useState<DurableCalendarWorkspace | null>(null), [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [stale, setStale] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [slot, setSlot] = useState<NewCalendarSlot | null>(null), [editingId, setEditingId] = useState<string | null>(null)
  const [billingFocus, setBillingFocus] = useState<{ clientId: string; activityId?: string; endAt?: string } | null>(null)
  const [offeringCapacity, setOfferingCapacity] = useState(false)
  const editorForm = useRef<CalendarFormHandle>(null)
  const sequence = useRef(0), operation = useRef(false)
  const guard = useClinicalFormGuard(false, pending)
  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++sequence.current
    setLoading(true)
    try { const next = await loadCalendar(range.from, range.to, actor, signal); if (signal?.aborted || sequence.current !== request) return false; setData(next); setStale(false); setError(''); return true }
    catch (cause) {
      if (!signal?.aborted && sequence.current === request) { if (isClinicalAccessDenied(cause)) { setData(null); setSlot(null); setEditingId(null); void onUpdated() } setStale(true); setError(cause instanceof Error ? cause.message : 'Actualisation indisponible.') }
      return false
    } finally { if (!signal?.aborted && sequence.current === request) setLoading(false) }
  }, [actor, range.from, range.to, onUpdated, setData, setSlot, setEditingId, setError, setLoading, setStale])
  useEffect(() => { setData(null); setSlot(null); setEditingId(null); setMessage(''); const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load, embeddedClientId, embeddedProfessionalId, officesOnly])
  const command = useCallback(async (input: CalendarCommand): Promise<CalendarCommandAck> => {
    if (operation.current) throw new Error('Une écriture est déjà en cours de confirmation.')
    operation.current = true; guard.markPending(); setPending(true); setError(''); setMessage('')
    try {
      const { ack, refreshed } = await confirmCalendarWrite(() => runCalendarCommand(input, actor), () => load(), () => setMessage('Enregistrement confirmé dans la base locale.'))
      if (!refreshed) setMessage('Enregistrement confirmé. La relecture est momentanément indisponible : actualisez le calendrier. Aucune commande n’est rejouée.')
      return ack
    } catch (cause) { if (isClinicalAccessDenied(cause)) { setData(null); setSlot(null); setEditingId(null); void onUpdated() } throw cause }
    finally { operation.current = false; guard.markSettled(); setPending(false) }
  }, [actor, guard, load, onUpdated, setData, setSlot, setEditingId, setError, setPending, setMessage])
  const select = async (patch: Record<string, string | null>) => {
    const next = { ...Object.fromEntries(query), ...patch }
    if (embeddedClientId) await onNavigate('clients', { ...next, client: embeddedClientId, clientTab: 'activities', scope: null, pro: null, office: null, offices: null })
    else if (embeddedProfessionalId) await onNavigate(workspace.context === 'administration' ? 'professionals' : 'my-profile', { ...next, professional: workspace.context === 'administration' ? embeddedProfessionalId : null, tab: 'activities', scope: null, pro: null, office: null, offices: null })
    else if (officesOnly) await onNavigate('offices', { ...next, client: null, pro: null, scope: null, office: null, cancelled: null })
    else await onNavigate('calendar', next)
  }
  const professionalId = embeddedProfessionalId ?? (administrative ? (!embeddedClientId && !officesOnly ? data?.professionals.find(pro => pro.id === query.get('pro'))?.id : undefined) ?? data?.clients.find(client => client.clientId === (embeddedClientId ?? query.get('client')))?.professionalIds.find(id => data.professionals.some(pro => pro.id === id)) ?? data?.professionals[0]?.id ?? '' : workspace.actor.id)
  const clientId = embeddedClientId ?? (officesOnly ? '' : query.get('client') ?? ''), officeId = officesOnly || embeddedClientId ? '' : query.get('office') ?? ''
  const occupations = useMemo(() => data ? officeOccupations(data) : [], [data])
  const officeCatalog = data?.offices.filter(office => office.active || occupations.some(row => row.officeId === office.id)) ?? []
  const chosenOfficeIds = officeCatalog.map(office => office.id)
  const officeColors = officeDisplayColors(data?.offices ?? [])
  const events = filterCalendarEvents(data?.appointments ?? [], { scope, professionalId, explicitProfessional: Boolean(embeddedProfessionalId) || !embeddedClientId && Boolean(query.get('pro')), clientId, officeId, showCancelled: Boolean(embeddedClientId) || query.get('cancelled') === 'yes' })
  const selected = officesOnly ? undefined : data?.appointments.find(event => event.id === query.get('appointment') && (!embeddedClientId || event.clientId === embeddedClientId)), editing = data?.appointments.find(event => event.id === editingId)
  const columns: CalendarColumn[] = !data ? [] : scope === 'offices'
    ? range.days.flatMap(date => data.offices.filter(office => (!officeId || office.id === officeId) && (office.active || events.some(event => event.officeId === office.id))).map(office => ({ key: date + ':' + office.id, day: date, label: office.name, officeId: office.id })))
    : scope === 'team' ? range.days.flatMap(date => data.professionals.map(pro => ({ key: date + ':' + pro.id, day: date, label: pro.name, professionalId: pro.id })))
      : range.days.map(date => ({ key: date, day: date, label: data.professionals.find(pro => pro.id === professionalId)?.name ?? 'Agenda autorisé', professionalId: scope === 'client' && (Boolean(embeddedClientId) || !query.get('pro')) ? undefined : professionalId }))
  const openSlot = async (date: string, minute: number, pro = professionalId, office?: string, kind?: CalendarEventKind, disambiguation?: 'earlier' | 'later') => {
    if (!data || stale || pending || !await navigation.canLeave()) return
    let selectedPro = pro
    if (officesOnly && office) {
      const eligible = officeReservationProfessional(data, administrative, office, date)
      if (!eligible) { setError('Aucun professionnel autorisé ne peut réserver ce bureau à cette date. Vérifiez les attributions dans les paramètres du calendrier.'); return }
      selectedPro = eligible
    }
    const followups = data.clients.filter(client => client.clientId === clientId && client.professionalIds.includes(selectedPro))
    setEditingId(null); setSlot({ day: date, minute, professionalId: selectedPro, officeId: office || officeId || undefined, clientId: clientId || undefined, episodeId: followups.length === 1 ? followups[0].episodeId : undefined, kind, disambiguation })
  }
  const invalidateFinancialAccess = useCallback((cause: unknown) => { if (isClinicalAccessDenied(cause)) { setData(null); setSlot(null); setEditingId(null); setBillingFocus(null); void onUpdated() } }, [onUpdated, setData, setSlot, setEditingId])
  const ui: CalendarUi | null = data ? {
    data, busy: pending || loading || stale, administrative, command, clientContextId: embeddedClientId, invalidate: invalidateFinancialAccess,
    selectEvent: id => select({ appointment: id }),
    openClient: id => refreshBeforeCalendarLink(onUpdated, () => onNavigate('clients', { client: id })),
    openBilling: async (id, activityId, endAt) => { if (administrative) { setBillingFocus({ clientId: id, activityId, endAt }); await select({ appointment: null }) } },
    // The note route rechecks record and appointment access. Reloading the entire
    // workspace here made every calendar-to-note navigation wait for a large read.
    openNote: (recordId, id, appointmentId, noteId) => onNavigate('note-page', { client: id, record: recordId, appointment: appointmentId, note: noteId ?? null, returnTo: workspaceHref(workspace.context, embeddedClientId ? 'clients' : embeddedProfessionalId ? workspace.context === 'administration' ? 'professionals' : 'my-profile' : 'calendar', { ...Object.fromEntries(query), ...(embeddedClientId ? { client: embeddedClientId, clientTab: 'activities' } : {}), ...(embeddedProfessionalId ? { professional: embeddedProfessionalId, tab: 'activities' } : {}) }) }),
  } : null
  const closeEditor = async () => { if (await navigation.canLeave()) { setSlot(null); setEditingId(null) } }
  const changePeriod = (direction: number) => select({ day: view === 'month' ? shiftMonth(day, direction) : shiftCalendarDate(day, direction * (view === 'week' ? 7 : 1)), appointment: null })
  return <div className={'grid min-w-0 ' + (simpleProfessional ? 'gap-2' : 'gap-5')}>
    {officesOnly ? <section className={clinicalCard}><h2 className="mb-4 text-xl font-semibold">Disponibilité des bureaux</h2><CalendarDateNavigation day={day} days={range.days} view={view} views={['day', 'week']} disabled={pending} onStep={direction => void changePeriod(direction)} onToday={() => void select({ day: localDateTime(new Date()).slice(0, 10), appointment: null })} onView={next => void select({ view: next, appointment: null })} /></section>
      : embeddedClientId ? <section className="grid min-w-0 gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">Activités</h3><button style={{ width: 'auto' }} className={buttonClass('primary')} disabled={!data || pending || stale} onClick={() => void openSlot(day, 540)}><Plus size={16} />Ajouter une rencontre</button></div><CalendarDateNavigation day={day} days={range.days} view={view} disabled={pending} onStep={direction => void changePeriod(direction)} onToday={() => void select({ day: localDateTime(new Date()).slice(0, 10), appointment: null })} onView={next => void select({ view: next, appointment: null })} /></section>
      :     <section className={clinicalCard + (simpleProfessional ? ' !pb-2' : '')}><div className="flex flex-wrap items-center justify-between gap-3">{(embeddedProfessionalId || !administrative) && <h2 className="flex items-center gap-2 text-xl font-semibold"><CalendarDays size={21} />{embeddedProfessionalId ? 'Calendrier professionnel' : 'Mon calendrier'}</h2>}{!administrative && <button type="button" className={buttonClass('secondary')} disabled={!data || pending || stale} onClick={() => setOfferingCapacity(true)}>Proposer mes dispos</button>}<button className={buttonClass('primary') + (administrative && !embeddedProfessionalId ? ' ml-auto' : '')} disabled={!data || pending || stale} onClick={() => void openSlot(day, 540)}><Plus size={17} />Ajouter</button></div>
      <div className="mt-4 flex flex-wrap items-center gap-2"><button className={buttonClass('ghost')} disabled={pending} aria-label="Période précédente" onClick={() => void changePeriod(-1)}><ChevronLeft size={18} /></button><button className={buttonClass('secondary')} disabled={pending} onClick={() => void select({ day: localDateTime(new Date()).slice(0, 10), appointment: null })}>Aujourd’hui</button><button className={buttonClass('ghost')} disabled={pending} aria-label="Période suivante" onClick={() => void changePeriod(1)}><ChevronRight size={18} /></button><strong className="text-sm">{view === 'month' ? new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T12:00Z')) : frenchDay(day)}</strong><div className="flex flex-wrap gap-1">{[['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois']].map(([value, label]) => <button key={value} className={buttonClass(view === value ? 'primary' : 'secondary')} aria-pressed={view === value} onClick={() => void select({ view: value, appointment: null })}>{label}</button>)}</div></div>
      {!simpleProfessional && <><div className={administrative ? 'mt-3 max-w-sm' : 'mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5'}>{!administrative && <Field label="Date"><input className={inputClass} type="date" value={day} onChange={event => { if (validCalendarDate(event.target.value)) void select({ day: event.target.value, appointment: null }) }} /></Field>}{!administrative && !embeddedProfessionalId && <Field label="Afficher"><select className={inputClass} value={scope} onChange={event => { if (event.target.value === 'offices') void onNavigate('offices', { day, view: 'day', offices: officeId || null, office: null, client: null, pro: null, scope: null, appointment: null }); else void select({ scope: event.target.value, appointment: null }) }}><option value="professional">Par professionnel</option><option value="client">Par client</option><option value="offices">Bureaux partagés</option>{administrative && <option value="team">Équipe administrative</option>}</select></Field>}
        {administrative && !embeddedProfessionalId && <Field label="Professionnel"><select className={inputClass} value={scope === 'team' || scope === 'offices' ? query.get('pro') ?? '' : professionalId} onChange={event => void select({ pro: event.target.value || null, ...(event.target.value && scope !== 'offices' ? { scope: 'professional', view: 'month' } : {}), appointment: null })}>{(scope === 'team' || scope === 'offices') && <option value="">Tous</option>}{data?.professionals.map(pro => <option key={pro.id} value={pro.id}>{pro.name}</option>)}</select></Field>}
        {!administrative && <Field label="Client autorisé"><select className={inputClass} value={clientId} onChange={event => void select({ client: event.target.value || null, scope: event.target.value ? 'client' : 'professional', pro: null, appointment: null })}><option value="">Tous</option>{[...new Map(data?.clients.map(client => [client.clientId, client.name]) ?? [])].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>}
        {!administrative && <Field label="Bureau"><select className={inputClass} value={officeId} onChange={event => void select({ office: event.target.value || null, appointment: null })}><option value="">Tous les bureaux</option>{data?.offices.map(office => <option key={office.id} value={office.id}>{office.name}{office.active ? '' : ' (inactif)'}</option>)}</select></Field>}</div>
      {!administrative && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={query.get('cancelled') === 'yes'} onChange={event => void select({ cancelled: event.target.checked ? 'yes' : null })} />Afficher aussi les événements annulés</label>}</>}
    </section>}
    {message && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">{message}</p>}{error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}{stale && ' Les écritures sont bloquées jusqu’à une actualisation réussie.'}</p>}{(officesOnly || embeddedClientId) && stale && <button style={{ width: 'auto' }} className={buttonClass('secondary')} disabled={pending || loading} onClick={() => void navigation.canLeave().then(allowed => { if (allowed) void load() })}>Réessayer l’actualisation</button>}{loading && <p role="status" className="text-sm text-[#8a6f5d]">Chargement du calendrier autorisé…</p>}
    {data && <>
      {offeringCapacity && !administrative && <CapacityOfferDialog actor={actor} initialDay={day} onClose={() => setOfferingCapacity(false)} onSaved={clients => { setOfferingCapacity(false); setMessage(`Demande de ${clients} nouveau${clients > 1 ? 'x' : ''} client${clients > 1 ? 's' : ''} transmise à l’administration.`) }} />}
      {slot && <ProspectDialog compactHeader title={editing ? 'Modifier l’activité' : 'Ajouter une activité'} onClose={() => editorForm.current?.requestCancel()}><AppointmentEditor key={editingId ?? slot.day + ':' + slot.minute + ':' + slot.professionalId} ui={ui!} slot={slot} editing={editing} lockedClientId={embeddedClientId} formRef={editorForm} onCancel={() => void closeEditor()} onSaved={async (id, focus) => {
        setSlot(null); setEditingId(null)
        const patch = calendarSavedFocusPatch(scope, { clientId, professionalId: query.get('pro') ?? '', officeId }, focus, id)
        if (officesOnly) {
          patch.appointment = null
        }
        await select(patch)
      }} /></ProspectDialog>}
      {officesOnly ? <OfficeCalendarGrid days={range.days} offices={officeCatalog.filter(office => chosenOfficeIds.includes(office.id))} colors={officeColors} occupations={occupations} disabled={pending || stale || loading} canReserve={(id, date) => Boolean(data.offices.find(office => office.id === id)?.active && officeReservationProfessional(data, administrative, id, date))} onSlot={(date, minute, id, disambiguation) => void openSlot(date, minute, professionalId, id, undefined, disambiguation)} />
        : view === 'month' ? <MonthGrid clientContext={Boolean(embeddedClientId)} data={data} showBusy={scope === 'offices'} busyOfficeId={officeId} events={events} days={range.days} date={day} busy={pending || stale} onEvent={id => void ui!.selectEvent(id)} onSlot={(date, minute) => void openSlot(date, minute)} onDay={date => void select({ day: date, view: 'day', appointment: null })} /> : columns.length ? <TimeGrid clientContext={Boolean(embeddedClientId)} data={data} events={events} columns={columns} busy={pending || stale} onEvent={id => void ui!.selectEvent(id)} onSlot={(column, minute) => void openSlot(column.day, minute, column.professionalId ?? professionalId, column.officeId)} /> : <section className={clinicalCard}>Aucune ressource disponible pour cette vue.</section>}
      {!officesOnly && <div className="flex flex-wrap justify-end gap-3 text-xs">{([[primaryActivityColors.meeting, 'Rencontre'], [primaryActivityColors.documentation, 'Rédaction'], [primaryActivityColors.absence, 'Absence'], [primaryActivityColors.other, 'Autre événement']] as const).map(([color, label]) => <span key={label} className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border" style={{ backgroundColor: color }} />{label}</span>)}</div>}
      {selected && !slot && <ProspectDialog compactHeader title={selected.clientId && selected.clientName && !embeddedClientId ? <button type="button" className="cursor-pointer rounded text-left underline-offset-4 hover:text-[#8a5633] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5633]" onClick={() => void ui!.openClient(selected.clientId!)}>{calendarClientName(selected.clientName)}</button> : selected.clientName ? calendarClientName(selected.clientName) : selected.title || 'Activité'} onClose={() => void ui!.selectEvent(null)}><EventDetail key={selected.id + ':' + selected.version + ':' + (selected.activity?.version ?? 0)} event={selected} ui={ui!} onEdit={(absence = false) => { void navigation.canLeave().then(allowed => { if (allowed) { setEditingId(selected.id); setSlot({ day: localDateTime(selected.startAt).slice(0, 10), minute: 0, professionalId: selected.professionalId, clientId: selected.clientId ?? undefined, absence }); void ui!.selectEvent(null) } }) }} /></ProspectDialog>}
      {billingFocus && administrative && <ActivityInvoiceDialog actorId={workspace.actor.id} clientId={billingFocus.clientId} activityId={billingFocus.activityId} endAt={billingFocus.endAt} onClose={() => setBillingFocus(null)} onNavigate={onNavigate} onAccessDenied={invalidateFinancialAccess} />}
      {!officesOnly && query.get('appointment') && !selected && !slot && !loading && <p role="status" className="text-sm">Cet événement n’est pas dans la période autorisée affichée. Changez de période ou <button className="underline" onClick={() => void ui!.selectEvent(null)}>effacez la sélection</button>.</p>}
    </>}
  </div>
}
