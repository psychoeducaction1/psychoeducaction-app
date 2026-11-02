'use client'

import { useEffect, useState } from 'react'
import { buttonClass, PageHeader } from '@/components/ui/index'
import { decimalProduct } from '@/lib/payrollDecimal'
import { supabase } from '@/lib/supabaseClient'
import { applyInvoiceEdit, editableInvoice, type InvoiceEdit } from '@/lib/payrollInvoiceEditor'
import type { PayrollInvoiceRecord } from '@/lib/payrollInvoiceRegistry'

type RecordWithOwner = PayrollInvoiceRecord & { professional_id: string }
const input = 'w-full rounded-lg border border-[#dfd0bf] bg-white p-2 text-sm'
const money = (n: number) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n)

export function PayrollInvoiceEditor({ invoiceId, onClose, onSaved }: { invoiceId?: string; onClose: () => void; onSaved?: (record: PayrollInvoiceRecord & { professional_id: string }) => void }) {
  const [record, setRecord] = useState<RecordWithOwner | null>(null)
  const [edit, setEdit] = useState<InvoiceEdit | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let canceled = false
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setMessage('Connectez-vous avec un compte autorisé à la paie.'); return }
      const id = invoiceId ?? new URLSearchParams(window.location.search).get('id') ?? ''
      const response = await fetch(`/api/direction/payroll-invoices?id=${encodeURIComponent(id)}&current=1`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      const payload = await response.json()
      if (canceled) return
      if (!response.ok) throw new Error(payload.error)
      setRecord(payload.record); setEdit(editableInvoice(payload.record.snapshot.invoice))
    })().catch(error => { if (!canceled) setMessage(error instanceof Error ? error.message : 'Chargement impossible.') })
    return () => { canceled = true }
  }, [invoiceId])
  let total: number | null = null
  try { if (record?.snapshot && edit) total = applyInvoiceEdit(record.snapshot.invoice, edit).grandTotal } catch { /* Validation displayed before saving. */ }
  const update = (index: number, changes: Partial<InvoiceEdit['lines'][number]>) => setEdit(current => current && ({ ...current, lines: current.lines.map((line, i) => i === index ? { ...line, ...changes } : line) }))
  const save = async () => {
    if (!record?.snapshot || !edit) return
    setBusy(true); setMessage('')
    try {
      applyInvoiceEdit(record.snapshot.invoice, edit)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Session expirée.')
      const response = await fetch('/api/direction/payroll-invoices', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
        professionalId: record.professional_id, period: record.snapshot.period, action: 'revise', expectedVersion: record.version, reason, edit,
      }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      const saved = { ...payload.record, professional_id: record.professional_id }
      setRecord(saved); setEdit(editableInvoice(payload.record.snapshot.invoice)); onSaved?.(saved)
      setReason(''); setMessage('Facture remplacée. Le numéro et la période sont conservés. Aucun courriel envoyé.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Enregistrement impossible.') }
    finally { setBusy(false) }
  }
  const download = async () => {
    if (!record) return
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Session expirée.')
      const response = await fetch(`/api/direction/payroll-invoices?id=${record.id}&version=${record.version}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (!response.ok) throw new Error('Téléchargement impossible. Rechargez la facture courante.')
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a')
      link.href = url; link.download = `Facture-${record.number}.docx`; link.click(); URL.revokeObjectURL(url)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Téléchargement impossible.') }
    finally { setBusy(false) }
  }
  return <main className="mx-auto max-w-6xl space-y-5 p-6 text-[#332820]">
    <PageHeader title="Rectifier la facture" description="Modifiez les postes puis vérifiez le total avant de remplacer la facture courante." />
    <button id="payroll-invoice-editor-close" type="button" onClick={onClose} className="underline">Retour à la paie</button>
    {message && <p role="status" className="rounded-xl bg-[#fbf1e7] p-4">{message}</p>}
    {record?.snapshot && edit && <fieldset disabled={busy} className="space-y-5">
      <div className="rounded-xl border border-[#dfd0bf] bg-white p-4"><strong>{record.number} — {record.snapshot.invoice.professional.fullName}</strong>
        <p>Du {record.snapshot.period.startDate} au {record.snapshot.period.endDate}</p>
        <p className="mt-2 text-sm">L’enregistrement remplace l’ancienne facture. Aucune ancienne signature n’est reprise. Les activités sources, contrats et paiements ne sont pas modifiés.</p>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Description', 'Quantité', 'Unité', 'Prix unitaire ($)', 'Annulation', 'Total', ''].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{edit.lines.map((line, i) => <tr key={i}>
          <td className="min-w-48 p-2"><input aria-label={`Description ${i + 1}`} className={input} value={line.label} maxLength={200} onChange={e => update(i, { label: e.target.value })} /></td>
          <td className="p-2"><input aria-label={`Quantité ${i + 1}`} type="number" min="0.01" step="0.01" className={input} value={decimalProduct(line.quantity, 1)} onChange={e => update(i, { quantity: Number(e.target.value) })} /></td>
          <td className="p-2"><select aria-label={`Unité ${i + 1}`} className={input} value={line.unit} onChange={e => update(i, { unit: e.target.value as 'h' | 'élément' })}><option value="élément">rencontre / unité</option><option value="h">heure</option></select></td>
          <td className="p-2"><input aria-label={`Prix unitaire ${i + 1}`} type="number" min="0" step="any" className={input} value={line.unitPay} onChange={e => update(i, { unitPay: Number(e.target.value) })} /></td>
          <td className="p-2"><input aria-label={`Annulation ${i + 1}`} type="checkbox" checked={Boolean(line.cancellation)} onChange={e => update(i, { cancellation: e.target.checked, unit: 'élément' })} /></td>
          <td className="p-2">{money(decimalProduct(line.quantity, line.unitPay))}</td>
          <td><button type="button" aria-label={`Supprimer la ligne ${i + 1}`} onClick={() => setEdit({ ...edit, lines: edit.lines.filter((_, index) => index !== i) })}>Supprimer</button></td>
        </tr>)}</tbody></table></div>
      <button type="button" className={buttonClass('secondary')} onClick={() => setEdit({ ...edit, lines: [...edit.lines, { label: 'Rencontre', quantity: 1, unitPay: 0, unit: 'élément' }] })}>Ajouter une ligne</button>
      <label className="block max-w-xs">Déplacement ($)<input type="number" min="0" step="0.01" className={input} value={edit.travelFeesTotal} onChange={e => setEdit({ ...edit, travelFeesTotal: Number(e.target.value) })} /></label>
      <p className="text-xs">Quantités affichées arrondies à deux décimales; totaux calculés avant cet arrondi.</p>
      <p className="text-xl font-semibold">Total : {total === null ? 'Vérifiez les quantités et les montants' : money(total)}</p>
      <label className="block">Motif de la correction<textarea className={input} minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || total === null || reason.trim().length < 10} className={buttonClass('primary')} onClick={() => void save()}>{busy ? 'Traitement…' : 'Enregistrer et remplacer la facture'}</button>
        <button type="button" className={buttonClass('secondary')} onClick={() => void download()}>Télécharger la facture enregistrée</button></div>
    </fieldset>}
  </main>
}
