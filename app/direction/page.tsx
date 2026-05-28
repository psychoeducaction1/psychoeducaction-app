'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react'
import { AppNav } from '@/components/AppNav'
import {
  AlertBanner,
  Badge,
  buttonClass,
  EmptyState,
  getAssignmentRequestStatus,
  PageHeader,
  SectionCard,
  StatCard,
} from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import {
  getAssignmentRequestMetrics,
} from '@/app/professionnel/shared'

type Profile = {
  id: string
  full_name: string | null
  email: string | null
}

type AssignedClient = {
  professional_id: string | null
  assignment_request_id: string | null
  is_active: boolean | null
}

type AssignmentRequest = {
  id: string
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  request_comment: string | null
  created_at?: string | null
}

type ClientStats = {
  total: number
  active: number
  noResponse: number
  usedAssignments: number
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
  requestCompleted: boolean
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
        .limit(1)
        .maybeSingle()

      if (currentProfileError || currentProfile?.role !== 'direction') {
        router.push('/')
        return
      }

      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'professionnel')
        .eq('is_active', true)
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
          .select('professional_id, assignment_request_id, is_active')
          .in('professional_id', professionalIds),
        supabase
          .from('assignment_requests')
          .select(
            'id, professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment, created_at'
          )
          .in('professional_id', professionalIds)
          .order('created_at', { ascending: false }),
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

      const clientStatsByRequestId = new Map<string, ClientStats>()

      assignedClients.forEach((client) => {
        if (!client.assignment_request_id) return

        const currentStats = clientStatsByRequestId.get(client.assignment_request_id) ?? {
          total: 0,
          active: 0,
          noResponse: 0,
          usedAssignments: 0,
        }

        currentStats.total += 1

        if (client.is_active === true) {
          currentStats.usedAssignments += 1
        }

        if (client.is_active === true) {
          currentStats.active += 1
        } else if (client.is_active === false) {
          currentStats.noResponse += 1
        }

        clientStatsByRequestId.set(client.assignment_request_id, currentStats)
      })

      const requestsByProfessionalId = new Map<string, AssignmentRequest[]>()

      assignmentRequests.forEach((request) => {
        const currentRequests = requestsByProfessionalId.get(request.professional_id) ?? []
        currentRequests.push(request)
        requestsByProfessionalId.set(request.professional_id, currentRequests)
      })

      const nextRows = professionals.map((profile) => {
        const professionalRequests = requestsByProfessionalId.get(profile.id) ?? []
        const activeRequest =
          professionalRequests.find((currentRequest) => {
            const currentClientStats = clientStatsByRequestId.get(currentRequest.id)
            return getAssignmentRequestMetrics({
              isActive: currentRequest.is_active,
              requestedCount: currentRequest.requested_count,
              acceptedCount: currentClientStats?.total ?? 0,
              remainingCount: currentRequest.remaining_count,
            }).isActive
          }) ?? null
        const completedRequest =
          professionalRequests.find((currentRequest) => {
            const currentClientStats = clientStatsByRequestId.get(currentRequest.id)
            return getAssignmentRequestMetrics({
              isActive: currentRequest.is_active,
              requestedCount: currentRequest.requested_count,
              acceptedCount: currentClientStats?.total ?? 0,
              remainingCount: currentRequest.remaining_count,
            }).isCompleted
          }) ?? null
        const request = activeRequest ?? completedRequest ?? professionalRequests[0]
        const clientStats = request ? clientStatsByRequestId.get(request.id) : undefined

        const requestMetrics = getAssignmentRequestMetrics({
          isActive: request?.is_active,
          requestedCount: request?.requested_count,
          acceptedCount: clientStats?.total ?? 0,
          remainingCount: request?.remaining_count,
        })

        return {
          id: profile.id,
          fullName: profile.full_name ?? '-',
          email: profile.email ?? '-',
          totalAssignedClients: clientStats?.total ?? 0,
          activeClients: clientStats?.active ?? 0,
          noResponseClients: clientStats?.noResponse ?? 0,
          requestActive: requestMetrics.isActive,
          requestedCount: requestMetrics.requestedCount,
          assignedCount: requestMetrics.acceptedCount,
          remainingCount: requestMetrics.isActive ? requestMetrics.remainingCount : 0,
          requestComment: request?.request_comment?.trim() || '-',
          requestCompleted: requestMetrics.isCompleted,
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
      remainingPlaces: rows.reduce(
        (total, row) => total + (row.requestActive ? row.remainingCount : 0),
        0
      ),
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
        .filter((row) => row.requestCompleted)
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
            row.requestCompleted
        )
        .sort((a, b) => b.noResponseClients - a.noResponseClients)
        .slice(0, 8),
    [rows]
  )
  const directionAlerts = [
    professionalsWithRemaining.some((row) => row.remainingCount >= 3)
      ? {
          title: 'Capacité disponible importante',
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
          title: 'Demandes complétées',
          description: `${completedRequests.length} demande${
            completedRequests.length > 1 ? 's sont complétées' : ' est complétée'
          } et reste${completedRequests.length > 1 ? 'nt' : ''} visible${
            completedRequests.length > 1 ? 's' : ''
          }.`,
          tone: 'success' as const,
        }
      : null,
    rows.some((row) => row.noResponseClients >= 3)
      ? {
          title: 'Services non pris à surveiller',
          description: `${
            rows.filter((row) => row.noResponseClients >= 3).length
          } professionnel${
            rows.filter((row) => row.noResponseClients >= 3).length > 1
              ? 's ont'
              : ' a'
          } plusieurs services non pris.`,
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
            description="Vue rapide des capacités, demandes et situations à surveiller."
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
              Chargement des données...
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
                      priority={alert.tone === 'warning' ? 'high' : 'default'}
                    />
                  ))}
                </section>
              )}

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <StatCard
                  label="Professionnels"
                  value={dashboardStats.totalProfessionals}
                  priority="subtle"
                  icon={Users}
                />
                <StatCard
                  label="Demandes actives"
                  value={dashboardStats.activeRequests}
                  tone="warm"
                  priority={dashboardStats.activeRequests > 0 ? 'high' : 'default'}
                  icon={ClipboardList}
                />
                <StatCard
                  label="Services pris"
                  value={dashboardStats.activeClients}
                  tone="success"
                  priority="subtle"
                  icon={UserCheck}
                />
                <StatCard
                  label="Services non pris"
                  value={dashboardStats.noResponseClients}
                  tone="warm"
                  priority={dashboardStats.noResponseClients > 0 ? 'default' : 'subtle'}
                  icon={UserX}
                />
                <StatCard
                  label="Places restantes"
                  value={dashboardStats.remainingPlaces}
                  tone="warm"
                  priority={dashboardStats.remainingPlaces > 0 ? 'high' : 'default'}
                  icon={ClipboardList}
                />
              </section>

              <div className="grid gap-6 xl:grid-cols-3">
                <SectionCard
                  title="Professionnels ayant encore des places"
                  priority="high"
                  icon={ClipboardList}
                >
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

                <SectionCard
                  title="Demandes complétées récemment"
                  priority="subtle"
                  icon={CheckCircle2}
                >
                  {completedRequests.length === 0 ? (
                    <EmptyState title="Aucune demande complétée à afficher." />
                  ) : (
                    <div className="space-y-3">
                      {completedRequests.map((row) => {
                        const status = getAssignmentRequestStatus({
                          isActive: row.requestCompleted ? true : row.requestActive,
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
                              {row.assignedCount} services pris sur {row.requestedCount}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title="Demandes necessitant attention"
                  priority={attentionRows.length > 0 ? 'high' : 'default'}
                  icon={AlertCircle}
                >
                  {attentionRows.length === 0 ? (
                    <EmptyState title="Aucune situation prioritaire détectée." />
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
                                <Badge tone="danger">
                                  {row.noResponseClients} service non pris
                                </Badge>
                              )}
                              {row.requestCompleted && (
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
