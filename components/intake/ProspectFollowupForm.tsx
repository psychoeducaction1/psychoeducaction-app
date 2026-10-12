'use client'

import { useState } from 'react'
import { buttonClass } from '@/components/ui/index'
import { buildIntakeSlots, dateKeyInToronto, dateTimeInputToUtcInToronto, dateTimeInputValueInToronto } from '@/lib/publicIntakeSchedule'

export function ProspectFollowupForm({ prospectId, appointmentId, outcomeReason, authenticatedFetch, saving, onSavingChange, onCreated, onCancel }: {
  prospectId: string
  appointmentId: string | null
  outcomeReason: string
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>
  saving: boolean
  onSavingChange: (saving: boolean) => void
  onCreated: () => Promise<void>
  onCancel: () => void
}) {
  const [startAt, setStartAt] = useState(() => {
    const slot = buildIntakeSlots(dateKeyInToronto(new Date()), 7)[0]
    return slot ? dateTimeInputValueInToronto(new Date(slot.startAt)) : ''
  })
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [error, setError] = useState('')

  const create = async (submittedStartAt: string) => {
    onSavingChange(true); setError('')
    try {
      const response = await authenticatedFetch(`/api/direction/prospects/${prospectId}/appointments`, {
        method: 'POST', body: JSON.stringify({
          startAt: dateTimeInputToUtcInToronto(submittedStartAt).toISOString(),
          appointmentId, outcomeReason, idempotencyKey,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Réservation impossible.')
      await onCreated()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Réservation impossible.')
    } finally { onSavingChange(false) }
  }

  return <form className="mt-4 rounded-xl border border-[#d8b992] bg-[#fff8ef] p-4" onSubmit={(event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void create(String(form.get('startAt') ?? ''))
  }}>
    <h4 className="font-semibold text-[#332820]">Nouveau rendez-vous avec ce client</h4>
    <p className="mt-1 text-sm text-[#7a6859]">La précision et le nouveau rendez-vous seront enregistrés ensemble sur cette fiche.</p>
    <label className="mt-3 block text-sm font-semibold text-[#5d4a3d]">Date et heure (Toronto)
      <input name="startAt" type="datetime-local" required value={startAt} onChange={(event) => setStartAt(event.target.value)} onInput={(event) => setStartAt(event.currentTarget.value)} className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2" />
    </label>
    <p className="mt-2 text-xs text-[#8a6f5d]">Appel de 15 minutes. Créneaux aux 30 minutes, avec au moins deux heures de préavis.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" disabled={saving} onClick={onCancel} className={buttonClass('secondary')}>Annuler</button>
      <button type="submit" disabled={saving || !startAt || !outcomeReason.trim()} className={buttonClass('primary')}>{saving ? 'Enregistrement…' : 'Confirmer le nouveau rendez-vous'}</button>
    </div>
  </form>
}
