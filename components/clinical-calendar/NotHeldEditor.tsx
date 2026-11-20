'use client'

import { useEffect, useState } from 'react'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import type { CalendarFeePercent, DurableCalendarEvent } from '@/lib/clinical-calendar/durableTypes'
import { isNotHeldPreview, notHeldFeeChoices, type NotHeldPreview } from '@/lib/clinical-calendar/notHeld'
import { CalendarForm, Field, inputClass, type CalendarUi } from './primitives'

export function NotHeldEditor({ event, ui, onCancel }: { event: DurableCalendarEvent; ui: CalendarUi; onCancel: () => void }) {
  const [status, setStatus] = useState<'cancelled' | 'no_show'>('cancelled')
  const [reason, setReason] = useState<'client' | 'professional' | 'clinic'>('client')
  const [fee, setFee] = useState<CalendarFeePercent>(0)
  const [scope, setScope] = useState<'occurrence' | 'future'>('occurrence')
  const [preview, setPreview] = useState<NotHeldPreview | null>(null)
  const [error, setError] = useState('')
  const choices = scope === 'future' ? [0 as const] : notHeldFeeChoices(event, status, reason, Date.parse(ui.data.currentTime))
  const selectedFee = choices.includes(fee) ? fee : 0
  useEffect(() => {
    const abort = new AbortController()
    void clinicalRequest<unknown>({ actorId: ui.data.actorId, context: ui.data.context }, `/calendar/not-held-preview/${event.id}`, undefined, 'GET', abort.signal)
      .then(value => { if (!abort.signal.aborted) { if (!isNotHeldPreview(value, event)) throw new Error('La rencontre a changé. Actualisez le calendrier.'); setPreview(value) } })
      .catch(cause => { if (!abort.signal.aborted) { ui.invalidate?.(cause); setError(cause instanceof Error ? cause.message : 'Impossible de vérifier la rencontre.') } })
    return () => abort.abort()
  }, [event, ui])
  return <CalendarForm submitLabel="Confirmer" disabled={ui.busy || !preview || Boolean(error)} onCancel={onCancel} onSave={async () => {
    if (!preview || !event.canDeclareNotHeld) throw new Error('Actualisez le calendrier avant de continuer.')
    if (scope === 'future') {
      if (!event.canCancel || !event.seriesId || event.seriesRevision === null || status !== 'cancelled') throw new Error('Actualisez la série avant de continuer.')
      await ui.command({ action: 'appointments.cancel', id: event.id, data: { expectedVersion: preview.version, scope, expectedSeriesRevision: event.seriesRevision, reason, feePercent: 0 } })
    } else await ui.command({ action: 'appointments.not-held', id: event.id, data: { expectedVersion: preview.version, previewHash: preview.hash, confirmed: true, status, reason: status === 'cancelled' ? reason : null, feePercent: selectedFee } })
    return () => ui.selectEvent(null)
  }}>
    <h4 className="font-semibold">Rencontre annulée ou client absent</h4>
    {!preview && !error && <p role="status">Vérification des documents liés…</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
    <Field label="Résultat de la rencontre"><select className={inputClass} value={status} onChange={e => { setStatus(e.target.value as typeof status); setFee(0); setScope('occurrence') }}><option value="cancelled">Rencontre annulée</option><option value="no_show" disabled={Date.parse(event.startAt) > Date.parse(ui.data.currentTime)}>Client absent</option></select></Field>
    {status === 'cancelled' && event.status === 'planned' && event.seriesId && event.canCancel && <Field label="Rendez-vous à annuler"><select className={inputClass} value={scope} onChange={e => { setScope(e.target.value as typeof scope); setFee(0) }}><option value="occurrence">Ce rendez-vous seulement</option><option value="future">Ce rendez-vous et les suivants planifiés, sans frais</option></select></Field>}
    {status === 'cancelled' && <Field label="Origine de l’annulation"><select className={inputClass} value={reason} onChange={e => { setReason(e.target.value as typeof reason); setFee(0) }}><option value="client">À la demande du client</option><option value="professional">À la demande du professionnel</option><option value="clinic">À la demande de la clinique</option></select></Field>}
    <Field label="Frais à facturer au client"><select className={inputClass} value={selectedFee} onChange={e => setFee(Number(e.target.value) as CalendarFeePercent)}>{choices.map(value => <option key={value} value={value}>{value === 0 ? 'Ne pas facturer' : `Facturer ${value} % selon les conditions acceptées`}</option>)}</select></Field>
    {choices.length === 1 && <p className="text-sm">Aucun frais n’est applicable selon les conditions enregistrées et l’origine de l’annulation.</p>}
    {preview && <div className="grid gap-2 text-sm">
      {preview.noteCount > 0 && <p>La note clinique reste visible avec une mention d’annulation ou d’absence. Le texte signé reste inchangé.</p>}
      {preview.invoiceCount > 0 && <p>La facture actuelle sera annulée et les autres rencontres seront reprises dans une nouvelle facture à vérifier. Les frais choisis seront repris par la facturation. Aucun crédit automatique.</p>}
      {preview.paidInvoiceCount > 0 && <p className="text-amber-900">Un paiement existe déjà. Il restera conservé et devra être vérifié par la Direction ou l’administration.</p>}
      <p>{scope === 'future' ? 'Ce rendez-vous et les suivants encore planifiés seront annulés, sans frais. Les rencontres déjà réalisées restent inchangées.' : 'Cette action concerne uniquement cette rencontre.'} Aucun courriel ni paiement ne sera déclenché.</p>
    </div>}
  </CalendarForm>
}
