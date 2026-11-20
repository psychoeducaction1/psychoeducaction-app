'use client'

import { useRef, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import type { DurableCalendarEvent } from '@/lib/clinical-calendar/durableTypes'
import { isOpeningFeeActivity, type OpeningFeeActivity } from '@/lib/clinical-calendar/openingFee'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import type { CalendarUi } from './primitives'

const cad = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' })

export function AdvanceOpeningFee({ event, ui }: { event: DurableCalendarEvent; ui: CalendarUi }) {
  const [prepared, setPrepared] = useState<OpeningFeeActivity | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const activity = event.openingFeeActivity ?? prepared
  if (!ui.administrative || !ui.openInvoice || event.openingFeeActivity === undefined || !event.canRemove ||
    event.kind !== 'meeting' || !event.clientId || !event.caseId) return null
  const canPrepare = event.status === 'planned' && event.billable && Date.parse(event.startAt) > Date.parse(ui.data.currentTime)
  if (!activity && !canPrepare) return null

  const prepare = async () => {
    if (pending.current || !window.confirm('Créer une facture séparée pour les frais d’ouverture de dossier ? L’envoi se confirme ensuite depuis cette facture.')) return
    pending.current = true; setBusy(true); setError('')
    try {
      setPrepared(await clinicalRequest<OpeningFeeActivity>({ actorId: ui.data.actorId, context: 'administration' },
        '/billing/advance-opening-fee', { appointmentId: event.id, expectedVersion: event.version }, 'POST', undefined, undefined, isOpeningFeeActivity))
      await ui.refresh?.()
    } catch (cause) {
      ui.invalidate?.(cause)
      setError(cause instanceof Error ? cause.message : 'La création de la facture reste à vérifier.')
    } finally { pending.current = false; setBusy(false) }
  }
  return <section className="rounded-xl border p-3 text-sm" aria-label="Activité de facturation">
    <h4 className="font-semibold">Frais d’ouverture de dossier</h4>
    {error && <p role="alert" className="mt-2 text-red-800">{error}</p>}
    {activity ? <><p className="mt-2">{cad.format(activity.totalCents / 100)}</p><ul className="mt-2 flex flex-wrap gap-2">
      {activity.invoices.map(invoice => <li key={invoice.id}><button type="button" className={buttonClass('secondary')} disabled={invoice.voided}
        onClick={() => void ui.openInvoice?.(invoice.id, event.clientId!)}>{invoice.voided ? 'Facture annulée' : 'Ouvrir la facture'} no {invoice.number}</button></li>)}
    </ul></> : <button type="button" className={buttonClass('secondary') + ' mt-2'} disabled={ui.busy || busy}
      onClick={() => void prepare()}>{busy ? 'Création…' : 'Créer la facture de frais d’ouverture'}</button>}
  </section>
}
