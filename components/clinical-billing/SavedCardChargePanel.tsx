'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { buttonClass } from '@/components/Ui'
import { clinicalCard, inputClass } from './primitives'
import { money, moneyInput, parseCents } from './model'
import { clinicalSessionFetch } from '@/lib/clinical-unification/authClient'

type Card = { hasCard: boolean; brand: string; last4: string; expMonth: number | null; expYear: number | null }

export function SavedCardChargePanel({ invoiceId, patientId, payerId, payerName, expectedVersion, dueCents, disabled, openPayer, refresh }: {
  invoiceId: string; patientId: string; payerId: string; payerName: string; expectedVersion: number;
  dueCents: number; disabled: boolean; openPayer: () => void; refresh: () => Promise<void>
}) {
  const [card, setCard] = useState<Card | null>(null), [amount, setAmount] = useState(moneyInput(dueCents))
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState(false)
  const key = useRef<string | null>(null)
  useEffect(() => {
    let active = true
    const query = new URLSearchParams({ patientId, payerId })
    void clinicalSessionFetch('/api/clinical-workspace/billing/stripe/card?' + query, {
      cache: 'no-store', credentials: 'same-origin', headers: { 'X-Clinical-Context': 'administration' },
    }).then(async response => {
      if (!response.ok) throw new Error('La carte du payeur est indisponible.')
      return response.json() as Promise<Card>
    }).then(value => { if (active) setCard(value) }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Carte indisponible.') })
    return () => { active = false }
  }, [patientId, payerId])
  const charge = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending || disabled || !card?.hasCard) return
    let amountCents: number
    try { amountCents = parseCents(amount, dueCents) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Montant invalide.'); return }
    if (!window.confirm('Débiter ' + money(amountCents) + ' sur la carte de ' + payerName + ' dans Stripe test ?')) return
    setPending(true); setError(''); setMessage('')
    key.current ??= crypto.randomUUID()
    try {
      const response = await clinicalSessionFetch('/api/clinical-workspace/billing/stripe/charge', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Clinical-Context': 'administration' },
        body: JSON.stringify({ invoiceId, expectedVersion, amountCents, key: key.current }),
      })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        if (response.status === 402) key.current = null
        throw new Error(data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
          ? (data as { error: string }).error : 'Stripe test n’a pas confirmé le débit.')
      }
      setMessage(data && typeof data === 'object' && (data as { status?: unknown }).status === 'confirme'
        ? 'Paiement Stripe test confirmé et inscrit sur la facture.'
        : 'Débit demandé. Le paiement apparaîtra après la confirmation Stripe.')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Le débit n’a pas été confirmé.') }
    finally { setPending(false) }
  }
  return <section className={clinicalCard}>
    <h4 className="font-semibold">Carte de crédit de {payerName}</h4>
    {card?.hasCard ? <>
      <p className="mt-1 text-sm">{card.brand} •••• {card.last4} · {card.expMonth}/{card.expYear}</p>
      <form className="mt-3 grid gap-3" onSubmit={event => void charge(event)}>
        <label className="text-sm">Montant — maximum {money(dueCents)}<input className={inputClass} inputMode="decimal" required value={amount}
          onChange={event => { setAmount(event.target.value); key.current = null }} /></label>
        <button type="submit" className={buttonClass('primary')} disabled={disabled || pending || dueCents <= 0}>
          {pending ? 'Confirmation…' : 'Encaisser par carte avec Stripe (test)'}
        </button>
      </form>
    </> : <div className="mt-2 text-sm"><p>Aucune carte enregistrée pour le payeur de cette facture.</p>
      <button type="button" className={buttonClass('secondary') + ' mt-2'} onClick={openPayer}>Ouvrir ses requérants et responsables</button></div>}
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
  </section>
}

