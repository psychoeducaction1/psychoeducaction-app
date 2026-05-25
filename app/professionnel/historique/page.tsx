'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
  EmptyState,
  PageHeader,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeaderClass,
  tableRowClass,
  tableShellClass,
} from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'

type AssignmentRequestHistoryRow = {
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  request_comment: string | null
  created_at?: string | null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('fr-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function isMissingCreatedAtError(message: string): boolean {
  const normalizedMessage = message.toLowerCase()
  return (
    normalizedMessage.includes('created_at') &&
    (normalizedMessage.includes('column') ||
      normalizedMessage.includes('schema cache'))
  )
}

export default function ProfessionnelHistoriquePage() {
  const router = useRouter()
  const [requests, setRequests] = useState<AssignmentRequestHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadHistory = async () => {
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

      const baseSelect =
        'professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment'
      const responseWithDate = await supabase
        .from('assignment_requests')
        .select(`${baseSelect}, created_at`)
        .eq('professional_id', user.id)
        .order('created_at', { ascending: false })

      if (!responseWithDate.error) {
        setRequests((responseWithDate.data ?? []) as AssignmentRequestHistoryRow[])
        setLoading(false)
        return
      }

      if (!isMissingCreatedAtError(responseWithDate.error.message)) {
        setError(responseWithDate.error.message)
        setLoading(false)
        return
      }

      const responseWithoutDate = await supabase
        .from('assignment_requests')
        .select(baseSelect)
        .eq('professional_id', user.id)

      if (responseWithoutDate.error) {
        setError(responseWithoutDate.error.message)
        setLoading(false)
        return
      }

      setRequests((responseWithoutDate.data ?? []) as AssignmentRequestHistoryRow[])
      setLoading(false)
    }

    loadHistory()
  }, [router])

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Espace professionnel"
            title="Historique"
            description="Demandes d'assignation conservées dans l'application."
          />

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement de l&apos;historique...
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && (
            <div className={tableShellClass}>
              <table className={tableClass}>
                <thead className={tableHeaderClass}>
                  <tr>
                    <th className={tableHeadCellClass}>Date de création</th>
                    <th className={tableHeadCellClass}>Demandé</th>
                    <th className={tableHeadCellClass}>Comblé</th>
                    <th className={tableHeadCellClass}>Restant</th>
                    <th className={tableHeadCellClass}>Statut</th>
                    <th className={tableHeadCellClass}>Commentaire</th>
                  </tr>
                </thead>
                <tbody className={tableBodyClass}>
                  {requests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8">
                        <EmptyState title="Aucune demande à afficher." />
                      </td>
                    </tr>
                  ) : (
                    requests.map((request, index) => {
                      const requestedCount = request.requested_count ?? 0
                      const assignedCount = request.assigned_count ?? 0
                      const remainingCount = request.remaining_count ?? 0
                      const isCompleted = remainingCount === 0

                      return (
                        <tr
                          key={`${request.professional_id}-${request.created_at ?? index}`}
                          className={tableRowClass}
                        >
                          <td className={tableCellClass}>
                            {formatDate(request.created_at)}
                          </td>
                          <td className={tableCellClass}>{requestedCount}</td>
                          <td className={tableCellClass}>{assignedCount}</td>
                          <td className={tableCellClass}>
                            <Badge tone={remainingCount > 0 ? 'warning' : 'success'}>
                              {remainingCount} restant
                              {remainingCount > 1 ? 's' : ''}
                            </Badge>
                          </td>
                          <td className={tableCellClass}>
                            <Badge tone={isCompleted ? 'success' : 'warning'}>
                              {isCompleted ? 'complétée' : 'active'}
                            </Badge>
                          </td>
                          <td className={tableCellClass}>
                            {request.request_comment?.trim() || '-'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
