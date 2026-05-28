'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Clock3, type LucideIcon } from 'lucide-react'
import { AppNav } from '@/components/AppNav'
import {
  AlertBanner,
  Badge,
  type BadgeTone,
  buttonClass,
  EmptyState,
  getAssignmentRequestStatus,
  PageHeader,
  StatCard,
  StatusBadge,
} from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import {
  getRemainingAssignmentCount,
  getUsedAssignmentCount,
  type AssignedClient,
  type AssignmentRequest,
} from './shared'

type DashboardStat = {
  label: string
  value: number
  helper: string
  tone?: 'neutral' | 'warm' | 'success'
  priority?: 'default' | 'high' | 'subtle'
  icon?: LucideIcon
}

function RequestStatusCard({
  label,
  tone,
}: {
  label: string
  tone: BadgeTone
}) {
  return (
    <div className="rounded-2xl border border-[#d8b992] bg-[#fffaf4] p-5 shadow-[0_10px_28px_rgba(138,86,51,0.10)]">
      <p className="text-sm font-semibold text-[#6c5a4d]">Statut de la demande</p>
      <div className="mt-3">
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#8a6f5d]">
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
      className="block rounded-2xl border border-[#eadfd2] bg-[#fffdf9]/80 p-5 shadow-none transition hover:-translate-y-0.5 hover:border-[#d8b992] hover:bg-white"
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

      const requestResponse = await supabase
          .from('assignment_requests')
          .select(
            'id, professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment'
          )
          .eq('professional_id', user.id)
          .eq('is_active', true)
          .gt('remaining_count', 0)
          .limit(1)
          .maybeSingle()

      if (requestResponse.error) {
        setError(requestResponse.error.message)
        setLoading(false)
        return
      }

      const activeRequest = (requestResponse.data as AssignmentRequest | null) ?? null

      if (!activeRequest) {
        setClients([])
        setRequest(null)
        setLoading(false)
        return
      }

      const clientsResponse = await supabase
        .from('assigned_clients')
        .select(`
          id,
          assignment_request_id,
          first_name,
          last_name,
          email,
          phone,
          requester_name,
          assigned_date,
          contacted,
          is_active,
          short_comment,
          meeting_modality,
          service_address,
          closure_reason
        `)
        .eq('professional_id', user.id)
        .eq('assignment_request_id', activeRequest.id)
        .order('assigned_date', { ascending: false })

      if (clientsResponse.error) {
        setError(clientsResponse.error.message)
        setLoading(false)
        return
      }

      setClients(clientsResponse.data || [])
      setRequest(activeRequest)
      setLoading(false)
    }

    loadDashboard()
  }, [router])

  const clientsToProcess = clients.filter((client) => client.is_active === null)
  const requestedCount = request?.requested_count ?? 0
  const assignedCount = getUsedAssignmentCount(clients)
  const remainingCount = getRemainingAssignmentCount(requestedCount, assignedCount)
  const isRequestCompleted = Boolean(request && requestedCount > 0 && remainingCount === 0)
  const requestStatus = getAssignmentRequestStatus({
    isActive: request?.is_active ?? false,
    remainingCount,
    requestedCount,
  })

  const alerts = useMemo(
    () =>
      [
        clientsToProcess.length > 0
          ? {
              title: 'Assignations à traiter',
              description: `${clientsToProcess.length} assignation${
                clientsToProcess.length > 1 ? 's sont' : ' est'
              } encore en attente de statut.`,
              tone: 'warning' as const,
            }
          : null,
        requestStatus.label === 'demande en cours'
          ? {
              title: 'Demande incomplète',
              description:
                'Votre demande est encore active avec des places restantes à assigner.',
              tone: 'warning' as const,
            }
          : null,
        isRequestCompleted
          ? {
              title: 'Demande complétée',
              description:
                'Votre demande actuelle est complétée. Vous pouvez créer une nouvelle demande au besoin.',
              tone: 'success' as const,
            }
          : null,
      ].filter(
        (
          alert
        ): alert is {
          title: string
          description: string
          tone: 'warning' | 'success'
        } => Boolean(alert)
      ),
    [clientsToProcess.length, isRequestCompleted, requestStatus.label]
  )

  const stats: DashboardStat[] = [
    {
      label: 'Assignations à traiter',
      value: clientsToProcess.length,
      helper: 'Service = en attente',
      tone: 'warm',
      priority: clientsToProcess.length > 0 ? 'high' : 'default',
      icon: Clock3,
    },
    {
      label: 'Places restantes',
      value: remainingCount,
      helper: 'Disponibles dans la demande active',
      tone: 'warm',
      priority: remainingCount > 0 ? 'high' : 'default',
      icon: ClipboardList,
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
            description="Vue rapide de vos assignations, de votre demande et des suivis à prioriser."
            actions={
              <Link href="/professionnel/clients" className={buttonClass('primary')}>
                Voir mes assignations
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
                      priority={alert.tone === 'warning' ? 'high' : 'default'}
                    />
                  ))}
                </section>
              ) : (
                <EmptyState title="Aucune alerte pour le moment." />
              )}

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {stats.map((stat) => (
                  <StatCard key={stat.label} {...stat} />
                ))}
                <RequestStatusCard
                  label={requestStatus.label}
                  tone={requestStatus.tone}
                />
              </section>

              <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-[#332820]">
                        Aperçu de la demande
                      </h2>
                      <p className="mt-1 text-sm text-[#7a6859]">
                        Statut actuel:{' '}
                        <Badge tone={requestStatus.tone}>
                          {requestStatus.label}
                        </Badge>
                      </p>
                      {isRequestCompleted && (
                        <p className="mt-2 text-sm text-[#7a6859]">
                          Votre demande actuelle est complétée. Vous pouvez
                          créer une nouvelle demande au besoin.
                        </p>
                      )}
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
                        Services pris
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-[#332820]">
                        {assignedCount}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-[#d8b992] bg-[#fffaf4] p-4">
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
                    title="Voir mes assignations"
                    description="Mettre à jour le statut de service, le motif et les commentaires."
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
