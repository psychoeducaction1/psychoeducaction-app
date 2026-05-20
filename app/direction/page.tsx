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
} from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'

type Profile = {
  id: string
  full_name: string | null
  email: string | null
  pref_client_types: string[] | null
  pref_modalities: string[] | null
  pref_followup_types: string[] | null
  pref_notes: string | null
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
  clientTypes: string
  modalities: string
  followupTypes: string
  notes: string
  totalAssignedClients: number
  activeClients: number
  noResponseClients: number
  requestActive: boolean
  requestedCount: number
  assignedCount: number
  remainingCount: number
  requestComment: string
}

type SortOption = 'remaining_desc' | 'active_asc' | 'name_asc'

function arrayToText(value: string[] | null): string {
  return value?.join(', ') ?? ''
}

export default function DirectionPage() {
  const router = useRouter()
  const [rows, setRows] = useState<DirectionRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeRequestsOnly, setActiveRequestsOnly] = useState(false)
  const [hasRemainingOnly, setHasRemainingOnly] = useState(false)
  const [noRemainingOnly, setNoRemainingOnly] = useState(false)
  const [sortOption, setSortOption] = useState<SortOption>('name_asc')

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
        .select(
          'id, full_name, email, pref_client_types, pref_modalities, pref_followup_types, pref_notes'
        )
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

      const nextRows: DirectionRow[] = professionals.map((profile) => {
        const request = requestByProfessionalId.get(profile.id)
        const clientStats = clientStatsByProfessionalId.get(profile.id)

        return {
          id: profile.id,
          fullName: profile.full_name ?? '-',
          email: profile.email ?? '-',
          clientTypes: arrayToText(profile.pref_client_types),
          modalities: arrayToText(profile.pref_modalities),
          followupTypes: arrayToText(profile.pref_followup_types),
          notes: profile.pref_notes?.trim() ?? '',
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

  const visibleRows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()

    return rows
      .filter((row) => {
        const matchesSearch =
          normalizedSearch.length === 0 ||
          [
            row.fullName,
            row.email,
            row.clientTypes,
            row.modalities,
            row.notes,
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalizedSearch)

        if (!matchesSearch) return false
        if (activeRequestsOnly && !row.requestActive) return false
        if (hasRemainingOnly && row.remainingCount <= 0) return false
        if (noRemainingOnly && row.remainingCount !== 0) return false

        return true
      })
      .sort((a, b) => {
        if (sortOption === 'remaining_desc') {
          return b.remainingCount - a.remainingCount
        }

        if (sortOption === 'active_asc') {
          return a.activeClients - b.activeClients
        }

        return a.fullName.localeCompare(b.fullName, 'fr')
      })
  }, [activeRequestsOnly, hasRemainingOnly, noRemainingOnly, rows, searchQuery, sortOption])

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <p className="text-sm font-medium text-[#9b6a3d]">Direction</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#332820]">
            Dashboard Direction
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
            Vue claire des professionnels et de leurs demandes d&apos;assignation.
          </p>
        </div>

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
        <>
          <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
            <div className="grid gap-4 lg:grid-cols-3">
              <label className="block text-sm font-medium text-[#5d4a3d] lg:col-span-2">
                Recherche
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Nom, email, clientèles, modalités, notes"
                  className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                />
              </label>

              <label className="block text-sm font-medium text-[#5d4a3d]">
                Tri
                <select
                  value={sortOption}
                  onChange={(event) => setSortOption(event.target.value as SortOption)}
                  className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                >
                  <option value="remaining_desc">Plus de places restantes</option>
                  <option value="active_asc">Moins de clients actifs</option>
                  <option value="name_asc">Nom alphabétique</option>
                </select>
              </label>
            </div>

            <div className="mt-4 flex flex-col gap-3 text-sm text-[#6c5a4d] sm:flex-row sm:flex-wrap">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={activeRequestsOnly}
                  onChange={(event) => setActiveRequestsOnly(event.target.checked)}
                  className="h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
                />
                Demande active uniquement
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hasRemainingOnly}
                  onChange={(event) => setHasRemainingOnly(event.target.checked)}
                  className="h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
                />
                A encore des places
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={noRemainingOnly}
                  onChange={(event) => setNoRemainingOnly(event.target.checked)}
                  className="h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
                />
                Aucun restant
              </label>
            </div>
          </section>

          <div className={`mt-6 ${tableShellClass}`}>
            <table className={tableClass}>
              <thead className={tableHeaderClass}>
                <tr>
                  <th className={tableHeadCellClass}>Nom</th>
                  <th className={tableHeadCellClass}>Email</th>
                  <th className={tableHeadCellClass}>
                    Clients assignés total
                  </th>
                  <th className={tableHeadCellClass}>
                    Clients actifs
                  </th>
                  <th className={tableHeadCellClass}>
                    Sans réponse / service non pris
                  </th>
                  <th className={tableHeadCellClass}>
                    Statut demande
                  </th>
                  <th className={tableHeadCellClass}>
                    Clients demandés
                  </th>
                  <th className={tableHeadCellClass}>
                    Clients assignés via demande
                  </th>
                  <th className={tableHeadCellClass}>
                    Clients restants
                  </th>
                  <th className={tableHeadCellClass}>
                    Commentaire
                  </th>
                </tr>
              </thead>
              <tbody className={tableBodyClass}>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8">
                      <EmptyState
                        title="Aucun professionnel trouve"
                        description="Ajustez la recherche ou les filtres pour elargir la liste."
                      />
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => (
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
                        {row.totalAssignedClients}
                      </td>
                      <td className={tableCellClass}>
                        <Badge tone="success">{row.activeClients} actifs</Badge>
                      </td>
                      <td className={tableCellClass}>
                        <Badge tone={row.noResponseClients > 0 ? 'warning' : 'muted'}>
                          {row.noResponseClients} sans reponse
                        </Badge>
                      </td>
                      <td className={tableCellClass}>
                        <Badge
                          tone={
                            getAssignmentRequestStatus({
                              isActive: row.requestActive,
                              remainingCount: row.remainingCount,
                              requestedCount: row.requestedCount,
                            }).tone
                          }
                        >
                          {
                            getAssignmentRequestStatus({
                              isActive: row.requestActive,
                              remainingCount: row.remainingCount,
                              requestedCount: row.requestedCount,
                            }).label
                          }
                        </Badge>
                      </td>
                      <td className={tableCellClass}>{row.requestedCount}</td>
                      <td className={tableCellClass}>{row.assignedCount}</td>
                      <td className={tableCellClass}>
                        <Badge tone={row.remainingCount > 0 ? 'warning' : 'success'}>
                          {row.remainingCount} restants
                        </Badge>
                      </td>
                      <td className={tableCellClass}>{row.requestComment}</td>
                    </tr>
                  ))
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
