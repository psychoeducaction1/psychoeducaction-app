'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { Session } from '@supabase/supabase-js'
import { AppNav } from '@/components/AppNav'
import { AlertBanner, buttonClass, PageHeader } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import type { DemoSession } from '@/lib/clinicalNotesDemo'

const Workspace = dynamic(() => import('@/components/ClinicalNotesWorkspace'), {
  loading: () => <p role="status">Ouverture de l’espace de démonstration…</p>,
})

type PilotData = { viewerId: string; mode: 'demo'; sessions: DemoSession[]; aiEnabled: boolean }

export default function ClinicalNotesPage() {
  const [data, setData] = useState<PilotData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [loginRequired, setLoginRequired] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let currentUserId: string | null | undefined
    let controller: AbortController | undefined
    const load = async (session: Session | null) => {
      controller?.abort()
      const requestController = new AbortController()
      controller = requestController
      currentUserId = session?.user.id ?? null
      setData(null)
      setError('')
      setLoginRequired(!session)
      setLoading(Boolean(session))
      if (!session) return
      try {
        const response = await fetch('/api/prise-de-notes', {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store', signal: requestController.signal,
        })
        const payload = await response.json()
        if (!active || requestController.signal.aborted) return
        if (!response.ok) {
          setLoginRequired(response.status === 401)
          throw new Error(payload.error || 'Impossible d’ouvrir la section.')
        }
        if (payload.viewerId !== session.user.id || payload.mode !== 'demo') {
          throw new Error('Réponse inattendue. Réessayez.')
        }
        setData(payload)
      } catch (cause) {
        if (active && !requestController.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Impossible d’ouvrir la section.')
        }
      } finally {
        if (active && !requestController.signal.aborted) setLoading(false)
      }
    }

    // Un changement de compte efface le travail fictif de la session precedente.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && currentUserId !== (session?.user.id ?? null)) void load(session)
    })
    void supabase.auth.getSession().then(({ data: sessionData, error: sessionError }) => {
      if (!active || currentUserId !== undefined) return
      if (sessionError) {
        setError('Impossible de vérifier la connexion. Réessayez.')
        setLoading(false)
        return
      }
      void load(sessionData.session)
    }).catch(() => {
      if (active) {
        setError('Impossible de vérifier la connexion. Réessayez.')
        setLoading(false)
      }
    })
    return () => { active = false; controller?.abort(); listener.subscription.unsubscribe() }
  }, [attempt])

  return <>
    <AppNav />
    <main className="min-h-screen min-w-0 px-4 py-8 sm:px-6 lg:ml-72 lg:px-8">
      <PageHeader eyebrow="Pilote privé · données fictives" title="Prise de notes"
        description="Préparez, relisez et validez des notes à partir de séances entièrement fictives. L’envoi à l’IA se fait dans un essai séparé et volontaire." />
      {loading ? <p role="status">Vérification de vos accès…</p> : data ? (
        <Workspace key={data.viewerId} initialSessions={data.sessions} aiEnabled={data.aiEnabled === true} />
      ) : <div className="space-y-4">
        <AlertBanner title={loginRequired ? 'Connexion requise' : 'Section indisponible'}
          description={error || 'Connectez-vous avec un compte autorisé au pilote.'} />
        {loginRequired ? <Link className={buttonClass('primary')} href="/login">Se connecter</Link>
          : <button className={buttonClass('secondary')} onClick={() => setAttempt(value => value + 1)}>Réessayer</button>}
      </div>}
    </main>
  </>
}
