'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  AlertBanner,
  Badge,
  buttonClass,
  EmptyState,
  getAssignmentRequestStatus,
  PageHeader,
  StatCard,
  StatusBadge,
} from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import { isRecentDate, type AssignedClient, type AssignmentRequest } from './shared'

type DashboardStat = {
  label: string
  value: number
  helper: string
}

function RequestStatCard({
  requestedCount,
  assignedCount,
  remainingCount,
}: {
  requestedCount: number
  assignedCount: number
  remainingCount: number
}) {
  return (
    <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
      <p className="text-sm font-medium text-[#7a6859]">Demande</p>
      <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase text-[#8a6f5d]">Demandés</p>
          <p className="mt-1 text-2xl font-semibold text-[#332820]">
            {requestedCount}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-[#8a6f5d]">Assignés</p>
          <p className="mt-1 text-2xl font-semibold text-[#332820]">
            {assignedCount}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-[#8a6f5d]">Restants</p>
          <p className="mt-1 text-2xl font-semibold text-[#332820]">
            {remainingCount}
          </p>
        </div>
      </div>
    </div>
  )
}

function RequestStatusCard({
  label,
  tone,
}: {
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'muted'
}) {
  return (
    <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
      <p className="text-sm font-medium text-[#7a6859]">Statut de la demande</p>
      <div className="mt-3">
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </div>
      <p className="mt-3 text-xs text-[#8a6f5d]">
        Inactive, en cours ou complétée selon les places restantes.
      </p>
    </div>
  )
}

function QuickLink({
  href,
  title,
  description,
}: {
  href: string
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.06)] transition hover:-translate-y-0.5 hover:border-[#d8b992] hover:bg-white"
    >
      <h3 className="text-base font-semibold text-[#332820]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#7a6859]">{description}</p>
    </Link>
  )
}

export default function ProfessionnelPage() {
  const router = useRouter()
  const [clients, setClients] = useState<AssignedClient[]>([])
  const [request, setRequest] = useState<AssignmentRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadDashboard = async () => {
      setLoading(true)
      setError('')

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
        .limit(1)
        .maybeSingle()

      if (profileError) {
        setError(profileError.message)
        setLoading(false)
        return
      }

      if (profile?.role !== 'professionnel' && profile?.role !== 'direction') {
        router.push('/')
        return
      }

      const [clientsResponse, requestResponse] = await Promise.all([
        supabase
          .from('assigned_clients')
          .select(`
            id,
            first_name,
            last_name,
            email,
            phone,
            requester_name,
            assigned_date,
            contacted,
            is_active,
            short_comment,
            closure_reason
          `)
          .eq('professional_id', user.id)
          .order('assigned_date', { ascending: false }),
        supabase
          .from('assignment_requests')
          .select(
            'professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment'
          )
          .eq('professional_id', user.id)
          .limit(1),
      ])

      if (clientsResponse.error) {
        setError(clientsResponse.error.message)
        setLoading(false)
        return
      }

      if (requestResponse.error) {
        setError(requestResponse.error.message)
        setLoading(false)
        return
      }

      setClients(clientsResponse.data || [])
      setRequest((requestResponse.data?.[0] ?? null) as AssignmentRequest | null)
      setLoading(false)
    }

    loadDashboard()
  }, [router])

  const activeClients = clients.filter((client) => client.is_active)
  const noResponseClients = clients.filter((client) => !client.is_active)
  const notContactedClients = clients.filter((client) => !client.contacted)
  const recentAssignments = clients.filter((client) => isRecentDate(client.assigned_date))
  const requestedCount = request?.requested_count ?? 0
  const assignedCount = request?.assigned_count ?? 0
  const remainingCount = request?.remaining_count ?? 0
  const requestStatus = getAssignmentRequestStatus({
    isActive: request?.is_active ?? false,
    remainingCount,
    requestedCount,
  })

  const alerts = useMemo(
    () =>
      [
        recentAssignments.length > 0
          ? {
              title: 'Nouvelle assignation récente',
              description: `${recentAssignments.length} client${
                recentAssignments.length > 1 ? 's ont' : ' a'
              } été assigné${recentAssignments.length > 1 ? 's' : ''} dans les 7 derniers jours.`,
              tone: 'warning' as const,
            }
          : null,
        notContactedClients.length > 0
          ? {
              title: 'Clients à contacter',
              description: `${notContactedClients.length} client${
                notContactedClients.length > 1 ? 's ne sont' : " n'est"
              } pas encore contacté${notContactedClients.length > 1 ? 's' : ''}.`,
              tone: 'warning' as const,
            }
          : null,
        requestStatus.label === 'demande complétée'
          ? {
              title: 'Demande complétée',
              description: 'Votre demande actuelle est entièrement répondue.',
              tone: 'success' as const,
            }
          : null,
        requestStatus.label === 'demande inactive'
          ? {
              title: 'Demande inactive',
              description:
                'Aucune demande active actuellement. Vous pouvez la réactiver depuis Ma demande.',
              tone: 'muted' as const,
            }
          : null,
        activeClients.length === 0
          ? {
              title: 'Aucun client ayant pris le service',
              description: 'Aucun client avec service pris actuellement.',
              tone: 'muted' as const,
            }
          : null,
      ].filter(
        (
          alert
        ): alert is {
          title: string
          description: string
          tone: 'warning' | 'success' | 'muted'
        } => Boolean(alert)
      ),
    [activeClients.length, notContactedClients.length, recentAssignments.length, requestStatus.label]
  )

  const stats: DashboardStat[] = [
    {
      label: 'Clients ayant pris le service',
      value: activeClients.length,
      helper: 'Service pris = oui',
    },
    {
      label: 'Sans réponse / service non pris',
      value: noResponseClients.length,
      helper: 'Service pris = non',
    },
  ]

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Espace professionnel"
            title="Tableau de bord"
            description="Vue rapide de vos assignations, de votre demande et des suivis a prioriser."
            actions={
              <Link href="/professionnel/clients" className={buttonClass('primary')}>
                Voir mes clients
              </Link>
            }
          />

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement...
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-8">
              {alerts.length > 0 ? (
                <section className="grid gap-3 lg:grid-cols-2">
                  {alerts.map((alert) => (
                    <AlertBanner
                      key={alert.title}
                      title={alert.title}
                      description={alert.description}
                      tone={alert.tone}
                    />
                  ))}
                </section>
              ) : (
                <EmptyState title="Aucune alerte pour le moment." />
              )}

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {stats.map((stat) => (
                  <StatCard key={stat.label} {...stat} />
                ))}
                <RequestStatCard
                  requestedCount={requestedCount}
                  assignedCount={assignedCount}
                  remainingCount={remainingCount}
                />
                <RequestStatusCard
                  label={requestStatus.label}
                  tone={requestStatus.tone}
                />
              </section>

              <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-[#332820]">
                        Aperçu de la demande
                      </h2>
                      <p className="mt-1 text-sm text-[#7a6859]">
                        Statut actuel:{' '}
                        <Badge tone={requestStatus.tone}>
                          {requestStatus.label}
                        </Badge>
                      </p>
                    </div>
                    <Link
                      href="/professionnel/demande"
                      className={buttonClass('secondary')}
                    >
                      Gérer la demande
                    </Link>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4">
                      <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                        Demandés
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-[#332820]">
                        {requestedCount}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4">
                      <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                        Assignés
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-[#332820]">
                        {assignedCount}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4">
                      <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                        Restants
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-[#332820]">
                        {remainingCount}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4">
                  <QuickLink
                    href="/professionnel/clients"
                    title="Voir mes clients"
                    description="Mettre à jour le contact effectué, le service pris et les commentaires."
                  />
                  <QuickLink
                    href="/professionnel/demande"
                    title="Modifier ma demande"
                    description="Mettre à jour le nombre de clients souhaités ou désactiver la demande actuelle."
                  />
                  <QuickLink
                    href="/professionnel/preferences"
                    title="Modifier mes préférences"
                    description="Ajuster les clientèles, modalités et types de suivis souhaités."
                  />
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
