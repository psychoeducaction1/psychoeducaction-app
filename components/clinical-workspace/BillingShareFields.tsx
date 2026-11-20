'use client'

import { Field, inputClass } from '@/components/clinical-calendar/primitives'
import type { BillingShare } from '@/lib/clinical-workspace/billingShares'

export function BillingShareFields({ share, others, onShare, onOther, primaryDisabled = false }: {
  share: number; others: BillingShare[]; onShare: (value: number) => void; onOther: (id: string, value: number) => void; primaryDisabled?: boolean
}) {
  const total = share + others.reduce((sum, row) => sum + row.basisPoints, 0)
  return <fieldset className="grid gap-3 rounded-xl bg-[#f7f1e9] p-3 text-sm">
    <legend className="font-semibold">Répartition de la facturation</legend>
    <Field label="Part des honoraires (%)"><input className={inputClass} type="number" min="0" max="100" step="0.01" required disabled={primaryDisabled} value={share / 100} onChange={event => onShare(Math.round(Number(event.target.value) * 100))} /></Field>
    {others.map(row => <Field key={row.personId} label={`Part de ${row.name} (%)`}><input className={inputClass} type="number" min="0" max="100" step="0.01" required value={row.basisPoints / 100} onChange={event => onOther(row.personId, Math.round(Number(event.target.value) * 100))} /></Field>)}
    <p role="status" className={total === 10000 ? 'text-[#456146]' : 'font-semibold text-red-700'}>Total : {(total / 100).toLocaleString('fr-CA')} % sur 100 %</p>
  </fieldset>
}
