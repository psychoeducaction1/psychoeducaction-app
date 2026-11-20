'use client'

import { useState } from 'react'
import type { DurableCalendarEvent, CalendarScope } from '@/lib/clinical-calendar/durableTypes'
import { CalendarForm, Field, inputClass, type CalendarUi } from './primitives'

export function CancellationEditor({ event, ui, onCancel }: { event: DurableCalendarEvent; ui: CalendarUi; onCancel: () => void }) {
  const [scope, setScope] = useState<CalendarScope>('occurrence')
  const [reason, setReason] = useState<'client' | 'professional' | 'clinic'>('client')
  return <CalendarForm submitLabel="Confirmer l’annulation" disabled={ui.busy} onCancel={onCancel} onSave={async () => {
    if (!event.canCancel) throw new Error('Ce rendez-vous ne peut plus être annulé. Actualisez le calendrier.')
    if (scope === 'future' && (!event.seriesId || event.seriesRevision === null)) throw new Error('Actualisez la série avant de continuer.')
    await ui.command({ action: 'appointments.cancel', id: event.id, data: {
      expectedVersion: event.version, scope, reason,
      ...(scope === 'future' ? { expectedSeriesRevision: event.seriesRevision! } : {}),
    } })
    return () => ui.selectEvent(null)
  }}>
    <h4 className="font-semibold">Annuler le rendez-vous</h4>
    {event.seriesId && <Field label="Rendez-vous à annuler"><select className={inputClass} value={scope} onChange={event => setScope(event.target.value as CalendarScope)}>
      <option value="occurrence">Ce rendez-vous seulement</option>
      <option value="future">Ce rendez-vous et tous les suivants planifiés</option>
    </select></Field>}
    <Field label="Origine de l’annulation"><select className={inputClass} value={reason} onChange={event => setReason(event.target.value as typeof reason)}>
      <option value="client">À la demande du client</option><option value="professional">À la demande du professionnel</option><option value="clinic">À la demande de la clinique</option>
    </select></Field>
    <p className="text-sm">{scope === 'future' ? 'Ce rendez-vous et les suivants encore planifiés seront annulés, même hors de la période affichée. Les rendez-vous précédents restent inchangés.' : 'Seul ce rendez-vous sera annulé.'} L’historique est conservé. Aucun frais d’annulation ne sera appliqué.</p>
  </CalendarForm>
}