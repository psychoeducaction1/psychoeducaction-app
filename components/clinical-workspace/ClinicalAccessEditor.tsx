'use client'

import { useState } from 'react'
import { canAdmin, hasCapability } from '@/lib/clinical-core/capabilities'
import { buttonClass } from '@/components/Ui'
import type { ClinicalRecordSummary, RecordGrant, WorkspaceView } from '@/lib/clinical-core/types'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { clinicalInput, clinicalLabel } from './styles'
import { useClinicalFormGuard, useClinicalNavigation } from './NavigationGuard'

export function ClinicalAccessEditor({ record, workspace, onUpdated }: {
  record: ClinicalRecordSummary; workspace: WorkspaceView; onUpdated: () => Promise<void>
}) {
  const navigation = useClinicalNavigation()
  const clinicians = workspace.actors.filter(actor => hasCapability(actor, 'practice') || hasCapability(actor, 'supervision'))
  const [members, setMembers] = useState<RecordGrant[]>(() => structuredClone(record.members.filter(member => member.canRead)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  useClinicalFormGuard(dirty, busy)
  const edit = (actorId: string, change: Partial<RecordGrant>) => setMembers(current => current.map(member => member.actorId === actorId ? { ...member, ...change } : member))
  const toggle = (actorId: string, enabled: boolean) => setMembers(current => enabled ? [...current, { actorId, canRead: true, canWrite: false, canCosign: false, requiresCosignature: false, supervisorId: null }] : current.filter(member => member.actorId !== actorId))
  if (!canAdmin(workspace.actor)) return null
  return <details className="mt-3 border-t border-[#eadfd2] pt-3"><summary className="cursor-pointer text-sm font-semibold text-[#805738]">Gérer les accès au dossier</summary>
    <form className="mt-4 grid gap-3" onChange={() => setDirty(true)} onSubmit={async event => {
      event.preventDefault(); if (busy) return
      for (const member of members) {
        if (member.requiresCosignature && !members.some(supervisor => supervisor.actorId === member.supervisorId && supervisor.canCosign)) { setError('Autorisez aussi la cosignature du superviseur désigné avant d’enregistrer.'); return }
      }
      const removed = record.members.some(previous => !members.some(next => next.actorId === previous.actorId && next.canRead))
      if (removed && !window.confirm('Retirer ces accès cliniques ? Les notes restent conservées. Les brouillons ou cosignatures dépendant de ces accès pourront être bloqués.')) return
      setBusy(true); setError('')
      try { await clinicalRequest({ actorId: workspace.actor.id, context: workspace.context }, `/records/${record.id}/access`, { expectedRevision: record.grantRevision, members }, 'PATCH'); setDirty(false); await onUpdated() }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Mise à jour impossible.') }
      finally { setBusy(false) }
    }}>
      <p className="text-xs leading-5 text-[#8a6f5d]">Révision {record.grantRevision}. Seules les personnes cochées accèdent à ce dossier. Un droit administratif ne permet pas de lire ses notes.</p>
      <p className="text-xs leading-5 text-[#8a6f5d]">Une modification de supervision peut empêcher la signature des brouillons existants. Les notes signées et leur historique restent conservés.</p>
      {clinicians.map(actor => { const member = members.find(item => item.actorId === actor.id); return <fieldset key={actor.id} disabled={busy} className="grid gap-3 rounded-xl bg-[#f7f1e9] p-3 text-sm">
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={Boolean(member)} onChange={event => toggle(actor.id, event.target.checked)} />{actor.displayName}</label>
        {member && <div className="grid gap-3 pl-5">
          <p className="text-xs text-[#8a6f5d]">Lecture autorisée</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={member.canWrite} onChange={event => edit(actor.id, { canWrite: event.target.checked, ...(!event.target.checked ? { requiresCosignature: false, supervisorId: null } : {}) })} />Rédiger ses notes</label>
          {hasCapability(actor, 'supervision') && <label className="flex items-center gap-2"><input type="checkbox" checked={member.canCosign} onChange={event => edit(actor.id, { canCosign: event.target.checked })} />Cosigner les notes qui me sont confiées</label>}
          {member.canWrite && <label className={clinicalLabel}>Supervision de ses notes<select value={member.supervisorId ?? ''} className={clinicalInput} onChange={event => edit(actor.id, { requiresCosignature: Boolean(event.target.value), supervisorId: event.target.value || null })}><option value="">Sans cosignature obligatoire</option>{clinicians.filter(person => hasCapability(person, 'supervision') && person.id !== actor.id).map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label>}
        </div>}
      </fieldset> })}
      {!members.length && <p className="text-sm text-[#9a4c25]">Aucun accès clinique ne sera conservé. Les notes ne sont pas supprimées.</p>}
      {error && <div role="alert" className="text-sm text-red-700">{error}<button type="button" className="ml-2 underline" disabled={busy} onClick={async () => { if (await navigation.canLeave()) await onUpdated() }}>Recharger les autorisations</button></div>}
      <button className={buttonClass('secondary')} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer les autorisations'}</button>
    </form>
  </details>
}
