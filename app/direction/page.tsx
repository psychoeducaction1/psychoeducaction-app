'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
  buttonClass,
  getAssignmentRequestStatus,
} from '@/components/Ui'
import {
  AlertBanner,
  EmptyState,
  PageHeader,
  SectionCard,
  StatCard,
} from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'

type Profile = {
  id: string
  full_name: string | null
  email: string | null
}

type AssignedClient = {
  professional_id: string | null
  is_active: boolean | null
}

type AssignmentRequest = {
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  request_comment: string | null
}

type ClientStats = {
  total: number
  active: number
  noResponse: number
}

type DirectionRow = {
  id: string
  fullName: string
  email: string
  totalAssignedClients: number
  activeClients: number
  noResponseClients: number
  requestActive: boolean
  requestedCount: number
  assignedCount: number
  remainingCount: number
  requestComment: string
}

export default function DirectionPage() {
  const router = useRouter()
  const [rows, setRows] = useState<DirectionRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
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

      const { data: currentProfile, error: currentProfileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (currentProfileError || currentProfile?.role !== 'direction') {
        router.push('/')
        return
      }

      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'professionnel')
        .order('full_name', { ascending: true })

      if (profilesError) {
        setError(profilesError.message)
        setLoading(false)
        return
      }

      const professionals = (profilesData ?? []) as Profile[]
      const professionalIds = professionals.map((profile) => profile.id)

      if (professionalIds.length === 0) {
        setRows([])
        setLoading(false)
        return
      }

      const [assignedClientsResponse, assignmentRequestsResponse] = await Promise.all([
        supabase
          .from('assigned_clients')
          .select('professional_id, is_active')
          .in('professional_id', professionalIds),
        supabase
          .from('assignment_requests')
          .select(
            'professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment'
          )
          .in('professional_id', professionalIds),
      ])

      if (assignedClientsResponse.error) {
        setError(assignedClientsResponse.error.message)
        setLoading(false)
        return
      }

      if (assignmentRequestsResponse.error) {
        setError(assignmentRequestsResponse.error.message)
        setLoading(false)
        return
      }

      const assignedClients = (assignedClientsResponse.data ?? []) as AssignedClient[]
      const assignmentRequests = (assignmentRequestsResponse.data ?? []) as AssignmentRequest[]

      const clientStatsByProfessionalId = new Map<string, ClientStats>()

      assignedClients.forEach((client) => {
        if (!client.professional_id) return

        const currentStats = clientStatsByProfessionalId.get(client.professional_id) ?? {
          total: 0,
          active: 0,
          noResponse: 0,
        }

        currentStats.total += 1

        if (client.is_active) {
          currentStats.active += 1
        } else {
          currentStats.noResponse += 1
        }

        clientStatsByProfessionalId.set(client.professional_id, currentStats)
      })

      const requestByProfessionalId = new Map<string, AssignmentRequest>()

      assignmentRequests.forEach((request) => {
        if (!requestByProfessionalId.has(request.professional_id)) {
          requestByProfessionalId.set(request.professional_id, request)
        }
      })

      const nextRows = professionals.map((profile) => {
        const request = requestByProfessionalId.get(profile.id)
        const clientStats = clientStatsByProfessionalId.get(profile.id)

        return {
          id: profile.id,
          fullName: profile.full_name ?? '-',
          email: profile.email ?? '-',
          totalAssignedClients: clientStats?.total ?? 0,
          activeClients: clientStats?.active ?? 0,
          noResponseClients: clientStats?.noResponse ?? 0,
          requestActive: request?.is_active ?? false,
          requestedCount: request?.requested_count ?? 0,
          assignedCount: request?.assigned_count ?? 0,
          remainingCount: request?.remaining_count ?? 0,
          requestComment: request?.request_comment?.trim() || '-',
        }
      })

      setRows(nextRows)
      setLoading(false)
    }

    loadData()
  }, [router])

  const dashboardStats = useMemo(
    () => ({
      totalProfessionals: rows.length,
      activeRequests: rows.filter((row) => row.requestActive).length,
      activeClients: rows.reduce((total, row) => total + row.activeClients, 0),
      noResponseClients: rows.reduce((total, row) => total + row.noResponseClients, 0),
      remainingPlaces: rows.reduce((total, row) => total + row.remainingCount, 0),
    }),
    [rows]
  )

  const professionalsWithRemaining = useMemo(
    () =>
      rows
        .filter((row) => row.requestActive && row.remainingCount > 0)
        .sort((a, b) => b.remainingCount - a.remainingCount)
        .slice(0, 8),
    [rows]
  )

  const completedRequests = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            row.requestActive && row.remainingCount === 0 && row.requestedCount > 0
        )
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr'))
        .slice(0, 8),
    [rows]
  )

  const attentionRows = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            row.noResponseClients >= 3 ||
            (row.requestActive && row.remainingCount === 0 && row.requestedCount > 0)
        )
        .sort((a, b) => b.noResponseClients - a.noResponseClients)
        .slice(0, 8),
    [rows]
  )
  const directionAlerts = [
    professionalsWithRemaining.some((row) => row.remainingCount >= 3)
      ? {
          title: 'Capacite disponible importante',
          description: `${
            professionalsWithRemaining.filter((row) => row.remainingCount >= 3).length
          } professionnel${
            professionalsWithRemaining.filter((row) => row.remainingCount >= 3)
              .length > 1
              ? 's ont'
              : ' a'
          } encore beaucoup de places.`,
          tone: 'warning' as const,
        }
      : null,
    completedRequests.length > 0
      ? {
          title: 'Demandes completees',
          description: `${completedRequests.length} demande${
            completedRequests.length > 1 ? 's sont completees' : ' est completee'
          } et reste${completedRequests.length > 1 ? 'nt' : ''} visible${
            completedRequests.length > 1 ? 's' : ''
          }.`,
          tone: 'success' as const,
        }
      : null,
    rows.some((row) => row.noResponseClients >= 3)
      ? {
          title: 'Clients sans reponse a surveiller',
          description: `${
            rows.filter((row) => row.noResponseClients >= 3).length
          } professionnel${
            rows.filter((row) => row.noResponseClients >= 3).length > 1
              ? 's ont'
              : ' a'
          } plusieurs clients sans reponse.`,
          tone: 'warning' as const,
        }
      : null,
    dashboardStats.activeRequests === 0
      ? {
          title: 'Aucune demande active',
          description: 'Aucune demande d assignation active actuellement.',
          tone: 'muted' as const,
        }
      : null,
  ].filter((alert): alert is { title: string; description: string; tone: 'warning' | 'success' | 'muted' } =>
    Boolean(alert)
  )

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Direction"
            title="Tableau de bord"
            description="Vue rapide des capacites, demandes et situations a surveiller."
            actions={
              <Link
                href="/direction/professionnels"
                className={buttonClass('primary')}
              >
                Voir les professionnels
              </Link>
            }
          />

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement des donnees...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Erreur: {error}
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-6">
              {directionAlerts.length > 0 && (
                <section className="grid gap-3 lg:grid-cols-2">
                  {directionAlerts.map((alert) => (
                    <AlertBanner
                      key={alert.title}
                      title={alert.title}
                      description={alert.description}
                      tone={alert.tone}
                    />
                  ))}
                </section>
              )}

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <StatCard label="Professionnels" value={dashboardStats.totalProfessionals} />
                <StatCard
                  label="Demandes actives"
                  value={dashboardStats.activeRequests}
                  tone="warm"
                />
                <StatCard
                  label="Clients actifs"
                  value={dashboardStats.activeClients}
                  tone="success"
                />
                <StatCard
                  label="Sans reponse / service non pris"
                  value={dashboardStats.noResponseClients}
                  tone="warm"
                />
                <StatCard
                  label="Places restantes"
                  value={dashboardStats.remainingPlaces}
                />
              </section>

              <div className="grid gap-6 xl:grid-cols-3">
                <SectionCard title="Professionnels ayant encore des places">
                  {professionalsWithRemaining.length === 0 ? (
                    <EmptyState title="Aucune place restante actuellement." />
                  ) : (
                    <div className="space-y-3">
                      {professionalsWithRemaining.map((row) => (
                        <div
                          key={row.id}
                          className="flex flex-col gap-3 rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <Link
                            href={`/professionnel/${row.id}`}
                            className="font-medium text-[#6d3f1f] underline decoration-[#d9b591] underline-offset-2 hover:decoration-[#9b6a3d]"
                          >
                            {row.fullName}
                          </Link>
                          <Badge tone="warning">{row.remainingCount} places</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Demandes completees recemment">
                  {completedRequests.length === 0 ? (
                    <EmptyState title="Aucune demande completee a afficher." />
                  ) : (
                    <div className="space-y-3">
                      {completedRequests.map((row) => {
                        const status = getAssignmentRequestStatus({
                          isActive: row.requestActive,
                          remainingCount: row.remainingCount,
                          requestedCount: row.requestedCount,
                        })

                        return (
                          <div
                            key={row.id}
                            className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <Link
                                href={`/professionnel/${row.id}`}
                                className="font-medium text-[#6d3f1f] underline decoration-[#d9b591] underline-offset-2 hover:decoration-[#9b6a3d]"
                              >
                                {row.fullName}
                              </Link>
                              <Badge tone={status.tone}>{status.label}</Badge>
                            </div>
                            <p className="mt-2 text-sm text-[#7a6859]">
                              {row.assignedCount} assignes sur {row.requestedCount}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Demandes necessitant attention">
                  {attentionRows.length === 0 ? (
                    <EmptyState title="Aucune situation prioritaire detectee." />
                  ) : (
                    <div className="space-y-3">
                      {attentionRows.map((row) => (
                        <div
                          key={row.id}
                          className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <Link
                              href={`/professionnel/${row.id}`}
                              className="font-medium text-[#6d3f1f] underline decoration-[#d9b591] underline-offset-2 hover:decoration-[#9b6a3d]"
                            >
                              {row.fullName}
                            </Link>
                            <div className="flex flex-wrap gap-2">
                              {row.noResponseClients >= 3 && (
                                <Badge tone="warning">
                                  {row.noResponseClients} sans reponse
                                </Badge>
                              )}
                              {row.requestActive &&
                                row.remainingCount === 0 &&
                                row.requestedCount > 0 && (
                                  <Badge tone="success">aucune place restante</Badge>
                                )}
                            </div>
                          </div>
                          <p className="mt-2 text-sm text-[#7a6859]">
                            {row.requestComment}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
