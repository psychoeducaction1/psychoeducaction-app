'use client'

import { clinicalUiText } from '@/lib/clinical-workspace/presentationText'
import { useEffect, useState } from 'react'
import type { ClinicalActorInput } from '@/lib/clinical-core/types'
import { loadBillingReminderPolicy, saveBillingReminderPolicy, type BillingReminderPolicy } from '@/lib/clinical-finance/durableClient'
import { buttonClass } from '@/components/Ui'
import type { DurableBillingCommand, DurableBillingWorkspace } from '@/lib/clinical-finance/durableTypes'
import { BillingForm, Field, Fold, inputClass, read } from './primitives'
import { dateLabel } from './model'

export function BillingReminderSettings({ actor }: { actor: ClinicalActorInput }) {
  const [policy, setPolicy] = useState<BillingReminderPolicy | null>(null)
  const [firstDays, setFirstDays] = useState(5)
  const [secondDays, setSecondDays] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void loadBillingReminderPolicy(actor, controller.signal).then(value => {
      if (!controller.signal.aborted) { setPolicy(value); setFirstDays(value.firstDays); setSecondDays(value.secondDays) }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Paramètres indisponibles.') })
    return () => controller.abort()
  }, [actor])
  return <section className="rounded-xl border border-[#dfd0bf] bg-white p-5">
    <h3 className="font-semibold">Rappels de paiement</h3>
    <p className="mt-2 text-sm">{clinicalUiText("Délais calculés depuis chaque rencontre, par défaut après 5 et 10 jours. Les rappels du laboratoire restent simulés.","Délais calculés depuis chaque rencontre, par défaut après 5 et 10 jours. Les rappels présentés comme simulés ne sont pas envoyés.")}</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {!policy && !error && <p role="status" className="mt-3 text-sm">Chargement…</p>}
    {policy && <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault()
      if (!Number.isInteger(firstDays) || !Number.isInteger(secondDays) || firstDays < 1 || secondDays > 90 || firstDays >= secondDays) { setError('Indiquez deux délais croissants entre 1 et 90 jours.'); return }
      setBusy(true); setError('')
      void saveBillingReminderPolicy(actor, { firstDays, secondDays, version: policy.version })
        .then(value => { setPolicy(value); setFirstDays(value.firstDays); setSecondDays(value.secondDays) })
        .catch(cause => setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.'))
        .finally(() => setBusy(false))
    }}>
      <label className="grid gap-1 text-sm">Premier rappel, en jours<input className={inputClass} type="number" min={1} max={89} required value={firstDays} onChange={event => setFirstDays(Number(event.target.value))} /></label>
      <label className="grid gap-1 text-sm">Deuxième rappel, en jours<input className={inputClass} type="number" min={2} max={90} required value={secondDays} onChange={event => setSecondDays(Number(event.target.value))} /></label>
      <button className={buttonClass('primary')} disabled={busy || firstDays === policy.firstDays && secondDays === policy.secondDays}>Enregistrer les délais</button>
    </form>}
  </section>
}

export function AutomaticBillingSettings({ data, busy, run }: {
  data: DurableBillingWorkspace
  busy: boolean
  run: (command: DurableBillingCommand) => Promise<unknown>
}) {
  return <Fold title={data.mode === 'isolated_unified' ? 'Création automatique des factures' : 'Préparation automatique et reprise manuelle'} open>
    <p className="text-sm">Après la fin d’une rencontre facturable, sa part s’ajoute à la facture ouverte du payeur, selon l’heure de Toronto. Fermer la facture, l’envoyer ou enregistrer un paiement lui attribue un numéro et produit son PDF; aucun courriel n’est envoyé automatiquement.</p>
    <p className="mt-2 text-xs text-[#8a6f5d]">Dernier passage : {data.automaticPreparation.lastRunAt ? dateLabel(data.automaticPreparation.lastRunAt) : 'Pas encore de passage confirmé'} · {data.automaticPreparation.preparedCount} {data.automaticPreparation.mode === 'on_load' ? 'rencontre(s) préparée(s) lors du chargement' : data.automaticPreparation.mode === 'scheduled' ? 'rencontre(s) préparée(s) au dernier passage' : 'part(s) préparée(s) automatiquement au total'}.</p>
    <p className="mt-2 text-sm">{data.allocationRule}</p>
    {data.automaticPreparation.mode === 'on_load' && <p className="mt-2 text-sm">Les rencontres admissibles sont préparées dès le lendemain, à l’ouverture ou à l’actualisation de cette page.</p>}
    {data.automaticPreparation.mode === 'scheduled' && <p className="mt-2 text-sm">{data.mode === 'isolated_unified' ? 'Le traitement en arrière-plan crée les factures après la fin des rencontres facturables, environ toutes les cinq minutes.' : 'Le traitement en arrière-plan prépare les rencontres admissibles dès le lendemain, selon la date de Toronto.'} Le dernier passage confirmé est indiqué ci-dessus; aucun courriel n’est envoyé par ce traitement.</p>}
    {data.mode !== 'isolated_unified' && <div className="mt-4"><BillingForm build={form => ({ action: 'batch.prepare', data: { throughDate: read(form, 'throughDate') } }) as DurableBillingCommand} execute={run} disabled={busy} submitLabel="Vérifier les rencontres à facturer">
      <Field label="Reprendre la préparation jusqu’à cette date"><input type="date" name="throughDate" required max={data.currentDate} defaultValue={data.currentDate} className={inputClass} /></Field>
      <p className="text-xs text-[#8a6f5d]">La reprise est idempotente. Une part déjà créée pour la même prestation et le même payeur reste unique.</p>
    </BillingForm></div>}
  </Fold>
}
