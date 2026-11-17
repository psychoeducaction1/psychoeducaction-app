'use client'

import { useRef, useState, type Ref } from 'react'
import { Camera, Clock, Minus, Plus } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import type { AppointmentModality } from '@/lib/clinical-calendar/types'
import type { CalendarEventInput, CalendarEventKind, CalendarFeePercent, CalendarRecurrence, DurableCalendarEvent } from '@/lib/clinical-calendar/durableTypes'
import { localDateTime, torontoLocalInstant } from '@/lib/clinical-calendar/time'
import { CalendarForm, Field, inputClass, type CalendarUi, type CalendarFormHandle } from './primitives'
import { activityDurationMinutes, eventKindLabels, frenchDay, futureSeriesEvents, modalityLabels, recurrenceDates, stepActivityDuration, type CalendarSavedFocus } from './model'
import { ActivityFinancialFields } from './ActivityFinancialFields'
import { activityAcceptedConditions, activityFinancialOverride, effectiveAbsencePercents, hasActivityFinancialChanges, isTimelyActivityCancellation } from './activityForm'
import { useEncounterCorrection } from './useEncounterCorrection'
import { useActivityFinancialContext } from './useActivityFinancialContext'

export type NewCalendarSlot = { day: string; minute: number; professionalId?: string; officeId?: string; episodeId?: string; clientId?: string; kind?: CalendarEventKind; absence?: boolean; disambiguation?: 'earlier' | 'later' }
type EditorKind = CalendarEventKind | 'client_absence'
export function AppointmentEditor({ ui, slot, editing, onSaved, onCancel, formRef, lockedClientId }: { ui: CalendarUi; slot: NewCalendarSlot; editing?: DurableCalendarEvent; onSaved: (id: string, focus: CalendarSavedFocus) => Promise<void>; onCancel: () => void; formRef?: Ref<CalendarFormHandle>; lockedClientId?: string }) {
  const correcting = editing?.status === 'completed'
  const correction = useEncounterCorrection(editing, ui)
  const [correctionReason, setCorrectionReason] = useState('')
  const initialPro = editing?.professionalId ?? slot.professionalId ?? ui.data.professionals[0]?.id ?? ''
  const initialClient = ui.data.clients.find(client => client.episodeId === (editing?.episodeId ?? slot.episodeId))
  const initialStart = editing ? localDateTime(editing.startAt) : slot.day + 'T' + String(Math.floor(slot.minute / 60)).padStart(2, '0') + ':' + String(slot.minute % 60).padStart(2, '0')
  const timeInput = useRef<HTMLInputElement>(null)
  const [changed, setChanged] = useState(false)
  const [value, setValue] = useState({
    kind: (slot.absence ? 'client_absence' : editing?.kind ?? slot.kind ?? 'meeting') as EditorKind,
    title: editing?.title ?? '', hiddenFromDirection: editing?.hiddenFromDirection ?? false, professionalId: initialPro, clientId: lockedClientId ?? editing?.clientId ?? slot.clientId ?? initialClient?.clientId ?? '', episodeId: editing?.episodeId ?? slot.episodeId ?? '',
    day: initialStart.slice(0, 10), time: initialStart.slice(11, 16), duration: String(editing ? (Date.parse(editing.endAt) - Date.parse(editing.startAt)) / 60000 : 60),
    modality: (editing ? editing.modality ?? '' : 'office') as AppointmentModality | '',
    officeId: editing?.officeId ?? slot.officeId ?? '', location: editing?.location ?? '', locationTouched: editing?.modality === 'home',
    travelKilometers: editing?.travelKilometers ?? '0', billable: editing?.billable ?? true,
    absenceStatus: 'no_show' as 'no_show' | 'cancelled', feePercent: (editing?.absenceDecision.feePercent ?? 0) as CalendarFeePercent, travelPerformed: false,
    repeat: false, frequency: 'weekly' as CalendarRecurrence['frequency'], interval: '1', count: '4', scope: 'occurrence' as 'occurrence' | 'future', disambiguation: (editing && torontoLocalInstant(initialStart, 'later') === new Date(editing.startAt).toISOString() ? 'later' : slot.disambiguation ?? 'earlier') as 'earlier' | 'later',
  })
  const update = <K extends keyof typeof value>(key: K, next: typeof value[K]) => { setChanged(true); setValue(previous => ({ ...previous, [key]: next })) }
  const kind: CalendarEventKind = value.kind === 'client_absence' ? 'meeting' : value.kind
  const clientAbsence = value.kind === 'client_absence', internal = kind === 'absence' || kind === 'other'
  const professionalClients = ui.data.clients.filter(client => client.professionalIds.includes(value.professionalId))
  const choices = [...new Map(professionalClients.map(client => [client.clientId, client.name])).entries()]
  const clientFollowups = professionalClients.filter(client => client.clientId === value.clientId)
  const episodeId = editing?.episodeId ?? (clientFollowups.some(client => client.episodeId === value.episodeId) ? value.episodeId : clientFollowups.length === 1 ? clientFollowups[0].episodeId : '')
  const selectedClient = ui.data.clients.find(client => client.episodeId === episodeId)
  const startLocal = value.day + 'T' + value.time
  const location = value.locationTouched ? value.location : selectedClient?.serviceAddress ?? ''
  const usesLocation = kind !== 'absence' && (kind !== 'other' || Boolean(editing?.modality))
  const allowedOfficeIds = ui.data.officeGrants.filter(grant => grant.professionalId === value.professionalId && grant.validFrom <= value.day && (!grant.validTo || grant.validTo >= value.day)).map(grant => grant.officeId)
  const selectedStart = (() => { try { return Date.parse(torontoLocalInstant(startLocal, value.disambiguation || undefined)) } catch { return NaN } })()
  const selectedEnd = selectedStart + Number(value.duration) * 60000
  const officeBusy = (officeId: string) => Number.isFinite(selectedStart) && Number.isFinite(selectedEnd) && [
    ...(ui.data.appointments ?? []).filter(item => item.id !== editing?.id && item.status !== 'cancelled' && item.officeId === officeId),
    ...(ui.data.busy ?? []).filter(item => item.officeId === officeId),
  ].some(item => Date.parse(item.startAt) < selectedEnd && Date.parse(item.endAt) > selectedStart)
  const allowedOffices = ui.data.offices.filter(office => office.active && allowedOfficeIds.includes(office.id) && !officeBusy(office.id))
  const financial = useActivityFinancialContext(ui, episodeId, value.professionalId, value.day, editing)
  let pendingConditions
  try { if (ui.administrative && !financial.needsReview && financial.context?.financialOptions) pendingConditions = activityAcceptedConditions(financial.draft, financial.context.financialOptions) } catch { /* A partial review cannot enable nonzero absence fees. */ }
  const timelyCancellation = (() => {
    if (!clientAbsence || value.absenceStatus !== 'cancelled') return false
    try { return isTimelyActivityCancellation(torontoLocalInstant(startLocal, value.disambiguation || undefined), ui.data.currentTime) } catch { return false }
  })()
  const allowedPercents = effectiveAbsencePercents(financial.context?.absenceDecision, pendingConditions, {
    billable: value.billable, timelyCancellation, homeTravelPerformed: value.modality === 'home' && value.travelPerformed,
  })
  const feePercent = allowedPercents.includes(value.feePercent) ? value.feePercent : 0
  const recurrence = value.repeat && !clientAbsence ? { frequency: value.frequency, interval: Math.max(1, Math.min(12, Number(value.interval) || 1)), count: Math.max(2, Math.min(52, Number(value.count) || 2)) } : undefined
  const preview = (() => { try { return recurrenceDates(startLocal, recurrence) } catch { return [] } })()
  const futureKnown = editing ? futureSeriesEvents(ui.data.appointments, editing) : []
  return <CalendarForm submitLabel={correcting ? 'Enregistrer la correction' : clientAbsence ? 'Enregistrer l’absence' : editing ? 'Enregistrer les modifications' : value.repeat ? 'Créer la série' : 'Enregistrer l’activité'} disabled={ui.busy || correcting && !correction.preview} changed={changed || financial.touched} onCancel={onCancel} formRef={formRef} onSave={async () => {
    if (!value.professionalId) throw new Error('Choisissez un professionnel.')
    if (lockedClientId && selectedClient?.clientId !== lockedClientId) throw new Error('Ce client doit disposer d’un suivi autorisé avec le professionnel choisi avant de réserver.')
    if (kind === 'meeting' && !episodeId) throw new Error('Choisissez le client et, si plusieurs suivis existent, le suivi à utiliser.')
    if (clientAbsence && value.repeat) throw new Error('Enregistrez l’absence pour cette occurrence uniquement.')
    if (!correcting && financial.needsReview) throw new Error('Le client, le professionnel ou la date a changé : vérifiez ou réinitialisez l’exception affichée avant de continuer.')
    const financialOptions = financial.context?.financialOptions
    const acceptedConditions = !correcting && ui.administrative && financialOptions ? activityAcceptedConditions(financial.draft, financialOptions) : undefined
    const financialOverride = !correcting && ui.administrative && financialOptions && financial.touched && hasActivityFinancialChanges(financial.draft, financialOptions) ? activityFinancialOverride(financial.draft, financialOptions) : undefined
    if (!correcting && ui.administrative && financial.touched && !financialOptions) throw new Error('Actualisez le contexte financier avant d’enregistrer cette exception.')
    const data: CalendarEventInput = {
      kind, title: value.title.trim() || eventKindLabels[kind], ...(kind === 'other' ? { hiddenFromDirection: value.hiddenFromDirection } : {}), episodeId: kind === 'meeting' || kind === 'documentation' ? episodeId || null : null,
      professionalId: value.professionalId, startLocal, durationMinutes: activityDurationMinutes(value.duration),
      modality: usesLocation ? value.modality || null : null, officeId: usesLocation && value.modality === 'office' ? value.officeId || null : null,
      location: usesLocation && value.modality === 'home' ? location.trim() : editing?.location ?? '',
      travelBeforeMinutes: editing?.travelBeforeMinutes ?? 0, travelAfterMinutes: editing?.travelAfterMinutes ?? 0,
      travelKilometers: usesLocation && value.modality === 'home' ? value.travelKilometers.replace(',', '.') : editing?.travelKilometers ?? '0',
      billable: !internal && value.billable, ...(acceptedConditions ? { acceptedConditions } : {}), ...(financialOverride ? { financialOverride } : {}),
      ...(value.disambiguation ? { disambiguation: value.disambiguation } : {}), ...(!editing && recurrence ? { recurrence } : {}),
      ...(clientAbsence ? { absenceDecision: { status: value.absenceStatus, feePercent, travelPerformed: value.modality === 'home' && value.travelPerformed } } : {}),
    }
    if (data.modality === 'office' && !allowedOffices.some(office => office.id === data.officeId)) throw new Error('Choisissez un bureau disponible pour cet horaire.')
    if (correcting && editing) {
      if (!correction.preview || !correctionReason.trim()) throw new Error('Précisez le motif de la correction.')
      if (!globalThis.confirm('Enregistrer cette correction ? Les notes signées et les factures existantes restent inchangées. La facturation devra être vérifiée si nécessaire.')) throw new Error('Correction non enregistrée.')
      const ack = await ui.command({ action: 'appointments.correct', id: editing.id, data: { expectedVersion: editing.version, previewHash: correction.preview.hash, confirmed: true, reason: correctionReason.trim(), title: data.title, startLocal: data.startLocal, durationMinutes: data.durationMinutes, modality: data.modality, officeId: data.officeId, location: data.location, travelBeforeMinutes: data.travelBeforeMinutes ?? 0, travelAfterMinutes: data.travelAfterMinutes ?? 0, travelKilometers: data.travelKilometers ?? '0', disambiguation: data.disambiguation } })
      return () => onSaved(ack.result.id, { clientId: selectedClient?.clientId ?? null, professionalId: editing.professionalId, day: value.day, officeId: data.officeId })
    }
    if (editing) {
      const { kind: _kind, episodeId: _episode, professionalId: _professional, recurrence: _recurrence, ...editable } = data
      void _kind; void _episode; void _professional; void _recurrence
      const ack = await ui.command({ action: 'appointments.reschedule', id: editing.id, data: { ...editable, ...(ui.administrative && editing.canChangeProfessional ? { professionalId: value.professionalId } : {}), expectedVersion: editing.version, scope: clientAbsence ? 'occurrence' : value.scope, ...(!clientAbsence && value.scope === 'future' && editing.seriesRevision !== null ? { expectedSeriesRevision: editing.seriesRevision } : {}) } })
      return () => onSaved(ack.result.id, { clientId: selectedClient?.clientId ?? null, professionalId: value.professionalId, day: value.day, officeId: data.officeId })
    }
    const ack = await ui.command({ action: 'appointments.create', id: null, data }); return () => onSaved(ack.result.id, { clientId: selectedClient?.clientId ?? null, professionalId: value.professionalId, day: value.day, officeId: data.officeId })
  }}>
    {correcting && <section className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p>Correction de cette rencontre uniquement. Les notes signées et les documents déjà établis restent inchangés.</p>
      {correction.error && <p role="alert" className="text-red-800">{correction.error}</p>}
      {!correction.preview && !correction.error && <p role="status">Vérification des documents liés…</p>}
      {correction.preview && <p>{correction.preview.noteCount} note(s) et {correction.preview.invoiceCount} facture(s) liées. {correction.preview.invoiceCount > 0 && 'La facturation devra être vérifiée par la direction ou l’administration.'}</p>}
      <Field label="Motif de la correction"><input className={inputClass} required maxLength={1000} value={correctionReason} onChange={event => { setChanged(true); setCorrectionReason(event.target.value) }} /></Field>
    </section>}
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Type d’activité"><select className={inputClass} disabled={correcting} value={value.kind} onChange={event => update('kind', event.target.value as EditorKind)}>
        <option value="meeting" disabled={Boolean(editing && editing.kind !== 'meeting')}>Rencontre</option><option value="documentation" disabled={Boolean(editing && editing.kind !== 'documentation')}>Rédaction</option><option value="client_absence" disabled={Boolean(editing && editing.kind !== 'meeting')}>Absence du client</option>{editing?.kind === 'absence' && <option value="absence">Ancienne indisponibilité interne</option>}<option value="other" disabled={Boolean(editing && editing.kind !== 'other')}>Autre événement</option>
      </select></Field>
      <Field label="Professionnel"><select required className={inputClass} value={value.professionalId} disabled={correcting || !ui.administrative || Boolean(editing && !editing.canChangeProfessional)} onChange={event => { setChanged(true); setValue(previous => ({ ...previous, professionalId: event.target.value, episodeId: editing?.episodeId ?? '', officeId: '' })) }}>{ui.data.professionals.map(pro => <option key={pro.id} value={pro.id} disabled={Boolean(lockedClientId && pro.id !== editing?.professionalId && !ui.data.clients.some(client => client.clientId === lockedClientId && client.professionalIds.includes(pro.id))) || Boolean(editing?.episodeId && pro.id !== editing.professionalId && !ui.data.clients.find(client => client.episodeId === editing.episodeId)?.professionalIds.includes(pro.id))}>{pro.name}</option>)}</select></Field>
      {!internal && lockedClientId && <p className="self-end text-sm text-[#6c5a4d]">Client · <strong className="text-[#332820]">{ui.data.clients.find(client => client.clientId === lockedClientId)?.name ?? 'Client sélectionné'}</strong></p>}
      {!internal && !lockedClientId && <Field label={kind === 'meeting' ? 'Client' : 'Client associé (facultatif)'}><select className={inputClass} required={kind === 'meeting'} disabled={Boolean(editing)} value={value.clientId} onChange={event => { setChanged(true); setValue(previous => ({ ...previous, clientId: event.target.value, episodeId: '', location: '', locationTouched: false })) }}><option value="">{kind === 'meeting' ? 'Choisir un client' : 'Sans client'}</option>{choices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>}
      {!editing && clientFollowups.length > 1 && <Field label="Suivi à utiliser"><select className={inputClass} required={kind === 'meeting'} value={episodeId} onChange={event => update('episodeId', event.target.value)}><option value="">Choisir le suivi</option>{clientFollowups.map(client => <option key={client.episodeId} value={client.episodeId}>{client.episodeLabel}</option>)}</select></Field>}
      {kind === 'other' && <div className="grid gap-2"><Field label="Titre de cet événement"><input className={inputClass} maxLength={160} value={value.title} onChange={event => update('title', event.target.value)} placeholder="Préciser l’événement" /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={correcting} checked={value.hiddenFromDirection} onChange={event => update('hiddenFromDirection', event.target.checked)} />Masquer cet événement à la direction</label></div>}
    </div>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
      <Field label="Date"><input className={inputClass + ' min-w-0'} type="date" required value={value.day} onChange={event => update('day', event.target.value)} /></Field>
      <div className="flex min-w-0 items-end gap-2"><div className="min-w-0 flex-1"><Field label="Heure"><input ref={timeInput} className={inputClass + ' min-w-0'} type="time" required value={value.time} onChange={event => update('time', event.target.value)} /></Field></div><button type="button" aria-label="Choisir l’heure" title="Choisir l’heure" className={buttonClass('secondary') + ' flex shrink-0 items-center justify-center !p-3'} onClick={() => {
        const input = timeInput.current
        if (!input) return
        try {
          if (typeof input.showPicker === 'function') input.showPicker()
          else input.focus()
        } catch { input.focus() }
      }}><Clock size={20} aria-hidden="true" /></button></div>
    </div>
    <div className="grid min-w-0 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-3">
      <Field label="Durée (minutes)"><div className="flex min-w-0 items-center gap-1"><button type="button" className={buttonClass('secondary') + ' shrink-0 !px-0'} style={{ width: 40, minWidth: 40, maxWidth: 40, flex: '0 0 40px' }} aria-label="Diminuer la durée de 5 minutes" onClick={() => { try { update('duration', stepActivityDuration(value.duration, -5)) } catch { update('duration', '1') } }}><Minus size={16} /></button><input className={inputClass + ' min-w-0 flex-1 px-1 text-center'} style={{ width: 0, minWidth: 0, flex: '1 1 0%', paddingInline: 4 }} aria-label="Durée (minutes)" inputMode="numeric" type="number" min="1" max="720" step="1" required value={value.duration} onChange={event => update('duration', event.target.value)} /><button type="button" className={buttonClass('secondary') + ' shrink-0 !px-0'} style={{ width: 40, minWidth: 40, maxWidth: 40, flex: '0 0 40px' }} aria-label="Augmenter la durée de 5 minutes" onClick={() => { try { update('duration', stepActivityDuration(value.duration, 5)) } catch { update('duration', '5') } }}><Plus size={16} /></button></div></Field>
      {usesLocation ? <Field label="Modalité"><select className={inputClass + ' min-w-0'} required={kind === 'meeting'} value={value.modality} onChange={event => update('modality', event.target.value as typeof value.modality)}>{kind !== 'meeting' && <option value="">Sans lieu réservé</option>}{Object.entries(modalityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field> : <p className="self-end pb-2 text-xs">Sans réservation de bureau.</p>}
    </div>
    {usesLocation && value.modality === 'video' && <p className="flex items-center gap-2 text-sm"><Camera size={16} />La caméra identifie automatiquement la visioconférence dans le calendrier.</p>}
    {usesLocation && value.modality === 'office' && <Field label="Bureau"><select className={inputClass} required value={value.officeId} onChange={event => update('officeId', event.target.value)}><option value="">Choisir un bureau disponible</option>{allowedOffices.map(office => <option key={office.id} value={office.id}>{office.name}</option>)}</select>{!allowedOfficeIds.length ? <span className="text-xs text-red-800">Aucun bureau attribué à ce professionnel.</span> : !allowedOffices.length ? <span className="text-xs text-red-800">Aucun bureau disponible à cette heure.</span> : <span className="text-xs text-[#8a6f5d]">Seuls les bureaux libres pour cette plage sont proposés. Le serveur vérifie les conflits à l’enregistrement.</span>}</Field>}
    {usesLocation && value.modality === 'home' && <div className="grid gap-3 sm:grid-cols-[2fr_1fr]"><Field label="Adresse du rendez-vous"><input className={inputClass} maxLength={300} value={location} onChange={event => { setChanged(true); setValue(previous => ({ ...previous, location: event.target.value, locationTouched: true })) }} /><span className="text-xs">Adresse proposée depuis le suivi ; toute modification reste propre à ce rendez-vous.</span></Field><Field label="Kilomètres aller-retour"><input className={inputClass} type="number" min="0" max="2000" step="0.01" required value={value.travelKilometers} onChange={event => update('travelKilometers', event.target.value)} /></Field></div>}
    {!internal && <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={correcting} checked={value.billable} onChange={event => update('billable', event.target.checked)} />Activité facturable</label>}
    {clientAbsence && <fieldset className="grid gap-3 rounded-xl border border-red-200 bg-red-50 p-3"><legend className="px-1 text-sm font-semibold">Absence et conditions applicables</legend><div className="grid gap-3 sm:grid-cols-2"><Field label="Situation"><select className={inputClass} value={value.absenceStatus} onChange={event => update('absenceStatus', event.target.value as typeof value.absenceStatus)}><option value="no_show">Client absent</option><option value="cancelled">Annulation par le client</option></select></Field><Field label="Pourcentage appliqué"><select className={inputClass} value={feePercent} onChange={event => update('feePercent', Number(event.target.value) as CalendarFeePercent)}>{([0, 50, 100] as const).map(percent => <option key={percent} value={percent} disabled={!allowedPercents.includes(percent)}>{percent} %</option>)}</select></Field></div>{value.modality === 'home' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.travelPerformed} onChange={event => update('travelPerformed', event.target.checked)} />Déplacement déjà effectué</label>}<p className="text-xs">{timelyCancellation ? 'Un préavis d’au moins 24 heures impose 0 %.' : !value.billable ? 'Une activité non facturable reste à 0 %.' : allowedPercents.length === 1 ? '0 % reste possible. Les autres choix nécessitent des conditions acceptées vérifiées pour ce suivi et, si nécessaire, pour le déplacement effectué.' : 'Vous pouvez choisir 0 % pour renoncer aux frais, ou un pourcentage permis par les conditions acceptées.'} Le serveur enregistre l’heure réelle de l’avis et recalcule la limite des 24 heures à la confirmation. L’absence porte uniquement sur cette occurrence.</p></fieldset>}
    {!internal && ui.administrative && financial.needsReview && <section role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p>Le client, le professionnel ou la date a changé. Votre saisie financière est conservée ; elle doit être vérifiée pour ce nouveau contexte.</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonClass('secondary')} disabled={!financial.canKeep || financial.loading} onClick={financial.keep}>J’ai vérifié ces valeurs pour ce contexte</button><button type="button" className={buttonClass('secondary')} disabled={financial.loading} onClick={financial.reset}>Réinitialiser l’exception avec les conditions du suivi</button></div><p className="mt-2 text-xs">Réinitialiser abandonne les valeurs saisies. Les preuves de conditions acceptées doivent être sélectionnées et attestées de nouveau.</p></section>}
    {!correcting && !internal && ui.administrative && <ActivityFinancialFields options={financial.context?.financialOptions ?? null} value={financial.draft} onChange={financial.change} loading={financial.loading} error={financial.error} onReload={financial.reload} />}
    {!clientAbsence && <details className="rounded-xl border border-[#eadfd2] p-3"><summary className="cursor-pointer text-sm font-semibold">Récurrence et options avancées</summary><div className="mt-3 grid gap-3">
      {editing?.seriesId && !correcting ? <Field label="Portée des modifications"><select className={inputClass} value={value.scope} onChange={event => update('scope', event.target.value as typeof value.scope)}><option value="occurrence">Cette occurrence seulement</option><option value="future">Cette occurrence et les suivantes planifiées</option></select><span className="text-xs">{futureKnown.length} occurrence(s) planifiée(s) connue(s), selon leur rang dans la série. La commande contrôle aussi les occurrences hors période.</span></Field> : !editing && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.repeat} onChange={event => update('repeat', event.target.checked)} />Répéter cette activité</label>}
      {!editing && value.repeat && <><div className="grid gap-3 sm:grid-cols-3"><Field label="Fréquence"><select className={inputClass} value={value.frequency} onChange={event => update('frequency', event.target.value as CalendarRecurrence['frequency'])}><option value="daily">Chaque jour</option><option value="weekly">Chaque semaine</option><option value="monthly">Chaque mois</option></select></Field><Field label="Intervalle"><input className={inputClass} type="number" min="1" max="12" required value={value.interval} onChange={event => update('interval', event.target.value)} /></Field><Field label="Occurrences"><input className={inputClass} type="number" min="2" max="52" required value={value.count} onChange={event => update('count', event.target.value)} /></Field></div><p className="text-xs">La série entière est refusée si une occurrence est en conflit. Un jour absent d’un mois est ramené au dernier jour, puis le jour d’origine est repris les mois suivants.</p><details className="text-sm"><summary>Prévisualiser {preview.length} occurrences</summary><ol className="mt-2 max-h-32 overflow-auto">{preview.map(date => <li key={date}>{frenchDay(date.slice(0, 10))} · {date.slice(11)}</li>)}</ol></details></>}
      {editing && value.modality !== 'home' && Number(editing.travelKilometers) > 0 && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-950">Kilométrage historique conservé : {editing.travelKilometers} km. Vérifiez les kilomètres réellement effectués lors de la confirmation de l’activité ; aucun trajet nouveau n’est déduit de cette modalité.</p>}
      {Boolean(editing && (editing.travelBeforeMinutes || editing.travelAfterMinutes)) && <p className="text-xs">Les anciennes marges de déplacement sont conservées : {editing!.travelBeforeMinutes} minutes avant et {editing!.travelAfterMinutes} minutes après.</p>}
    </div></details>}
  </CalendarForm>
}
