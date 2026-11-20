'use client'
import { useEffect, useState } from 'react'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import type { DurableCalendarEvent } from '@/lib/clinical-calendar/durableTypes'
import type { CalendarUi } from './primitives'
export type EncounterCorrectionPreview = { appointmentId: string; version: number; hash: string; noteCount: number; invoiceCount: number }
export function useEncounterCorrection(event: DurableCalendarEvent | undefined, ui: CalendarUi) {
  const [preview, setPreview] = useState<EncounterCorrectionPreview | null>(null)
  const [error, setError] = useState('')
  const actorId = ui.data.actorId, context = ui.data.context, id = event?.status === 'completed' ? event.id : null, version = event?.version
  useEffect(() => {
    setPreview(null); setError('')
    if (!id) return
    const abort = new AbortController()
    void clinicalRequest<EncounterCorrectionPreview>({ actorId, context }, '/calendar/correction-preview/' + id, undefined, 'GET', abort.signal)
      .then(p => { if (abort.signal.aborted) return; if (p.appointmentId !== id || p.version !== version || !/^[a-f0-9]{64}$/.test(p.hash) || ![p.noteCount, p.invoiceCount].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('La rencontre a changé. Actualisez le calendrier.'); setPreview(p) })
      .catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Vérification impossible.') })
    return () => abort.abort()
  }, [actorId, context, id, version])
  return { preview, error }
}
