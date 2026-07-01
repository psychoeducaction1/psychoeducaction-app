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

type WaitingListClient = {
  status: string | null
  priority_level: string | null
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
  pending: number
  usedAssignments: number
}

type WaitingListStats = {
  waiting: number
  urgent: number
}

type DirectionRow = {
  id: string
  fullName: string
  email: string
  totalAssignedClients: number
  activeClients: number
  noResponseClients: number
  pendingClients: number
  requestActive: boolean
  requestedCount: number
  assignedCount: number
  remainingCount: number
  unassignedCount: number
  requestComment: string
  requestCompleted: boolean
}

export default function DirectionPage() {
  const router = useRouter()
  const [rows, setRows] = useState<DirectionRow[]>([])
  const [waitingListStats, setWaitingListStats] = useState<WaitingListStats>({
    waiting: 0,
    urgent: 0,
  })
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

      const { data: waitingListData, error: waitingListError } = await supabase
        .from('waiting_list_clients')
        .select('status, priority_level')

      if (waitingListError) {
        setError(waitingListError.message)
        setLoading(false)
        return
      }

      const waitingListClients = (waitingListData ?? []) as WaitingListClient[]
      const waitingClients = waitingListClients.filter(
        (client) => client.status === 'waiting'
      )

      setWaitingListStats({
        waiting: waitingClients.length,
        urgent: waitingClients.filter(
          (client) =>
            client.priority_level === 'urgent' ||
            client.priority_level === 'existing_or_transfer'
        ).length,
      })

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
      const clientStatsByProfessionalId = new Map<string, ClientStats>()

      assignedClients.forEach((client) => {
        if (!client.professional_id) return

        const currentProfessionalStats = clientStatsByProfessionalId.get(
          client.professional_id
        ) ?? {
          total: 0,
          active: 0,
          noResponse: 0,
          pending: 0,
          usedAssignments: 0,
        }

        currentProfessionalStats.total += 1
        currentProfessionalStats.usedAssignments += 1

        if (client.is_active === true) {
          currentProfessionalStats.active += 1
        } else if (client.is_active === false) {
          currentProfessionalStats.noResponse += 1
        } else {
          currentProfessionalStats.pending += 1
        }

        clientStatsByProfessionalId.set(
          client.professional_id,
          currentProfessionalStats
        )

        if (!client.assignment_request_id) return

        const currentRequestStats = clientStatsByRequestId.get(
          client.assignment_request_id
        ) ?? {
          total: 0,
          active: 0,
          noResponse: 0,
          pending: 0,
          usedAssignments: 0,
        }

        currentRequestStats.total += 1
        currentRequestStats.usedAssignments += 1

        if (client.is_active === true) {
          currentRequestStats.active += 1
        } else if (client.is_active === false) {
          currentRequestStats.noResponse += 1
        } else {
          currentRequestStats.pending += 1
        }

        clientStatsByRequestId.set(client.assignment_request_id, currentRequestStats)
      })

      const requestsByProfessionalId = new Map<string, AssignmentRequest[]>()

      assignmentRequests.forEach((request) => {
        const currentRequests = requestsByProfessionalId.get(request.professional_id) ?? []
        currentRequests.push(request)
        requestsByProfessionalId.set(request.professional_id, currentRequests)
      })

      const nextRows = professionals.map((profile) => {
        const professionalRequests = requestsByProfessionalId.get(profile.id) ?? []
        const getRequestMetrics = (currentRequest: AssignmentRequest) => {
          const requestStats = clientStatsByRequestId.get(currentRequest.id)

          return getAssignmentRequestMetrics({
            isActive: currentRequest.is_active,
            requestedCount: currentRequest.requested_count,
            acceptedCount: requestStats?.total ?? 0,
            remainingCount: Math.max(
              (currentRequest.requested_count ?? 0) - (requestStats?.total ?? 0),
              0
            ),
          })
        }
        const activeRequest =
          professionalRequests.find((currentRequest) => {
            return getRequestMetrics(currentRequest).isActive
          }) ?? null
        const completedRequest =
          professionalRequests.find((currentRequest) => {
            return getRequestMetrics(currentRequest).isCompleted
          }) ?? null
        const request = activeRequest ?? completedRequest ?? professionalRequests[0]
        const requestClientStats = request
          ? clientStatsByRequestId.get(request.id)
          : undefined
        const professionalClientStats = clientStatsByProfessionalId.get(profile.id)

        const requestMetrics = request
          ? getRequestMetrics(request)
          : getAssignmentRequestMetrics({
              isActive: null,
              requestedCount: null,
              acceptedCount: null,
              remainingCount: null,
            })
        const unassignedCount = requestMetrics.isActive
          ? Math.max(
              requestMetrics.requestedCount - (requestClientStats?.total ?? 0),
              0
            )
          : 0

        return {
          id: profile.id,
          fullName: profile.full_name ?? '-',
          email: profile.email ?? '-',
          totalAssignedClients: professionalClientStats?.total ?? 0,
          activeClients: professionalClientStats?.active ?? 0,
          noResponseClients: professionalClientStats?.noResponse ?? 0,
          pendingClients: professionalClientStats?.pending ?? 0,
          requestActive: requestMetrics.isActive,
          requestedCount: requestMetrics.requestedCount,
          assignedCount: requestClientStats?.total ?? 0,
          remainingCount: requestMetrics.isActive ? requestMetrics.remainingCount : 0,
          unassignedCount,
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
      pendingClients: rows.reduce((total, row) => total + row.pendingClients, 0),
      noResponseClients: rows.reduce((total, row) => total + row.noResponseClients, 0),
      remainingPlaces: rows.reduce(
        (total, row) => total + (row.requestActive ? row.unassignedCount : 0),
        0
      ),
    }),
    [rows]
  )

  const professionalsWithRemaining = useMemo(
    () =>
      rows
        .filter((row) => row.requestActive && row.unassignedCount > 0)
        .sort((a, b) => b.unassignedCount - a.unassignedCount)
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
            row.pendingClients > 0
        )
        .sort((a, b) => b.pendingClients - a.pendingClients)
        .slice(0, 8),
    [rows]
  )
  const directionAlerts = [
    professionalsWithRemaining.some((row) => row.unassignedCount >= 3)
      ? {
          title: 'Capacité disponible importante',
          description: `${
            professionalsWithRemaining.filter((row) => row.unassignedCount >= 3).length
          } professionnel${
            professionalsWithRemaining.filter((row) => row.unassignedCount >= 3)
              .length > 1
              ? 's ont'
              : ' a'
          } encore plusieurs assignations à faire.`,
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
    waitingListStats.urgent > 0
      ? {
          title: 'Priorités en liste d’attente',
          description: `${waitingListStats.urgent} client${
            waitingListStats.urgent > 1 ? 's sont' : ' est'
          } urgent${waitingListStats.urgent > 1 ? 's' : ''} ou en transfert.`,
          tone: 'warning' as const,
        }
      : null,
    dashboardStats.pendingClients > 0
      ? {
          title: 'Confirmations à suivre',
          description: `${dashboardStats.pendingClients} client${
            dashboardStats.pendingClients > 1 ? 's assignés attendent' : ' assigné attend'
          } une confirmation du service.`,
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

              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
                <StatCard
                  label="Clients en liste d’attente"
                  value={waitingListStats.waiting}
                  helper="Clients non encore assignés"
                  tone="warm"
                  priority={waitingListStats.waiting > 0 ? 'high' : 'default'}
                  icon={Users}
                />
                <StatCard
                  label="Assignations à faire"
                  value={dashboardStats.remainingPlaces}
                  helper="Places non assignées"
                  tone="warm"
                  priority={dashboardStats.remainingPlaces > 0 ? 'high' : 'default'}
                  icon={ClipboardList}
                />
                <StatCard
                  label="Clients assignés en attente"
                  value={dashboardStats.pendingClients}
                  helper="En attente de réponse du client"
                  tone="warm"
                  priority={dashboardStats.pendingClients > 0 ? 'high' : 'default'}
                  icon={ClipboardList}
                />
                <StatCard
                  label="Services pris"
                  value={dashboardStats.activeClients}
                  helper="Services confirmés"
                  tone="success"
                  priority="subtle"
                  icon={UserCheck}
                />
                <StatCard
                  label="Services non pris"
                  value={dashboardStats.noResponseClients}
                  helper="Services refusés"
                  tone="neutral"
                  priority="subtle"
                  icon={AlertCircle}
                />
                <StatCard
                  label="Alertes / urgences"
                  value={waitingListStats.urgent}
                  helper="Urgents ou transferts"
                  tone="warm"
                  priority={waitingListStats.urgent > 0 ? 'high' : 'default'}
                  icon={AlertCircle}
                />
              </section>

              <div className="grid gap-6 xl:grid-cols-3">
                <SectionCard
                  title="Professionnels disponibles pour assignation"
                  priority="high"
                  icon={ClipboardList}
                >
                  {professionalsWithRemaining.length === 0 ? (
                    <EmptyState title="Aucune assignation à faire actuellement." />
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
                          <Badge tone="warning">
                            {row.unassignedCount} à assigner
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                {completedRequests.length > 0 && (
                  <SectionCard
                    title="Demandes complétées récemment"
                    priority="subtle"
                    icon={CheckCircle2}
                  >
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
                              {row.assignedCount} assignation{row.assignedCount > 1 ? "s" : ""} sur {row.requestedCount}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </SectionCard>
                )}

                <SectionCard
                  title="Demandes nécessitant attention"
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
                              {row.pendingClients > 0 && (
                                <Badge tone="warning">
                                  {row.pendingClients} à confirmer
                                </Badge>
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
