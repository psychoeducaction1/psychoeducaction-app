'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CreditCard } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { clinicalSessionFetch } from '@/lib/clinical-unification/authClient'

type Summary = { hasCard: boolean; brand: string; last4: string; expMonth: number | null; expYear: number | null }
type CardElement = { mount: (node: HTMLElement) => void; destroy: () => void }
type StripeClient = (key: string) => { elements: () => { create: (kind: 'card', options: { hidePostalCode: boolean }) => CardElement };
  confirmCardSetup: (secret: string, options: { payment_method: { card: CardElement } }) =>
  Promise<{ setupIntent?: { id: string; status: string }; error?: { message?: string } }> }
function sdk(): Promise<StripeClient> {
  return new Promise((resolve, reject) => {
    const browser = window as Window & { Stripe?: StripeClient }
    if (browser.Stripe) return resolve(browser.Stripe)
    const script = document.createElement('script')
    script.src = 'https://js.stripe.com/v3/'; script.async = true
    script.onload = () => browser.Stripe ? resolve(browser.Stripe) : reject(new Error('Formulaire Stripe indisponible.'))
    script.onerror = () => reject(new Error('Formulaire Stripe indisponible.'))
    document.head.append(script)
  })
}
async function requestCard(method: 'GET' | 'POST' | 'PATCH', patientId: string, payerId: string, extra?: Record<string, unknown>) {
  const path = '/api/clinical-workspace/billing/stripe/card'
  const url = method === 'GET' ? path + '?' + new URLSearchParams({ patientId, payerId }) : path
  const response = await clinicalSessionFetch(url, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'X-Clinical-Context': 'administration', ...(extra ? { 'Content-Type': 'application/json' } : {}) },
    ...(extra ? { body: JSON.stringify({ patientId, payerId, ...extra }) } : {}) })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
    ? (data as { error: string }).error : 'La carte est indisponible.')
  if (!data || typeof data !== 'object') throw new Error('Réponse inattendue.')
  return data
}
export function StripePayerCard({ patientId, payerId, payerName }: { patientId: string; payerId: string; payerName: string }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [cardStatus, setCardStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [refreshKey, setRefreshKey] = useState(0)
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(false)
  const [authorized, setAuthorized] = useState(false), [error, setError] = useState('')
  const target = useRef<HTMLDivElement>(null), card = useRef<CardElement | null>(null)
  const stripe = useRef<ReturnType<StripeClient> | null>(null), secret = useRef('')
  const key = useRef<string | null>(null)
  useEffect(() => {
    let active = true
    setCardStatus('loading')
    void requestCard('GET', patientId, payerId).then(value => { if (active) { setSummary(value as Summary); setCardStatus('ready') } }).catch(() => { if (active) setCardStatus('error') })
    return () => { active = false }
  }, [patientId, payerId, refreshKey])
  useEffect(() => {
    if (!open) return
    let active = true
    setBusy(true); setReady(false); setError('')
    key.current ??= crypto.randomUUID()
    void (async () => {
      const value = await requestCard('POST', patientId, payerId, { key: key.current }) as { clientSecret: string; publishableKey: string }
      if (!/^pk_test_[A-Za-z0-9]+$/.test(value.publishableKey) ||
          !/^seti_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(value.clientSecret)) throw new Error('Réponse Stripe test invalide.')
      const Stripe = await sdk()
      if (!active || !target.current) return
      stripe.current = Stripe(value.publishableKey); secret.current = value.clientSecret
      card.current = stripe.current.elements().create('card', { hidePostalCode: false })
      card.current.mount(target.current); setReady(true)
    })().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Carte indisponible.') })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false; card.current?.destroy(); card.current = null; stripe.current = null; secret.current = '' }
  }, [open, patientId, payerId])
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authorized || !ready || !stripe.current || !card.current || busy) return
    setBusy(true); setError('')
    try {
      const result = await stripe.current.confirmCardSetup(secret.current, { payment_method: { card: card.current } })
      if (result.error || result.setupIntent?.status !== 'succeeded' || !result.setupIntent.id)
        throw new Error(result.error?.message ?? 'La carte n’a pas été enregistrée.')
      const value = await requestCard('PATCH', patientId, payerId, { setupIntentId: result.setupIntent.id, authorized: true })
      setSummary(value as Summary); setOpen(false); setAuthorized(false); key.current = null
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'La carte n’a pas été enregistrée.') }
    finally { setBusy(false) }
  }
  return <>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e6d7c8] bg-[#fffaf3] p-3 text-sm">
      <span className="flex items-center gap-2 text-[#674d3a]"><CreditCard size={18} aria-hidden="true" />
        {cardStatus === 'loading' ? 'Vérification de la carte…' : cardStatus === 'error' ? 'État de la carte indisponible' : summary?.hasCard ? summary.brand + ' •••• ' + summary.last4 + ' · ' + summary.expMonth + '/' + summary.expYear : 'Aucune carte liée à ce payeur'}
      </span>
      <button type="button" className={buttonClass(summary?.hasCard ? 'secondary' : 'primary')} disabled={cardStatus === 'loading'} onClick={() => cardStatus === 'error' ? setRefreshKey(value => value + 1) : setOpen(true)}>
        <CreditCard size={17} aria-hidden="true" />{cardStatus === 'error' ? 'Réessayer' : summary?.hasCard ? 'Remplacer la carte' : 'Ajouter une carte'}
      </button>
    </div>
    {open && <ProspectDialog compactHeader title={'Carte de ' + payerName} onClose={() => { if (!busy) setOpen(false) }}>
      <form onSubmit={event => void save(event)} className="grid gap-4">
        <p className="text-sm">La carte est saisie dans le champ sécurisé de Stripe. Son numéro complet ne sera pas affiché dans le dossier.</p>
        <div ref={target} className="min-h-12 rounded-xl border border-[#eadfd2] bg-white p-3" aria-label="Numéro de carte, expiration, CVC et code postal" />
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} />
          J’atteste que le titulaire autorise l’enregistrement de cette carte pour ses factures.</label>
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <button type="submit" className={buttonClass('primary')} disabled={!ready || !authorized || busy}>
          {busy ? 'Confirmation…' : 'Enregistrer la carte'}
        </button>
      </form>
    </ProspectDialog>}
  </>
}

