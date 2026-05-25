'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { Badge, EmptyState, PageHeader } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import {
  getRemainingAssignmentCount,
  getUsedAssignmentCount,
} from '../shared'

type AssignmentRequestHistoryRow = {
  id: string
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  request_comment: string | null
  created_at?: string | null
}

type AssignedClientHistoryRow = {
  assignment_request_id: string | null
  assigned_date: string | null
  is_active: boolean | null
}

type RequestStatus = 'Completee' | 'Active'

type RequestCardData = {
  request: AssignmentRequestHistoryRow
  createdDate: Date | null
  completionDate: Date | null
  activeAssignmentCount: number
  remainingCount: number
  serviceTakenCount: number
  serviceNotTakenCount: number
  pendingCount: number
  durationLabel: string
  status: RequestStatus
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null

  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(value: Date | string | null | undefined): string {
  const date = value instanceof Date ? value : parseDate(value)

  if (!date) return '-'

  return new Intl.DateTimeFormat('fr-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function getDaysBetween(startDate: Date | null, endDate: Date | null): number | null {
  if (!startDate || !endDate) return null

  const start = new Date(startDate)
  const end = new Date(endDate)
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)

  return Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  )
}

function formatDuration(
  status: RequestStatus,
  startDate: Date | null,
  completionDate: Date | null
): string {
  const endDate = status === 'Completee' ? completionDate : new Date()
  const dayCount = getDaysBetween(startDate, endDate)

  if (dayCount === null) {
    return status === 'Completee'
      ? 'Duree non disponible'
      : 'Date de debut non disponible'
  }

  const suffix = `${dayCount} jour${dayCount > 1 ? 's' : ''}`
  return status === 'Completee' ? `Completee en ${suffix}` : `Active depuis ${suffix}`
}

function isMissingCreatedAtError(message: string): boolean {
  const normalizedMessage = message.toLowerCase()
  return (
    normalizedMessage.includes('created_at') &&
    (normalizedMessage.includes('column') ||
      normalizedMessage.includes('schema cache'))
  )
}

function getClientDate(client: AssignedClientHistoryRow): Date | null {
  return parseDate(client.assigned_date)
}

function getEstimatedCompletionDate(
  clients: AssignedClientHistoryRow[],
  remainingCount: number,
  createdAt: string | null | undefined
): Date | null {
  if (remainingCount > 0) return null

  const clientDates = clients
    .map(getClientDate)
    .filter((date): date is Date => Boolean(date))
    .sort((firstDate, secondDate) => secondDate.getTime() - firstDate.getTime())

  return clientDates[0] ?? parseDate(createdAt)
}

export default function ProfessionnelHistoriquePage() {
  const router = useRouter()
  const [requests, setRequests] = useState<AssignmentRequestHistoryRow[]>([])
  const [clients, setClients] = useState<AssignedClientHistoryRow[]>([])
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
        'id, professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment'
      const [requestsResponseWithDate, clientsResponse] = await Promise.all([
        supabase
          .from('assignment_requests')
          .select(`${baseSelect}, created_at`)
          .eq('professional_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('assigned_clients')
          .select('assignment_request_id, assigned_date, is_active')
          .eq('professional_id', user.id)
          .order('assigned_date', { ascending: false }),
      ])

      if (clientsResponse.error) {
        setError(clientsResponse.error.message)
        setLoading(false)
        return
      }

      if (!requestsResponseWithDate.error) {
        setRequests(
          (requestsResponseWithDate.data ?? []) as AssignmentRequestHistoryRow[]
        )
        setClients((clientsResponse.data ?? []) as AssignedClientHistoryRow[])
        setLoading(false)
        return
      }

      if (!isMissingCreatedAtError(requestsResponseWithDate.error.message)) {
        setError(requestsResponseWithDate.error.message)
        setLoading(false)
        return
      }

      const requestsResponseWithoutDate = await supabase
        .from('assignment_requests')
        .select(baseSelect)
        .eq('professional_id', user.id)

      if (requestsResponseWithoutDate.error) {
        setError(requestsResponseWithoutDate.error.message)
        setLoading(false)
        return
      }

      setRequests(
        (requestsResponseWithoutDate.data ?? []) as AssignmentRequestHistoryRow[]
      )
      setClients((clientsResponse.data ?? []) as AssignedClientHistoryRow[])
      setLoading(false)
    }

    loadHistory()
  }, [router])

  const requestCards = useMemo<RequestCardData[]>(() => {
    const clientsByRequestId = new Map<string, AssignedClientHistoryRow[]>()

    clients.forEach((client) => {
      if (!client.assignment_request_id) return

      const requestClients = clientsByRequestId.get(client.assignment_request_id) ?? []
      requestClients.push(client)
      clientsByRequestId.set(client.assignment_request_id, requestClients)
    })

    return [...requests]
      .map((request) => {
        const requestClients = clientsByRequestId.get(request.id) ?? []
        const activeAssignmentCount = getUsedAssignmentCount(requestClients)
        const serviceTakenCount = requestClients.filter(
          (client) => client.is_active === true
        ).length
        const serviceNotTakenCount = requestClients.filter(
          (client) => client.is_active === false
        ).length
        const pendingCount = requestClients.filter(
          (client) => client.is_active === null
        ).length
        const requestedCount = request.requested_count ?? 0
        const remainingCount = getRemainingAssignmentCount(
          requestedCount,
          activeAssignmentCount
        )
        const status: RequestStatus = remainingCount === 0 ? 'Completee' : 'Active'
        const createdDate = parseDate(request.created_at)
        const completionDate = getEstimatedCompletionDate(
          requestClients,
          remainingCount,
          request.created_at
        )

        return {
          request,
          createdDate,
          completionDate,
          activeAssignmentCount,
          remainingCount,
          serviceTakenCount,
          serviceNotTakenCount,
          pendingCount,
          durationLabel: formatDuration(status, createdDate, completionDate),
          status,
        }
      })
      .sort((firstCard, secondCard) => {
        const firstDate = firstCard.createdDate?.getTime() ?? 0
        const secondDate = secondCard.createdDate?.getTime() ?? 0
        return secondDate - firstDate
      })
  }, [clients, requests])

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <PageHeader
            eyebrow="Espace professionnel"
            title="Historique"
            description="Demandes d'assignation conservees dans l'application."
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
            <div className="space-y-4">
              {requestCards.length === 0 ? (
                <EmptyState title="Aucune demande a afficher." />
              ) : (
                requestCards.map((card, index) => {
                  const requestedCount = card.request.requested_count ?? 0
                  const isCompleted = card.status === 'Completee'

                  return (
                    <article
                      key={`${card.request.id}-${card.request.professional_id}-${
                        card.request.created_at ?? index
                      }`}
                      className="relative rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4 shadow-[0_1px_2px_rgba(72,49,30,0.06)] sm:p-5"
                    >
                      <span className="absolute left-0 top-6 h-10 w-1 rounded-r-full bg-[#c98b52]" />
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={isCompleted ? 'success' : 'warning'}>
                              {isCompleted ? 'Completee' : 'Active'}
                            </Badge>
                            <span className="text-sm font-medium text-[#8a6f5d]">
                              {card.durationLabel}
                            </span>
                          </div>
                          <h2 className="mt-3 text-base font-semibold text-[#332820]">
                            Demande du {formatDate(card.createdDate)}
                          </h2>
                          <p className="mt-1 text-sm text-[#7a6859]">
                            Completion estimee : {formatDate(card.completionDate)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                            Demande
                          </p>
                          <p className="mt-1 text-xl font-semibold text-[#332820]">
                            {requestedCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                            Services pris
                          </p>
                          <p className="mt-1 text-xl font-semibold text-[#332820]">
                            {card.activeAssignmentCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#d8e2c7] bg-[#f6faef] p-3">
                          <p className="text-xs font-medium uppercase text-[#6f7a58]">
                            Services pris
                          </p>
                          <p className="mt-1 text-xl font-semibold text-[#3f4f2d]">
                            {card.serviceTakenCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#e9cfc5] bg-[#fff6f2] p-3">
                          <p className="text-xs font-medium uppercase text-[#9a6a59]">
                            Services non pris
                          </p>
                          <p className="mt-1 text-xl font-semibold text-[#6f3f32]">
                            {card.serviceNotTakenCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                            Restant
                          </p>
                          <p className="mt-1 text-xl font-semibold text-[#332820]">
                            {card.remainingCount}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-[0.35fr_0.65fr]">
                        <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                            En attente
                          </p>
                          <p className="mt-1 text-sm font-semibold text-[#332820]">
                            {card.pendingCount}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                            Commentaire
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">
                            {card.request.request_comment?.trim() || '-'}
                          </p>
                        </div>
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
