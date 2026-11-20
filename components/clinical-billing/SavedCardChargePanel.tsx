'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { buttonClass } from '@/components/Ui'
import { inputClass } from './primitives'
import { money, parseCents } from './model'
import { clinicalSessionFetch } from '@/lib/clinical-unification/authClient'
import { useClinicalFormGuard } from '@/components/clinical-workspace/NavigationGuard'

type Card = { hasCard: boolean; brand: string; last4: string; expMonth: number | null; expYear: number | null }

export function useSavedPayerCard(patientId:string,payerId:string){
 const scope=patientId+':'+payerId
 const [state,setState]=useState<{scope:string;card:Card|null;error:string}>({scope:'',card:null,error:''})
 useEffect(()=>{
  const controller=new AbortController();let active=true
  setState({scope,card:null,error:''})
  const query=new URLSearchParams({patientId,payerId})
  void clinicalSessionFetch('/api/clinical-workspace/billing/stripe/card?'+query,{cache:'no-store',credentials:'same-origin',headers:{'X-Clinical-Context':'administration'},signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error('Carte indisponible.')
   const value:unknown=await response.json()
   if(!value||typeof value!=='object'||typeof (value as Card).hasCard!=='boolean'||(value as Card).hasCard&&(typeof (value as Card).brand!=='string'||!/^\d{4}$/.test((value as Card).last4)))throw Error('Réponse de carte invalide.')
   if(active)setState({scope,card:value as Card,error:''})
  }).catch(()=>{if(active)setState({scope,card:null,error:'Carte indisponible.'})})
  return()=>{active=false;controller.abort()}
 },[patientId,payerId,scope])
 return state.scope===scope?state:{scope,card:null,error:''}
}

export function SavedCardChargePanel({invoiceId,payerName,expectedVersion,dueCents,disabled,refresh,card,amount,setAmount}:{invoiceId:string;payerName:string;expectedVersion:number;dueCents:number;disabled:boolean;refresh:()=>Promise<void>;card:Card;amount:string;setAmount:(value:string)=>void}){
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(false)
 const key=useRef<string|null>(null)
 useClinicalFormGuard(false,pending)
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
  return <div>
    {card?.hasCard ? <>
      <p className="mt-1 text-sm">{card.brand} •••• {card.last4} · {card.expMonth}/{card.expYear}</p>
      <form className="mt-3 grid gap-3" onSubmit={event => void charge(event)}>
        <label className="text-sm">Montant — maximum {money(dueCents)}<input className={inputClass} inputMode="decimal" required disabled={disabled||pending} value={amount}
          onChange={event => { setAmount(event.target.value); key.current = null }} /></label>
        <button type="submit" className={buttonClass('primary')} disabled={disabled || pending || dueCents <= 0}>
          {pending ? 'Confirmation…' : 'Encaisser par carte avec Stripe (test)'}
        </button>
      </form>
    </> : null}
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
  </div>
}

