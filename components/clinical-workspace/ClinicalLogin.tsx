'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { buttonClass } from '@/components/Ui'
import { hasCapability } from '@/lib/clinical-core/capabilities'
import type { FixtureActor } from '@/lib/clinical-core/types'
import { safeWorkspaceReturn } from '@/lib/clinical-workspace/navigation'
import { clinicalCard, clinicalInput, clinicalLabel } from './styles'

export function ClinicalLogin({ staging = false }: { staging?: boolean }) { return <Suspense fallback={<p role="status" className="p-8">Ouverture de la connexion…</p>}><LoginForm staging={staging} /></Suspense> }
function LoginForm({ staging }: { staging: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [fixture, setFixture] = useState(false)
  const destination = (actor: FixtureActor) => safeWorkspaceReturn(params.get('retour')) ?? (hasCapability(actor, 'administration') ? '/administration' : '/clinique/mon-profil')
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/clinical-workspace/actors', { cache: 'no-store', redirect: 'error', signal: controller.signal }).then(async response => {
      const body = await response.json().catch(() => null)
      if (!controller.signal.aborted) setFixture(response.ok && body?.mode === 'isolated_fixture')
    }).catch(() => undefined)
    return () => controller.abort()
  }, [])
  return <main className="flex min-h-screen items-center justify-center bg-[#f8f3ec] p-4"><section className={`${clinicalCard} w-full max-w-lg`}>
    <Image src="/psychoeducaction-logo.svg" alt="PsychoÉducAction" width={220} height={80} className="mb-6 h-auto w-52" priority />
    <h1 className="text-2xl font-semibold">Connexion au laboratoire</h1><p className="mt-3 text-sm leading-6 text-[#7a6859]">{staging ? 'Version test privée. Les dossiers et rencontres doivent être entièrement fictifs.' : 'Comptes fictifs uniquement. Cette connexion utilise le service local isolé, jamais les comptes de production.'}</p>
    {params.get('raison') === 'session-expiree-app' && <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Votre session locale a expiré. Reconnectez-vous pour revenir à la page demandée ; aucune opération ne sera relancée automatiquement.</p>}
    {params.get('raison') === 'session-expiree' && <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Votre session a expiré. Ce téléchargement n’a pas abouti. Reconnectez-vous pour revenir aux mandats, puis cliquez à nouveau sur « Télécharger le PDF exact ». Aucun fichier ne sera téléchargé automatiquement.</p>}
    {fixture ? <div className="mt-6 rounded-xl bg-[#f3e3cd] p-4 text-sm"><p>Le mode actuel est une démonstration en mémoire. La connexion authentifiée sera disponible après configuration du stockage local.</p><button className={`${buttonClass('secondary')} mt-4`} onClick={() => router.push('/clinique')}>Ouvrir la démonstration fictive</button></div> : <form className="mt-6 grid gap-4" onSubmit={async event => {
      event.preventDefault(); if (pending) return
      if (!staging && !email.trim().endsWith('@example.invalid')) { setError('Utilisez uniquement une adresse fictive du laboratoire se terminant par @example.invalid.'); return }
      setPending(true); setError('')
      try {
        const response = await fetch('/api/lab-auth/session', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) })
        const body = await response.json().catch(() => null)
        if (!response.ok || body?.mode !== (staging ? 'isolated_stage' : 'isolated_local') || body?.durable !== true || !body.actor) throw new Error(body?.error ?? 'La connexion ne peut pas être confirmée.')
        setPassword(''); router.replace(destination(body.actor))
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Connexion locale impossible. Vérifiez que les services fictifs sont démarrés.') }
      finally { setPending(false) }
    }}>
      <label className={clinicalLabel}>{staging ? 'Courriel autorisé' : 'Courriel fictif'}<input className={clinicalInput} type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required maxLength={200} /></label>
      <label className={clinicalLabel}>{staging ? 'Mot de passe' : 'Mot de passe local'}<input className={clinicalInput} type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required maxLength={200} /></label>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button className={buttonClass('primary')} disabled={pending}>{pending ? 'Vérification…' : 'Se connecter au laboratoire'}</button>
    </form>}
    <p className="mt-6 text-xs leading-5 text-[#8a6f5d]">{staging ? 'Cette version ne contient aucune archive réelle. Aucun paiement réel ni transcription audio n’est activé.' : 'Les archives réelles copiées sont consultables par l’administration seulement. Aucun envoi, transcription externe ou paiement réel n’est autorisé dans ce chantier.'}</p>
  </section></main>
}
