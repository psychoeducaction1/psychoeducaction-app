'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { Badge } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'

function InfoCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
      <h2 className="text-lg font-semibold text-[#332820]">{title}</h2>
      <div className="mt-4 text-sm leading-6 text-[#6c5a4d]">{children}</div>
    </section>
  )
}

export default function DirectionParametresPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const verifyDirectionAccess = async () => {
      setLoading(true)
      setError(null)

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.push('/login')
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profileError) {
        setError(profileError.message)
        setLoading(false)
        return
      }

      if (profile?.role !== 'direction') {
        router.push('/')
        return
      }

      setLoading(false)
    }

    verifyDirectionAccess()
  }, [router])

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8">
            <p className="text-sm font-medium text-[#9b6a3d]">Direction</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#332820]">
              Parametres
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
              Informations administratives et rappels de configuration du MVP.
            </p>
          </div>

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement des parametres...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Erreur: {error}
            </div>
          )}

          {!loading && !error && (
            <div className="grid gap-6">
              <InfoCard title="Application">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="neutral">Assignations PsychoEducAction</Badge>
                  <Badge tone="warning">Version MVP</Badge>
                </div>
              </InfoCard>

              <InfoCard title="Roles existants">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="success">direction</Badge>
                  <Badge tone="success">professionnel</Badge>
                </div>
              </InfoCard>

              <InfoCard title="Tables Supabase utilisees">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="neutral">profiles</Badge>
                  <Badge tone="neutral">assigned_clients</Badge>
                  <Badge tone="neutral">assignment_requests</Badge>
                </div>
              </InfoCard>

              <InfoCard title="Securite">
                <p>
                  Rappel important : les politiques RLS Supabase sont a finaliser
                  avant une mise en production.
                </p>
              </InfoCard>

              <InfoCard title="Regles metier actuelles">
                <ul className="space-y-2">
                  <li>Les demandes completees restent visibles.</li>
                  <li>Les professionnels peuvent gerer leurs preferences.</li>
                  <li>La direction assigne les clients.</li>
                  <li>
                    Les professionnels indiquent contact effectue et service pris
                    oui/non.
                  </li>
                </ul>
              </InfoCard>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
