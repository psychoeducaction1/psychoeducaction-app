'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { buttonClass } from '@/components/Ui'
import { clinicalCard, inputClass } from './primitives'
import { money, moneyInput, parseCents } from './model'

type Checkout = { checkoutId: string; clientSecret: string; publishableKey: string; expiresAt: string; amountCents: number }
type EmbeddedCheckout = { mount: (target: HTMLElement) => void; destroy: () => void }
type StripeBrowser = (key: string) => {
  initEmbeddedCheckout: (options: { fetchClientSecret: () => Promise<string> }) => Promise<EmbeddedCheckout>
}

function stripeScript(): Promise<StripeBrowser> {
  return new Promise((resolve, reject) => {
    const existing = window as Window & { Stripe?: StripeBrowser }
    if (existing.Stripe) { resolve(existing.Stripe); return }
    const script = document.createElement('script')
    script.src = 'https://js.stripe.com/v3/'
    script.async = true
    script.onload = () => existing.Stripe ? resolve(existing.Stripe) : reject(new Error('Le formulaire Stripe est indisponible.'))
    script.onerror = () => reject(new Error('Le formulaire Stripe est indisponible.'))
    document.head.append(script)
  })
}

export function StripeCheckoutPanel({ invoiceId, expectedVersion, dueCents, disabled }: { invoiceId: string; expectedVersion: number; dueCents: number; disabled: boolean }) {
  const [amount, setAmount] = useState(moneyInput(dueCents))
  const [pending, setPending] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [error, setError] = useState('')
  const key = useRef<string | null>(null)
  const target = useRef<HTMLDivElement>(null)
  const checkout = useRef<EmbeddedCheckout | null>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    return () => { cancelled.current = true; checkout.current?.destroy(); checkout.current = null }
  }, [])

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending || mounted || disabled) return
    let cents: number
    try { cents = parseCents(amount, dueCents) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Montant invalide.'); return }
    setPending(true); setError('')
    key.current ??= crypto.randomUUID()
    try {
      const response = await fetch('/api/clinical-workspace/billing/stripe/checkout', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Clinical-Context': 'administration' },
        body: JSON.stringify({ invoiceId, expectedVersion, amountCents: cents, key: key.current }),
      })
      const value: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string' ? (value as { error: string }).error : 'Le paiement Stripe test n’est pas disponible.')
      if (!value || typeof value !== 'object') throw new Error('Réponse Stripe test invalide.')
      const result = value as Checkout
      if (!/^pk_test_[A-Za-z0-9]+$/.test(result.publishableKey) || !/^cs_test_[A-Za-z0-9]+_secret_(?:[A-Za-z0-9]|%[A-Fa-f0-9]{2})+$/.test(result.clientSecret) || result.amountCents !== cents) throw new Error('Réponse Stripe test invalide.')
      const Stripe = await stripeScript()
      if (cancelled.current || !target.current) return
      const instance = await Stripe(result.publishableKey).initEmbeddedCheckout({ fetchClientSecret: async () => result.clientSecret })
      if (cancelled.current || !target.current) { instance.destroy(); return }
      instance.mount(target.current)
      checkout.current = instance
      setMounted(true)
    } catch (cause) { if (!cancelled.current) setError(cause instanceof Error ? cause.message : 'Le formulaire Stripe test n’est pas disponible.') }
    finally { if (!cancelled.current) setPending(false) }
  }

  return <section className={clinicalCard}>
    <h4 className="font-semibold">Carte de crédit avec Stripe</h4>
    <p className="mt-1 text-sm">Saisissez la carte ici, puis confirmez le paiement dans le formulaire sécurisé Stripe.</p>
    {!mounted && <form className="mt-3 grid gap-3" onSubmit={event => void create(event)}>
      <label className="text-sm">Montant — maximum {money(dueCents)}<input className={inputClass} inputMode="decimal" required value={amount} onChange={event => { setAmount(event.target.value); key.current = null }} /></label>
      <button className={buttonClass('primary')} disabled={disabled || pending || dueCents <= 0}>{pending ? 'Chargement du formulaire…' : 'Saisir la carte'}</button>
    </form>}
    <div ref={target} className="mt-3 min-w-0" aria-label="Formulaire de paiement Stripe" />
    {mounted && <p className="mt-2 text-xs">Le règlement sera inscrit seulement après confirmation sécurisée de Stripe.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
  </section>
}
