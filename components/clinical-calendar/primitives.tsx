'use client'

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { buttonClass } from '@/components/Ui'
import { useClinicalFormGuard } from '@/components/clinical-workspace/NavigationGuard'
import { clinicalInput, clinicalLabel } from '@/components/clinical-workspace/styles'
import type { CalendarCommand, CalendarCommandAck, DurableCalendarWorkspace } from '@/lib/clinical-calendar/durableTypes'
import { calendarWriteErrorMessage, calendarWriteIsUncertain } from './formIntent'
export { clinicalInput as inputClass, clinicalLabel as labelClass }

export type CalendarUi = {
  data: DurableCalendarWorkspace; busy: boolean; administrative: boolean; clientContextId?: string
  command: (command: CalendarCommand) => Promise<CalendarCommandAck>
  selectEvent: (id: string | null) => Promise<void>
  invalidate?: (cause: unknown) => void
  openClient: (clientId: string) => Promise<void>
  openBilling: (clientId: string, activityId?: string, endAt?: string) => Promise<void>
  openNote: (recordId: string, clientId: string, appointmentId: string, noteId?: string) => Promise<void>
}
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={clinicalLabel + ' min-w-0'}>{label}{children}</label> }
export function Fold({ title, children }: { title: string; children: ReactNode }) { return <details className="rounded-xl border border-[#eadfd2] bg-white p-4"><summary className="cursor-pointer font-semibold">{title}</summary><div className="mt-4">{children}</div></details> }
export type CalendarFormHandle = { requestCancel: () => void }
export function CalendarForm({ children, submitLabel, onSave, onSaved, disabled = false, onCancel, formRef, changed = false }: {
  children: ReactNode; submitLabel: string; onSave: (form: HTMLFormElement) => Promise<void | (() => void | Promise<void>)>
  onSaved?: () => void | Promise<void>; disabled?: boolean; onCancel?: () => void | Promise<void>; formRef?: Ref<CalendarFormHandle>; changed?: boolean
}) {
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false), [discard, setDiscard] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const retained = useRef<{ save: typeof onSave; form: HTMLFormElement } | null>(null), operation = useRef(false), discardRef = useRef<HTMLElement>(null)
  useEffect(() => { if (discard) discardRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [discard])
  const effectiveDirty = dirty || (changed && !saved)
  const guard = useClinicalFormGuard(effectiveDirty, busy || uncertain)
  const cancel = useCallback(async () => {
    guard.markSaved(); setDirty(false); setDiscard(false)
    try { await onCancel?.() } catch (cause) { setError(cause instanceof Error ? cause.message : 'La fermeture n’a pas pu être confirmée.') }
  }, [guard, onCancel])
  const requestCancel = useCallback(() => {
    if (!onCancel) return
    if (operation.current || uncertain) { setError('Le résultat de l’enregistrement reste à confirmer. Reprenez la même opération avant de fermer.'); return }
    if (effectiveDirty) setDiscard(true)
    else void cancel()
  }, [cancel, effectiveDirty, onCancel, uncertain])
  useImperativeHandle(formRef, () => ({ requestCancel }), [requestCancel])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (operation.current || disabled || discard) return
    const intent = retained.current ?? { save: onSave, form: event.currentTarget }
    retained.current = intent; operation.current = true
    guard.markPending(); setBusy(true); setError(''); setSaved(false)
    try {
      const afterSave = await intent.save(intent.form)
      retained.current = null; setUncertain(false); guard.markSaved(); setDirty(false); setBusy(false); setSaved(true)
      try { if (afterSave) await afterSave(); await onSaved?.() }
      catch { setError('Enregistrement confirmé. L’ouverture suivante est indisponible ; actualisez sans réémettre la commande.') }
    } catch (cause) {
      const unknown = calendarWriteIsUncertain(cause)
      if (!unknown) retained.current = null
      setUncertain(unknown); setError(calendarWriteErrorMessage(cause))
    } finally { operation.current = false; guard.markSettled(); setBusy(false) }
  }
  return <form className="grid gap-4" onSubmit={submit} onChange={() => { setDirty(true); setSaved(false) }}><fieldset disabled={busy || disabled || discard} inert={uncertain || undefined} className="grid min-w-0 gap-4">{children}</fieldset>{uncertain && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Résultat non confirmé : la saisie est figée. Réessayez exactement la même opération ; sa clé de reprise évite un doublon.</p>}{error && <p role="alert" className="text-sm text-red-800">{error}</p>}{saved && <p role="status" className="text-sm text-green-800">Enregistrement confirmé dans la base locale.</p>}
    {discard ? <section ref={discardRef} role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold">Quitter sans enregistrer ces modifications ?</p><p className="mt-1 text-sm">Les changements de ce formulaire seront abandonnés.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClass('secondary')} onClick={() => setDiscard(false)}>Revenir au formulaire</button><button type="button" className={buttonClass('primary')} onClick={() => void cancel()}>Abandonner et fermer</button></div></section>
      : <div className={onCancel ? 'sticky bottom-0 -mx-1 flex flex-wrap justify-end gap-2 border-t border-[#eadfd2] bg-[#fffdf9] px-1 pt-4' : ''}>{onCancel && <button type="button" className={buttonClass('secondary')} disabled={busy || uncertain} onClick={requestCancel}>Annuler</button>}<button type="submit" className={buttonClass('primary')} disabled={busy || disabled}>{busy ? 'Enregistrement…' : uncertain ? 'Réessayer la même opération' : submitLabel}</button></div>}
  </form>
}
export function readString(form: HTMLFormElement, key: string) { return String(new FormData(form).get(key) ?? '').trim() }
