'use client'

import { useState } from 'react'
import { Badge, buttonClass } from '@/components/ui/index'

export function ProspectTestControls({ prospect, authenticatedFetch, onUpdated, onDeleted }: {
  prospect: { id: string; first_name: string; last_name: string; is_test?: boolean; waiting_list_client_id: string | null; status: string }
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>
  onUpdated: () => Promise<void>
  onDeleted: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [confirmedTest, setConfirmedTest] = useState(false)
  const transferred = Boolean(prospect.waiting_list_client_id) || prospect.status === 'transferred_to_waiting_list'

  if (typeof prospect.is_test !== 'boolean') {
    return <p className="mt-6 border-t border-[#eadfd2] pt-5 text-sm text-[#7a6859]">La gestion des dossiers de test est indisponible. Contactez l’administrateur.</p>
  }

  const mark = async () => {
    if (!window.confirm(prospect.is_test ? 'Retirer le marquage de test de ce dossier?' : 'Confirmez-vous que ce dossier contient uniquement des données fictives de test?')) return
    setSaving(true); setError('')
    try {
      const response = await authenticatedFetch(`/api/direction/prospects/${prospect.id}/test-status`, {
        method: 'POST', body: JSON.stringify({ confirmed: true, isTest: !prospect.is_test }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Marquage impossible.')
      setShowConfirmation(false); setConfirmation(''); setConfirmedTest(false)
      await onUpdated()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Marquage impossible.')
    } finally { setSaving(false) }
  }

  const remove = async () => {
    if (confirmation !== 'SUPPRIMER' || !confirmedTest || !prospect.is_test || transferred) return
    setSaving(true); setError('')
    try {
      const response = await authenticatedFetch(`/api/direction/prospects/${prospect.id}`, {
        method: 'DELETE', body: JSON.stringify({ confirmed: true }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Suppression impossible.')
      await onDeleted()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Suppression impossible.')
    } finally { setSaving(false) }
  }

  return <section className="mt-6 border-t border-[#eadfd2] pt-5">
    <div className="flex items-center gap-2"><h3 className="font-semibold text-[#332820]">Dossier de test</h3>{prospect.is_test && <Badge tone="muted">Test</Badge>}</div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {transferred ? <p className="mt-2 text-sm text-[#7a6859]">La suppression est bloquée pour un dossier transféré vers la liste d’attente.</p> : <>
      <button type="button" disabled={saving} className={`${buttonClass('secondary')} mt-3`} onClick={() => void mark()}>{prospect.is_test ? 'Retirer le marquage de test' : 'Marquer comme dossier de test'}</button>
      {prospect.is_test && <button type="button" disabled={saving} className={`${buttonClass('danger')} mt-3 ml-2`} onClick={() => { setShowConfirmation(true); setConfirmation(''); setConfirmedTest(false) }}>Supprimer ce dossier de test</button>}
      {showConfirmation && prospect.is_test && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="font-semibold text-red-800">Supprimer définitivement : {prospect.first_name} {prospect.last_name}</p>
        <p className="mt-2 text-sm text-red-800">Le prospect, ses rendez-vous, leurs événements, les demandes liées et les tâches de rappel avec leurs notes seront supprimés. Une trace d’audit sera conservée.</p>
        <label className="mt-3 flex gap-2 text-sm text-red-800"><input type="checkbox" checked={confirmedTest} onChange={(event) => setConfirmedTest(event.target.checked)} />Je confirme que ce dossier contient uniquement des données fictives.</label>
        <label className="mt-3 block text-sm font-semibold text-red-800">Saisissez SUPPRIMER pour confirmer<input autoComplete="off" className="mt-2 w-full rounded-xl border border-red-200 bg-white px-3 py-2" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={saving} className={buttonClass('secondary')} onClick={() => setShowConfirmation(false)}>Annuler</button><button type="button" disabled={saving || confirmation !== 'SUPPRIMER' || !confirmedTest} className={buttonClass('danger')} onClick={() => void remove()}>Confirmer la suppression</button></div>
      </div>}
    </>}
  </section>
}
