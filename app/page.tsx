'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

const SESSION_RETRY_DELAY_MS = 150
const PROFILE_RETRY_DELAY_MS = 200

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export default function HomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    const checkUser = async () => {
      setLoading(true)
      setErrorMessage('')

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        console.log('[HomePage auth] user.id:', user?.id)
        console.log('[HomePage auth] user.email:', user?.email)

        if (!user) {
          router.replace('/login')
          return
        }

        let { data: sessionData } = await supabase.auth.getSession()

        if (!sessionData.session) {
          await wait(SESSION_RETRY_DELAY_MS)
          const retrySessionResponse = await supabase.auth.getSession()
          sessionData = retrySessionResponse.data
        }

        let profile: { role: string | null } | null = null
        let profileError: Error | null = null

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const { data, error } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .maybeSingle()

          profile = data
          profileError = error

          if (profile || profileError || attempt === 1) {
            break
          }

          await wait(PROFILE_RETRY_DELAY_MS)
        }

        console.log('[HomePage auth] profile:', profile)
        console.log('[HomePage auth] profile error:', profileError)

        if (profileError) {
          setErrorMessage(profileError.message)
          return
        }

        if (!profile) {
          setErrorMessage(
            "Aucun profil n'est associe a cet utilisateur dans la table profiles."
          )
          return
        }

        if (profile.role === 'direction') {
          router.replace('/direction')
        } else if (profile.role === 'professionnel') {
          router.replace('/professionnel')
        } else {
          setErrorMessage("Le role de ce profil n'est pas reconnu.")
        }
      } catch (caughtError) {
        setErrorMessage(
          caughtError instanceof Error
            ? caughtError.message
            : "Une erreur est survenue pendant la verification du profil."
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void checkUser()

    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] px-6 py-4 text-sm text-[#7a6859] shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
        {loading ? 'Chargement...' : errorMessage}
      </div>
    </main>
  )
}
