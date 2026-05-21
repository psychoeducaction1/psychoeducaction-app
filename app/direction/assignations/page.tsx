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

type FilterOption = 'all' | 'active' | 'in_progress' | 'completed' | 'inactive'

type Profile = {
  id: string
  full_name: string | null
  email: string | null
}

type AssignmentRequest = {
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  request_comment: string | null
}

type AssignmentRow = {
  id: string
  fullName: string
  email: string
  requestActive: boolean
  requestedCount: number
  assignedCount: number
  remainingCount: number
  requestComment: string
}

const filterOptions: Array<{ value: FilterOption; label: string }> = [
  { value: 'all', label: 'Toutes' },
  { value: 'active', label: 'Actives' },
  { value: 'in_progress', label: 'En cours' },
  { value: 'completed', label: 'Complétées' },
  { value: 'inactive', label: 'Inactives' },
]

function matchesFilter(row: AssignmentRow, filter: FilterOption): boolean {
  const status = getAssignmentRequestStatus({
    isActive: row.requestActive,
    remainingCount: row.remainingCount,
    requestedCount: row.requestedCount,
  })

  if (filter === 'all') return true
  if (filter === 'active') return row.requestActive
  if (filter === 'in_progress') return status.label === 'demande en cours'
  if (filter === 'completed') return status.label === 'demande complétée'
  return status.label === 'demande inactive'
}

export default function DirectionAssignationsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<AssignmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterOption>('all')

  useEffect(() => {
    const loadAssignations = async () => {
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

      const { data: assignmentRequestsData, error: assignmentRequestsError } =
        await supabase
          .from('assignment_requests')
          .select(
            'professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment'
          )
          .in('professional_id', professionalIds)

      if (assignmentRequestsError) {
        setError(assignmentRequestsError.message)
        setLoading(false)
        return
      }

      const assignmentRequests =
        (assignmentRequestsData ?? []) as AssignmentRequest[]
      const requestByProfessionalId = new Map<string, AssignmentRequest>()

      assignmentRequests.forEach((request) => {
        if (!requestByProfessionalId.has(request.professional_id)) {
          requestByProfessionalId.set(request.professional_id, request)
        }
      })

      const nextRows = professionals.map((profile) => {
        const request = requestByProfessionalId.get(profile.id)

        return {
          id: profile.id,
          fullName: profile.full_name ?? '-',
          email: profile.email ?? '-',
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

    loadAssignations()
  }, [router])

  const visibleRows = useMemo(
    () =>
      rows
        .filter((row) => matchesFilter(row, filter))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr')),
    [filter, rows]
  )

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <p className="text-sm font-medium text-[#9b6a3d]">Direction</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#332820]">
              Assignations
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
              Suivi centralise des demandes d&apos;assignation par professionnel.
            </p>
          </div>

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement des demandes...
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
                <div className="flex flex-wrap gap-2">
                  {filterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFilter(option.value)}
                      className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                        filter === option.value
                          ? 'bg-[#efe1d2] text-[#6d3f1f]'
                          : 'text-[#6c5a4d] hover:bg-[#f5ebe0] hover:text-[#3b2d24]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </section>

              <div className={`mt-6 ${tableShellClass}`}>
                <table className={tableClass}>
                  <thead className={tableHeaderClass}>
                    <tr>
                      <th className={tableHeadCellClass}>Professionnel</th>
                      <th className={tableHeadCellClass}>Email</th>
                      <th className={tableHeadCellClass}>Statut de la demande</th>
                      <th className={tableHeadCellClass}>Clients demandés</th>
                      <th className={tableHeadCellClass}>Clients assignés</th>
                      <th className={tableHeadCellClass}>Clients restants</th>
                      <th className={tableHeadCellClass}>Commentaire</th>
                    </tr>
                  </thead>
                  <tbody className={tableBodyClass}>
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8">
                          <EmptyState
                            title="Aucune demande trouvee"
                            description="Changez de filtre pour voir d'autres demandes."
                          />
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((row) => {
                        const status = getAssignmentRequestStatus({
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
                              <Badge tone={status.tone}>{status.label}</Badge>
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
