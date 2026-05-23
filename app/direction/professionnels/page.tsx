'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
  EmptyState,
  getAssignmentRequestStatus,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeaderClass,
  tableRowClass,
  tableShellClass,
} from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import { getRemainingAssignmentCount } from '@/app/professionnel/shared'

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
  usedAssignments: number
}

type ProfessionalRow = {
  id: string
  fullName: string
  email: string
  requestActive: boolean
  requestedCount: number
  assignedCount: number
  remainingCount: number
  activeClients: number
  noResponseClients: number
  requestComment: string
}

export default function DirectionProfessionnelsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<ProfessionalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const loadProfessionals = async () => {
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
          usedAssignments: 0,
        }

        currentStats.total += 1

        if (client.is_active !== false) {
          currentStats.usedAssignments += 1
        }

        if (client.is_active === true) {
          currentStats.active += 1
        } else if (client.is_active === false) {
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

        const requestedCount = request?.requested_count ?? 0
        const assignedCount = clientStats?.usedAssignments ?? 0
        const remainingCount = getRemainingAssignmentCount(
          requestedCount,
          assignedCount
        )

        return {
          id: profile.id,
          fullName: profile.full_name ?? '-',
          email: profile.email ?? '-',
          requestActive: request?.is_active ?? false,
          requestedCount,
          assignedCount,
          remainingCount,
          activeClients: clientStats?.active ?? 0,
          noResponseClients: clientStats?.noResponse ?? 0,
          requestComment: request?.request_comment?.trim() || '-',
        }
      })

      setRows(nextRows)
      setLoading(false)
    }

    loadProfessionals()
  }, [router])

  const visibleRows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()

    return rows.filter((row) => {
      if (!normalizedSearch) return true

      return [row.fullName, row.email, row.requestComment]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    })
  }, [rows, searchQuery])

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <p className="text-sm font-medium text-[#9b6a3d]">Direction</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#332820]">
              Professionnels
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
              Liste detaillee des professionnels, de leurs demandes et de leurs
              clients assignes.
            </p>
          </div>

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement des professionnels...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Erreur: {error}
            </div>
          )}

          {!loading && !error && (
            <>
              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
                <label className="block text-sm font-medium text-[#5d4a3d]">
                  Recherche
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Nom, email, commentaire"
                    className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  />
                </label>
              </section>

              <div className={`mt-6 ${tableShellClass}`}>
                <table className={tableClass}>
                  <thead className={tableHeaderClass}>
                    <tr>
                      <th className={tableHeadCellClass}>Nom</th>
                      <th className={tableHeadCellClass}>Email</th>
                      <th className={tableHeadCellClass}>Statut demande</th>
                      <th className={tableHeadCellClass}>Clients demandes</th>
                      <th className={tableHeadCellClass}>Clients assignes</th>
                      <th className={tableHeadCellClass}>Clients restants</th>
                      <th className={tableHeadCellClass}>Clients actifs</th>
                      <th className={tableHeadCellClass}>
                        Sans reponse / service non pris
                      </th>
                      <th className={tableHeadCellClass}>Commentaire</th>
                    </tr>
                  </thead>
                  <tbody className={tableBodyClass}>
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8">
                          <EmptyState
                            title="Aucun professionnel trouve"
                            description="Ajustez la recherche pour elargir la liste."
                          />
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((row) => {
                        const requestStatus = getAssignmentRequestStatus({
                          isActive: row.requestActive,
                          remainingCount: row.remainingCount,
                          requestedCount: row.requestedCount,
                        })

                        return (
                          <tr key={row.id} className={tableRowClass}>
                            <td className="px-4 py-3 align-top text-[#332820]">
                              <Link
                                href={`/professionnel/${row.id}`}
                                className="font-medium text-[#6d3f1f] underline decoration-[#d9b591] underline-offset-2 hover:decoration-[#9b6a3d]"
                              >
                                {row.fullName}
                              </Link>
                            </td>
                            <td className={tableCellClass}>{row.email}</td>
                            <td className={tableCellClass}>
                              <Badge tone={requestStatus.tone}>
                                {requestStatus.label}
                              </Badge>
                            </td>
                            <td className={tableCellClass}>{row.requestedCount}</td>
                            <td className={tableCellClass}>{row.assignedCount}</td>
                            <td className={tableCellClass}>
                              <Badge
                                tone={row.remainingCount > 0 ? 'warning' : 'success'}
                              >
                                {row.remainingCount} restants
                              </Badge>
                            </td>
                            <td className={tableCellClass}>
                              <Badge tone="success">{row.activeClients} actifs</Badge>
                            </td>
                            <td className={tableCellClass}>
                              <Badge
                                tone={row.noResponseClients > 0 ? 'danger' : 'muted'}
                              >
                                {row.noResponseClients} sans reponse
                              </Badge>
                            </td>
                            <td className={tableCellClass}>{row.requestComment}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  )
}
