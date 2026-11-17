'use client'

import { useEffect, useState } from 'react'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import type { DurableCalendarEvent } from '@/lib/clinical-calendar/durableTypes'
import { CalendarForm, type CalendarUi } from './primitives'

type Preview = { appointmentId: string; version: number; hash: string; noteCount: number; signedNoteCount: number; invoiceCount: number; paidInvoiceCount: number; replacementInvoiceCount: number }
function valid(value: unknown, event: DurableCalendarEvent): value is Preview {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return p.appointmentId === event.id && p.version === event.version && typeof p.hash === 'string' && /^[a-f0-9]{64}$/.test(p.hash)
    && ['noteCount','signedNoteCount','invoiceCount','paidInvoiceCount','replacementInvoiceCount'].every(key => Number.isSafeInteger(p[key]) && Number(p[key]) >= 0 && Number(p[key]) <= 10000)
}
export function EncounterRemoval({ event, ui, onCancel }: { event: DurableCalendarEvent; ui: CalendarUi; onCancel: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    void clinicalRequest<unknown>({ actorId: ui.data.actorId, context: ui.data.context }, `/calendar/removal-preview/${event.id}`, undefined, 'GET', abort.signal)
      .then(value => { if (!abort.signal.aborted) { if (!valid(value, event)) throw new Error('La rencontre a changé. Actualisez le calendrier.'); setPreview(value) } })
      .catch(cause => { if (!abort.signal.aborted) { ui.invalidate?.(cause); setError(cause instanceof Error ? cause.message : 'Impossible de préparer la suppression.') } })
    return () => abort.abort()
  }, [event, ui])
  return <CalendarForm submitLabel="Confirmer la suppression" disabled={ui.busy || !preview || Boolean(error)} onCancel={onCancel} onSave={async () => {
    if (!preview) throw new Error('Actualisez le calendrier avant de continuer.')
    await ui.command({ action: 'appointments.remove', id: event.id, data: { expectedVersion: preview.version, previewHash: preview.hash, confirmed: true } })
    return () => ui.selectEvent(null)
  }}>
    <h4 className="font-semibold">Supprimer cette rencontre ?</h4>
    {!preview && !error && <p role="status">Vérification de la rencontre…</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {preview && <div className="space-y-2 text-sm">
      {preview.noteCount > 0 && <p className="font-medium text-red-800">{preview.noteCount === 1 ? 'La note clinique associée sera également supprimée, même si elle est signée.' : `Les ${preview.noteCount} notes cliniques associées seront également supprimées, même si elles sont signées.`}</p>}
      {preview.invoiceCount > 0 && <p>{preview.invoiceCount === 1 ? 'La facture associée sera annulée.' : 'Les factures associées seront annulées.'} Aucun crédit ne sera créé.</p>}
      {preview.replacementInvoiceCount > 0 && <p>Un nouveau brouillon de facture sera préparé pour les autres rencontres, sans envoi.</p>}
      {preview.paidInvoiceCount > 0 && <p className="text-amber-900">Un paiement est déjà enregistré. La Direction ou un administrateur devra le vérifier avant de finaliser la nouvelle facture.</p>}
      <p>Cette action concerne uniquement cette rencontre. Aucun courriel ne sera envoyé.</p>
    </div>}
  </CalendarForm>
}
