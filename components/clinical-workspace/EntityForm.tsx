'use client'

import { useState, type FormEvent } from 'react'
import { buttonClass } from '@/components/Ui'
import { clinicalInput, clinicalLabel } from './styles'
import { useClinicalFormGuard } from './NavigationGuard'

export type FormField = { name: string; label: string; type?: 'text' | 'email' | 'date' | 'checkbox' | 'select' | 'textarea'; required?: boolean; includeEmpty?: boolean; options?: { value: string; label: string }[]; defaultValue?: string; maxLength?: number }

export function EntityForm({ fields, submitLabel, onSubmit, resetAfterSubmit = true }: { fields: FormField[]; submitLabel: string; onSubmit: (values: Record<string, unknown>) => Promise<void>; resetAfterSubmit?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  useClinicalFormGuard(dirty, busy)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    const values: Record<string, unknown> = {}
    for (const field of fields) {
      if (field.type === 'checkbox') values[field.name] = data.get(field.name) === 'on'
      else { const value = String(data.get(field.name) ?? '').trim(); if (value || field.required || field.includeEmpty) values[field.name] = value }
    }
    setBusy(true); setError(''); setSaved(false)
    try { await onSubmit(values); if (resetAfterSubmit) form.reset(); setSaved(true); setDirty(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit} onChange={() => { setDirty(true); setSaved(false) }} className="grid gap-3">
    {fields.map(field => field.type === 'checkbox' ? <label key={field.name} className="flex items-start gap-2 text-sm text-[#6c5a4d]">
      <input name={field.name} type="checkbox" className="mt-1" disabled={busy} />{field.label}
    </label> : <label key={field.name} className={clinicalLabel}>{field.label}
      {field.type === 'select' ? <select name={field.name} required={field.required} defaultValue={field.defaultValue ?? ''} className={clinicalInput} disabled={busy}>
        <option value="">Choisir…</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select> : field.type === 'textarea' ? <textarea name={field.name} required={field.required} defaultValue={field.defaultValue} rows={3} maxLength={field.maxLength ?? 2000} className={clinicalInput} disabled={busy} />
        : <input name={field.name} type={field.type ?? 'text'} required={field.required} defaultValue={field.defaultValue} maxLength={field.maxLength ?? 150} className={clinicalInput} disabled={busy} />}
    </label>)}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {saved && <p role="status" className="text-sm text-[#456146]">Enregistré.</p>}
    <button className={`${buttonClass('secondary')} justify-center`} disabled={busy}>{busy ? 'Enregistrement…' : submitLabel}</button>
  </form>
}
