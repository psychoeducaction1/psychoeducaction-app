'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { buttonClass } from '@/components/Ui'
import { clinicalInput, clinicalLabel } from '@/components/clinical-workspace/styles'
import { useClinicalFormGuard } from '@/components/clinical-workspace/NavigationGuard'
import type { MandateAck, MandateCommand, MandateWorkspace } from '@/lib/clinical-mandates/types'
export { clinicalInput as inputClass, clinicalLabel as labelClass }
export type MandateUi = { data: MandateWorkspace; busy: boolean; command: (command: MandateCommand) => Promise<MandateAck>; select: (patch: Record<string, string | null>) => Promise<void>; invalidate: (cause: unknown) => void }
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={clinicalLabel}>{label}{children}</label> }
export function Fold({ title, children }: { title: string; children: ReactNode }) { return <details className="rounded-xl border border-[#eadfd2] bg-white p-4"><summary className="cursor-pointer font-semibold">{title}</summary><div className="mt-4">{children}</div></details> }
export function MandateForm({ children, submitLabel, onSave, disabled = false, trackChanges = true }: { children: ReactNode; submitLabel: string; onSave: (form: HTMLFormElement) => Promise<void | (() => void | Promise<void>)>; disabled?: boolean; trackChanges?: boolean }) {
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const guard = useClinicalFormGuard(dirty, busy)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || disabled) return
    guard.markPending(); setBusy(true); setError(''); setSaved(false)
    try { const after = await onSave(event.currentTarget); guard.markSaved(); setDirty(false); setBusy(false); setSaved(true); if (after) await after() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Écriture non confirmée ; saisie conservée.') }
    finally { guard.markSettled(); setBusy(false) }
  }
  return <form className="grid gap-4" onSubmit={submit} onChange={() => { if (trackChanges) setDirty(true); setSaved(false) }}><fieldset disabled={busy || disabled} className="grid min-w-0 gap-4">{children}</fieldset>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}{saved && <p role="status" className="text-sm text-green-800">Écriture confirmée dans la base fictive.</p>}<button className={buttonClass('primary')} disabled={busy || disabled}>{busy ? 'Confirmation…' : submitLabel}</button></form>
}
export function read(form: HTMLFormElement, name: string) { return String(new FormData(form).get(name) ?? '').trim() }
