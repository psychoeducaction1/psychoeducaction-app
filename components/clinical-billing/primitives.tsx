'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { buttonClass } from '@/components/Ui'
import { useClinicalFormGuard } from '@/components/clinical-workspace/NavigationGuard'
import { clinicalCard, clinicalInput, clinicalLabel } from '@/components/clinical-workspace/styles'
import { createBillingFormIntent } from './model'

export { clinicalCard, clinicalInput as inputClass }
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={clinicalLabel}>{label}{children}</label> }
export function Fold({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) { return <details open={open || undefined} className={clinicalCard}><summary className="cursor-pointer font-semibold">{title}</summary><div className="mt-4">{children}</div></details> }
export function read(form: HTMLFormElement, name: string): string { return String(new FormData(form).get(name) ?? '').trim() }
type Review<C> = { command: C; message: string; details: ReactNode }

/** A confirmed snapshot is sent once; an uncertain write keeps that exact snapshot. */
export function BillingForm<C, A>({ children, build, execute, onConfirmed, submitLabel, secondarySubmitLabel, disabled = false, confirmation, confirmationDetails }: {
  children: ReactNode; build: (form: HTMLFormElement, choice: 'primary' | 'secondary') => C; execute: (command: C) => Promise<A>; onConfirmed?: (ack: A) => void | Promise<void>; submitLabel: string; secondarySubmitLabel?: string; disabled?: boolean; confirmation?: string; confirmationDetails?: (command: C) => ReactNode
}) {
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const [review, setReview] = useState<Review<C> | null>(null)
  const pending = useRef(createBillingFormIntent<C>()), operation = useRef(false), reviewRef = useRef<Review<C> | null>(null)
  const cancelButton = useRef<HTMLButtonElement>(null), confirmButton = useRef<HTMLButtonElement>(null), reviewId = useId()
  const guard = useClinicalFormGuard(dirty, busy || uncertain || review !== null)
  const cancelReview = useCallback(() => {
    if (operation.current || !reviewRef.current) return
    reviewRef.current = null; pending.current.cancel(); setReview(null); guard.markSettled()
  }, [guard])
  useEffect(() => {
    if (!review) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelButton.current?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); cancelReview() }
      if (event.key === 'Tab') {
        event.preventDefault()
        const next = document.activeElement === cancelButton.current ? confirmButton.current : cancelButton.current
        if (next && !next.disabled) next.focus(); else cancelButton.current?.focus()
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus() }
  }, [review, cancelReview])
  const send = async (command: C) => {
    if (operation.current || disabled) return
    operation.current = true; setBusy(true); setError(''); guard.markPending()
    try {
      const ack = await execute(command)
      pending.current.acknowledge(); setUncertain(false); setDirty(false); setBusy(false); setSaved(true); guard.markSaved()
      try { await onConfirmed?.(ack) } catch { setError('Écriture confirmée. La navigation est indisponible ; utilisez Actualiser sans réémettre la commande.') }
    } catch (cause) {
      setUncertain(pending.current.reject(cause))
      setError(cause instanceof Error ? cause.message : 'Résultat non confirmé. Votre saisie est conservée.')
    } finally { operation.current = false; setBusy(false); guard.markSettled() }
  }
  return <form className="grid min-w-0 gap-3" onChange={() => { if (reviewRef.current || operation.current) return; pending.current.changed(); setDirty(true); setSaved(false) }} onSubmit={async event => {
    event.preventDefault()
    if (operation.current || reviewRef.current || disabled || saved) return
    try {
      const submitter = (event.nativeEvent as SubmitEvent | undefined)?.submitter
      const choice = submitter?.getAttribute('data-choice') === 'secondary' ? 'secondary' : 'primary'
      const retry = pending.current.hasPending(), command = pending.current.capture(() => build(event.currentTarget, choice))
      if (confirmation && !retry) {
        try {
          const snapshot = { command, message: confirmation, details: confirmationDetails?.(command) ?? null }
          reviewRef.current = snapshot; guard.markPending(); setReview(snapshot); setError('')
        } catch (cause) { pending.current.cancel(); throw cause }
        return
      }
      await send(command)
    } catch (cause) {
      setUncertain(pending.current.reject(cause))
      setError(cause instanceof Error ? cause.message : 'Vérifiez votre saisie avant de continuer.')
    }
  }}>
    <fieldset disabled={disabled || busy || uncertain || review !== null} className="grid min-w-0 gap-3">{children}</fieldset>
    {uncertain && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Le résultat reste à confirmer. Les champs sont figés : réessayez exactement la même opération pour éviter un doublon. La reprise conserve la même clé pour éviter un second enregistrement.</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {saved && <p role="status" className="text-sm text-green-800">Écriture confirmée dans la base fictive.</p>}
    <button type="submit" data-choice="primary" className={buttonClass('primary') + ' whitespace-normal'} disabled={disabled || busy || saved || review !== null}>{busy ? 'Confirmation…' : uncertain ? 'Réessayer la même opération' : submitLabel}</button>
    {secondarySubmitLabel && <button type="submit" data-choice="secondary" className={buttonClass('secondary') + ' whitespace-normal'} disabled={disabled || busy || saved || review !== null}>{secondarySubmitLabel}</button>}
    {review && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-3 sm:p-6"><section role="alertdialog" aria-modal="true" aria-labelledby={reviewId + '-title'} aria-describedby={reviewId + '-description'} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#d8b992] bg-white p-5 shadow-xl">
      <h3 id={reviewId + '-title'} className="text-xl font-semibold">Confirmer l’opération fictive</h3>
      <p id={reviewId + '-description'} className="mt-3 text-sm">{review.message}</p>
      {review.details && <div className="mt-4 rounded-xl bg-[#f8f2e9] p-3 text-sm">{review.details}</div>}
      <p className="mt-3 text-xs text-amber-950">Vérifiez les informations avant de confirmer. Annuler conserve votre saisie.</p>
      <div className="mt-5 flex flex-wrap gap-3"><button ref={cancelButton} type="button" className={buttonClass('secondary')} onClick={cancelReview}>Annuler et revenir au formulaire</button><button ref={confirmButton} type="button" className={buttonClass('primary')} disabled={disabled || busy} onClick={async () => {
        const snapshot = reviewRef.current
        if (!snapshot || operation.current || disabled) return
        reviewRef.current = null; setReview(null)
        await send(snapshot.command)
      }}>Confirmer cette opération fictive</button></div>
    </section></div>}
  </form>
}
