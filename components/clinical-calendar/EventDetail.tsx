'use client'

import { useState } from 'react'
import { EncounterRemoval } from './EncounterRemoval'
import { officeDisplayName } from './officeModel'
import { NotHeldEditor } from './NotHeldEditor'
import { AdvanceOpeningFee } from './AdvanceOpeningFee'
import { CancellationEditor } from './CancellationEditor'
import { Building2, Camera, FilePenLine, Home, Phone } from 'lucide-react'
import { Badge, buttonClass } from '@/components/Ui'
import type { DurableCalendarEvent } from '@/lib/clinical-calendar/durableTypes'
import { type CalendarUi } from './primitives'
import { clock, eventKindLabels, eventStatusLabels, frenchDay, minutesLabel, modalityLabels } from './model'
import { localDateTime } from '@/lib/clinical-calendar/time'

const noteTypes: Record<string, string> = { evaluation_1: 'Évaluation 1', evaluation_2: 'Évaluation 2', evaluation_3: 'Évaluation 3', plan_intervention: 'Plan d’intervention', evolution: 'Évolution', observation: 'Observation', fermeture: 'Fermeture' }
export function EventDetail({ event, ui, onEdit }: { event: DurableCalendarEvent; ui: CalendarUi; onEdit: (absence?: boolean) => void }) {
  const [cancelling, setCancelling] = useState(false)
  const [removing, setRemoving] = useState(false)
  const office = ui.data.offices.find(item => item.id === event.officeId)
  const minutes = (Date.parse(event.endAt) - Date.parse(event.startAt)) / 60000
  const Icon = event.modality ? { office: Building2, home: Home, phone: Phone, video: Camera }[event.modality] : FilePenLine
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><p className="text-sm text-[#795f4d]">{eventKindLabels[event.kind]} · {ui.data.professionals.find(pro => pro.id === event.professionalId)?.name}</p><Badge tone={event.status === 'completed' ? 'success' : event.status === 'cancelled' ? 'muted' : 'neutral'}>{eventStatusLabels[event.status]}</Badge></div>
    <dl className="grid gap-3 rounded-xl bg-[#f7f1e9] p-4 text-sm sm:grid-cols-2"><div><dt className="font-semibold">Date et heure</dt><dd>{frenchDay(localDateTime(event.startAt).slice(0, 10))} · {clock(event.startAt)}–{clock(event.endAt)}</dd></div><div><dt className="font-semibold">Durée planifiée</dt><dd>{minutesLabel(minutes)}</dd></div><div><dt className="font-semibold">Modalité et bureau</dt><dd className="mt-1 flex items-center gap-1"><Icon size={15} />{event.modality ? modalityLabels[event.modality] : 'Sans lieu réservé'}</dd>{event.officeId && <dd>{office ? officeDisplayName(office) : ''}</dd>}{event.location && <dd>{event.location}</dd>}</div>{Boolean(event.travelBeforeMinutes || event.travelAfterMinutes || Number(event.travelKilometers)) && <div><dt className="font-semibold">Déplacements conservés</dt>{Number(event.travelKilometers) > 0 && <dd>{event.travelKilometers} km aller-retour</dd>}{Boolean(event.travelBeforeMinutes || event.travelAfterMinutes) && <dd><details className="mt-1"><summary className="cursor-pointer">Marges historiques de déplacement</summary><p>{event.travelBeforeMinutes} min avant · {event.travelAfterMinutes} min après.</p></details></dd>}</div>}{event.seriesId && <div className="sm:col-span-2"><dt className="font-semibold">Récurrence</dt><dd>Occurrence {(event.occurrenceIndex ?? 0) + 1} · série v{event.seriesRevision}{event.isException ? ' · exception conservée' : ''}</dd></div>}</dl>
    <div className="flex flex-wrap gap-2">{event.clientId && !ui.clientContextId && <button className={buttonClass('secondary')} onClick={() => void ui.openClient(event.clientId!)}>Ouvrir la fiche client</button>}{ui.administrative && event.clientId && event.kind === 'meeting' && <button className={buttonClass('secondary')} onClick={() => void ui.openBilling(event.clientId!, event.activity?.id, event.endAt)}>Voir la facturation</button>}{(event.status === 'planned' && event.canReschedule || event.status === 'completed' && event.canCorrectEncounter) && <button className={buttonClass('primary')} disabled={ui.busy} onClick={() => onEdit()}>{event.status === 'completed' ? 'Corriger la rencontre' : 'Modifier la rencontre'}</button>}</div>
    {ui.administrative && event.canRemove && !removing && <button className={buttonClass('secondary') + ' text-red-800'} disabled={ui.busy} onClick={() => { setCancelling(false); setRemoving(true) }}>Supprimer la rencontre</button>}
    {removing && ui.administrative && <EncounterRemoval event={event} ui={ui} onCancel={() => setRemoving(false)} />}
    {(event.canDeclareNotHeld || event.canCancel) && !removing && !cancelling && <button className={buttonClass('secondary')} disabled={ui.busy} onClick={() => setCancelling(true)}>{event.canDeclareNotHeld ? 'Rencontre annulée ou client absent' : 'Annuler le rendez-vous'}</button>}
    {cancelling && (event.canDeclareNotHeld ? <NotHeldEditor event={event} ui={ui} onCancel={() => setCancelling(false)} /> : <CancellationEditor event={event} ui={ui} onCancel={() => setCancelling(false)} />)}
    {!cancelling && !removing && <AdvanceOpeningFee key={event.id} event={event} ui={ui} />}
    {event.absenceDecision.kind !== 'none' && <section className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm"><h4 className="font-semibold">Décision d’absence conservée</h4><p>{event.absenceDecision.kind === 'no_show' ? 'Client absent' : event.absenceDecision.kind === 'timely_cancellation' ? 'Annulation avec préavis d’au moins 24 heures' : 'Annulation tardive'} · {event.absenceDecision.feePercent ?? 0} % · {event.billable && (event.absenceDecision.feePercent ?? 0) > 0 ? 'Facturable selon les conditions' : 'Aucun frais appliqué'}</p>{event.absenceDecision.recordedAt && <p className="mt-1 text-xs">Décision enregistrée le {localDateTime(event.absenceDecision.recordedAt).replace('T', ' ')}.{event.absenceDecision.travelPerformed ? ' Déplacement effectué déclaré.' : ''}</p>}</section>}
    {event.cancelledAt && <p className="rounded-xl border p-3 text-sm">Annulation conservée le {localDateTime(event.cancelledAt).replace('T', ' ')} · {event.cancellationReason === 'client' ? 'Client' : event.cancellationReason === 'professional' ? 'Professionnel' : 'Clinique'}.</p>}
    {!ui.administrative && event.clinicalLink && event.clientId && <section className="rounded-xl border border-[#d8b992] p-4"><div className="flex flex-wrap gap-2">{event.clinicalLink.notes.map(note => <button key={note.id} className={buttonClass('secondary')} onClick={() => void ui.openNote(event.clinicalLink!.recordId, event.clientId!, event.id, note.id)}>{noteTypes[note.noteType] ?? 'Note d’évolution'} · {note.status === 'signed' ? 'Signée' : note.status === 'awaiting_cosignature' ? 'À cosigner' : 'Brouillon'}</button>)}{event.clinicalLink.canCreate && event.clinicalLink.notes.length === 0 && <button className={buttonClass('primary')} onClick={() => void ui.openNote(event.clinicalLink!.recordId, event.clientId!, event.id)}>Note d’évolution</button>}</div></section>}
  </div>
}
