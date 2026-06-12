'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { Badge, buttonClass, EmptyState, PageHeader } from '@/components/ui/index'
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
  id: string
  assignment_request_id: string | null
  waiting_list_client_id: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  requester_name: string | null
  assigned_date: string | null
  meeting_modality: string | null
  closure_reason: string | null
  short_comment: string | null
  is_active: boolean | null
}

type RequestStatus = 'Completee' | 'Active'
type ServiceStatusValue = 'pending' | 'taken' | 'not_taken'

type RequestCardData = {
  request: AssignmentRequestHistoryRow
  clients: AssignedClientHistoryRow[]
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
      ? 'Durée non disponible'
      : 'Date de début non disponible'
  }

  const suffix = `${dayCount} jour${dayCount > 1 ? 's' : ''}`
  return status === 'Completee' ? `Complétée en ${suffix}` : `Active depuis ${suffix}`
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

function formatText(value: string | null | undefined): string {
  return value?.trim() || '-'
}

function getClientName(client: AssignedClientHistoryRow): string {
  return (
    [client.first_name, client.last_name]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(' ') || '-'
  )
}

function getServiceStatus(client: AssignedClientHistoryRow): {
  label: string
  tone: 'success' | 'danger' | 'warning'
} {
  if (client.is_active === true) {
    return { label: 'Service pris', tone: 'success' }
  }

  if (client.is_active === false) {
    return { label: 'Service non pris', tone: 'danger' }
  }

  return { label: 'En attente', tone: 'warning' }
}

function getServiceStatusValue(isActive: boolean | null): ServiceStatusValue {
  if (isActive === true) return 'taken'
  if (isActive === false) return 'not_taken'
  return 'pending'
}

function getIsActiveFromServiceStatus(
  status: ServiceStatusValue
): boolean | null {
  if (status === 'taken') return true
  if (status === 'not_taken') return false
  return null
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
  const [currentUserId, setCurrentUserId] = useState('')
  const [requests, setRequests] = useState<AssignmentRequestHistoryRow[]>([])
  const [clients, setClients] = useState<AssignedClientHistoryRow[]>([])
  const [expandedRequestIds, setExpandedRequestIds] = useState<Record<string, boolean>>(
    {}
  )
  const [expandedMotifIds, setExpandedMotifIds] = useState<Record<string, boolean>>(
    {}
  )
  const [editingClientIds, setEditingClientIds] = useState<Record<string, boolean>>(
    {}
  )
  const [savingClientIds, setSavingClientIds] = useState<Record<string, boolean>>(
    {}
  )
  const [clientMessages, setClientMessages] = useState<Record<string, string>>({})
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
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

      setCurrentUserId(user.id)

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
          .select(
            'id, assignment_request_id, waiting_list_client_id, first_name, last_name, email, phone, requester_name, assigned_date, meeting_modality, closure_reason, short_comment, is_active'
          )
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
        const wasPersistedAsCompleted =
          requestedCount > 0 &&
          ((request.assigned_count ?? 0) >= requestedCount ||
            request.remaining_count === 0)
        const status: RequestStatus =
          wasPersistedAsCompleted || remainingCount === 0
            ? 'Completee'
            : 'Active'
        const createdDate = parseDate(request.created_at)
        const completionDate = getEstimatedCompletionDate(
          requestClients,
          remainingCount,
          request.created_at
        )

        return {
          request,
          clients: requestClients,
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

  const toggleRequest = (requestId: string) => {
    setExpandedRequestIds((currentIds) => ({
      ...currentIds,
      [requestId]: !currentIds[requestId],
    }))
  }

  const toggleMotif = (clientId: string) => {
    setExpandedMotifIds((currentIds) => ({
      ...currentIds,
      [clientId]: !currentIds[clientId],
    }))
  }

  const toggleClientEdit = (clientId: string) => {
    setEditingClientIds((currentIds) => ({
      ...currentIds,
      [clientId]: !currentIds[clientId],
    }))
    setClientMessages((currentMessages) => ({
      ...currentMessages,
      [clientId]: '',
    }))
    setClientErrors((currentErrors) => ({ ...currentErrors, [clientId]: '' }))
  }

  const handleServiceStatusChange = async (
    client: AssignedClientHistoryRow,
    status: ServiceStatusValue
  ) => {
    if (!currentUserId) {
      setClientErrors((currentErrors) => ({
        ...currentErrors,
        [client.id]: 'Utilisateur introuvable. Veuillez recharger la page.',
      }))
      return
    }

    const nextIsActive = getIsActiveFromServiceStatus(status)

    setSavingClientIds((currentIds) => ({ ...currentIds, [client.id]: true }))
    setClientMessages((currentMessages) => ({
      ...currentMessages,
      [client.id]: '',
    }))
    setClientErrors((currentErrors) => ({ ...currentErrors, [client.id]: '' }))

    const { error: assignedClientError } = await supabase
      .from('assigned_clients')
      .update({ is_active: nextIsActive })
      .eq('id', client.id)
      .eq('professional_id', currentUserId)

    if (assignedClientError) {
      setClientErrors((currentErrors) => ({
        ...currentErrors,
        [client.id]: assignedClientError.message,
      }))
      setSavingClientIds((currentIds) => ({ ...currentIds, [client.id]: false }))
      return
    }

    if (client.waiting_list_client_id) {
      const { error: waitingListError } = await supabase.rpc(
        'sync_waiting_list_status_for_assigned_client',
        {
          assigned_client_id: client.id,
          next_is_active: nextIsActive,
        }
      )

      if (waitingListError) {
        setClientErrors((currentErrors) => ({
          ...currentErrors,
          [client.id]: waitingListError.message,
        }))
        setSavingClientIds((currentIds) => ({
          ...currentIds,
          [client.id]: false,
        }))
        return
      }
    }

    const nextClients = clients.map((currentClient) =>
      currentClient.id === client.id
        ? { ...currentClient, is_active: nextIsActive }
        : currentClient
    )

    setClients(nextClients)

    setClientMessages((currentMessages) => ({
      ...currentMessages,
      [client.id]: 'Statut sauvegardé.',
    }))
    setEditingClientIds((currentIds) => ({ ...currentIds, [client.id]: false }))
    setSavingClientIds((currentIds) => ({ ...currentIds, [client.id]: false }))
  }

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-6xl">
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
            <div className="space-y-4">
              {requestCards.length === 0 ? (
                <EmptyState title="Aucune demande à afficher." />
              ) : (
                requestCards.map((card, index) => {
                  const requestedCount = card.request.requested_count ?? 0
                  const isCompleted = card.status === 'Completee'
                  const isExpanded = expandedRequestIds[card.request.id] === true

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
                              {isCompleted ? 'Complétée' : 'Active'}
                            </Badge>
                            <span className="text-sm font-medium text-[#8a6f5d]">
                              {card.durationLabel}
                            </span>
                          </div>
                          <h2 className="mt-3 text-base font-semibold text-[#332820]">
                            Demande du {formatDate(card.createdDate)}
                          </h2>
                          <p className="mt-1 text-sm text-[#7a6859]">
                            Complétion estimée : {formatDate(card.completionDate)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleRequest(card.request.id)}
                          className={buttonClass('secondary')}
                        >
                          {isExpanded
                            ? 'Masquer les clients'
                            : 'Voir les clients assignés'}
                        </button>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                            Demande
                          </p>
                          <p className="mt-1 text-xl font-semibold text-[#332820]">
                            {requestedCount}
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

                      {isExpanded && (
                        <div className="mt-4 rounded-2xl border border-[#eadfd2] bg-white p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <h3 className="text-sm font-semibold uppercase text-[#8a6f5d]">
                              Clients assignés
                            </h3>
                            <span className="text-sm text-[#7a6859]">
                              {card.clients.length} client
                              {card.clients.length > 1 ? 's' : ''}
                            </span>
                          </div>

                          {card.clients.length === 0 ? (
                            <div className="mt-3">
                              <EmptyState title="Aucun client lié à cette demande." />
                            </div>
                          ) : (
                            <div className="mt-4 grid gap-3 xl:grid-cols-2">
                              {card.clients.map((client) => {
                                const serviceStatus = getServiceStatus(client)
                                const motifExpanded =
                                  expandedMotifIds[client.id] === true
                                const isEditing =
                                  editingClientIds[client.id] === true
                                const hasMotif = Boolean(client.short_comment?.trim())

                                return (
                                  <article
                                    key={client.id}
                                    className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4"
                                  >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                      <div>
                                        <h4 className="text-base font-semibold text-[#332820]">
                                          {getClientName(client)}
                                        </h4>
                                        <p className="mt-1 text-sm text-[#7a6859]">
                                          Requérant:{' '}
                                          <span className="font-semibold text-[#5d4a3d]">
                                            {formatText(client.requester_name)}
                                          </span>
                                        </p>
                                      </div>
                                      <Badge tone={serviceStatus.tone}>
                                        {serviceStatus.label}
                                      </Badge>
                                    </div>

                                    <div className="mt-4 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                          <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                                            Statut du service
                                          </p>
                                          <p className="mt-1 text-sm text-[#332820]">
                                            {serviceStatus.label}
                                          </p>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => toggleClientEdit(client.id)}
                                          disabled={savingClientIds[client.id] === true}
                                          className={buttonClass('secondary')}
                                        >
                                          {isEditing ? 'Annuler' : 'Modifier'}
                                        </button>
                                      </div>
                                      {isEditing && (
                                        <label
                                          htmlFor={`service-status-${client.id}`}
                                          className="mt-3 block text-xs font-medium uppercase text-[#8a6f5d]"
                                        >
                                          Nouveau statut
                                          <select
                                            id={`service-status-${client.id}`}
                                            value={getServiceStatusValue(
                                              client.is_active
                                            )}
                                            onChange={(event) =>
                                              void handleServiceStatusChange(
                                                client,
                                                event.target
                                                  .value as ServiceStatusValue
                                              )
                                            }
                                            disabled={
                                              savingClientIds[client.id] === true
                                            }
                                            className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm normal-case text-[#332820] outline-none transition focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] disabled:cursor-wait disabled:bg-[#f7efe7] disabled:text-[#8a6f5d]"
                                          >
                                            <option value="pending">
                                              En attente
                                            </option>
                                            <option value="taken">
                                              Service pris
                                            </option>
                                            <option value="not_taken">
                                              Service non pris
                                            </option>
                                          </select>
                                        </label>
                                      )}
                                      {savingClientIds[client.id] === true && (
                                        <p className="mt-2 text-xs text-[#7a6859]">
                                          Sauvegarde en cours...
                                        </p>
                                      )}
                                      {clientMessages[client.id] && (
                                        <p className="mt-2 text-xs font-medium text-[#3f4f2d]">
                                          {clientMessages[client.id]}
                                        </p>
                                      )}
                                      {clientErrors[client.id] && (
                                        <p className="mt-2 text-xs font-medium text-red-700">
                                          {clientErrors[client.id]}
                                        </p>
                                      )}
                                    </div>

                                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                                      <div className="min-w-0 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                                        <dt className="text-xs font-medium uppercase text-[#8a6f5d]">
                                          Courriel
                                        </dt>
                                        <dd className="mt-1 break-words text-[#332820]">
                                          {formatText(client.email)}
                                        </dd>
                                      </div>
                                      <div className="min-w-0 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                                        <dt className="text-xs font-medium uppercase text-[#8a6f5d]">
                                          Téléphone
                                        </dt>
                                        <dd className="mt-1 break-words text-[#332820]">
                                          {formatText(client.phone)}
                                        </dd>
                                      </div>
                                      <div className="min-w-0 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                                        <dt className="text-xs font-medium uppercase text-[#8a6f5d]">
                                          Date d’assignation
                                        </dt>
                                        <dd className="mt-1 text-[#332820]">
                                          {formatDate(client.assigned_date)}
                                        </dd>
                                      </div>
                                      <div className="min-w-0 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                                        <dt className="text-xs font-medium uppercase text-[#8a6f5d]">
                                          Modalité
                                        </dt>
                                        <dd className="mt-1 break-words text-[#332820]">
                                          {formatText(client.meeting_modality)}
                                        </dd>
                                      </div>
                                    </dl>

                                    {client.closure_reason?.trim() && (
                                      <div className="mt-3 rounded-xl border border-[#e9cfc5] bg-[#fff6f2] p-3 text-sm">
                                        <p className="text-xs font-medium uppercase text-[#9a6a59]">
                                          Motif de non-prise
                                        </p>
                                        <p className="mt-1 whitespace-pre-wrap break-words text-[#6f3f32]">
                                          {client.closure_reason}
                                        </p>
                                      </div>
                                    )}

                                    {hasMotif && (
                                      <div className="mt-3 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3 text-sm">
                                        <p className="text-xs font-medium uppercase text-[#8a6f5d]">
                                          Motif de consultation
                                        </p>
                                        <p
                                          className={`mt-1 whitespace-pre-wrap break-words text-[#332820] ${
                                            motifExpanded
                                              ? ''
                                              : 'max-h-12 overflow-hidden'
                                          }`}
                                        >
                                          {client.short_comment}
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => toggleMotif(client.id)}
                                          className="mt-2 text-sm font-semibold text-[#8a5633] underline decoration-[#d9b591] underline-offset-2 hover:decoration-[#9b6a3d]"
                                        >
                                          {motifExpanded
                                            ? 'Masquer le motif'
                                            : 'Voir le motif'}
                                        </button>
                                      </div>
                                    )}
                                  </article>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
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
