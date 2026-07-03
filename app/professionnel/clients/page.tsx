'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
  EmptyState,
  tableBodyClass,
  tableHeaderClass,
  tableRowClass,
  tableShellClass,
} from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import {
  closureReasonOptions,
  getAssignmentRequestMetrics,
  getRemainingAssignmentCount,
  getServiceTakenCount,
  getUsedAssignmentCount,
  logAudit,
  logAssignedClientStatusChange,
  nullableText,
  type AssignedClient,
  type EditableClientField,
} from '../shared'

type ServiceStatus = 'pending' | 'yes' | 'no'

type AssignmentRequestSummary = {
  id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
}

const AUTO_SAVE_DEBOUNCE_MS = 700

function getServiceStatus(isActive: boolean | null): ServiceStatus {
  if (isActive === null) return 'pending'
  return isActive ? 'yes' : 'no'
}

function serviceStatusToIsActive(status: ServiceStatus): boolean | null {
  if (status === 'pending') return null
  return status === 'yes'
}

function getAuditStatusLabel(isActive: boolean | null): string {
  if (isActive === true) return 'Service pris'
  if (isActive === false) return 'Service non pris'
  return 'En attente'
}

export default function ProfessionnelClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<AssignedClient[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [currentUserName, setCurrentUserName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingClientIds, setSavingClientIds] = useState<Record<string, boolean>>({})
  const [clientMessages, setClientMessages] = useState<Record<string, string>>({})
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
  const autoSaveTimersRef = useRef<Record<string, number>>({})
  const latestClientsRef = useRef<AssignedClient[]>([])
  const persistedStatusByClientIdRef = useRef<Record<string, boolean | null>>({})
  const requestSummariesRef = useRef<Map<string, AssignmentRequestSummary>>(new Map())

  useEffect(() => {
    const loadClients = async () => {
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
        .select('role, full_name, email')
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

      setCurrentUserRole(profile.role)
      setCurrentUserName(profile.full_name ?? profile.email ?? null)

      const [clientsResponse, requestsResponse] = await Promise.all([
        supabase
          .from('assigned_clients')
          .select(`
            id,
            assignment_request_id,
            waiting_list_client_id,
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
          .order('assigned_date', { ascending: false }),
        supabase
          .from('assignment_requests')
          .select('id, is_active, requested_count, assigned_count, remaining_count')
          .eq('professional_id', user.id)
          .order('created_at', { ascending: false }),
      ])

      if (clientsResponse.error) {
        setError(clientsResponse.error.message)
        setLoading(false)
        return
      }

      if (requestsResponse.error) {
        setError(requestsResponse.error.message)
        setLoading(false)
        return
      }

      const loadedClients = (clientsResponse.data ?? []) as AssignedClient[]
      const requestSummaries = (requestsResponse.data ?? []) as AssignmentRequestSummary[]
      const requestSummariesById = new Map<string, AssignmentRequestSummary>()

      requestSummaries.forEach((requestSummary) => {
        requestSummariesById.set(requestSummary.id, requestSummary)
      })
      const serviceTakenCountByRequestId = new Map<string, number>()
      const occupiedCountByRequestId = new Map<string, number>()

      loadedClients.forEach((client) => {
        if (!client.assignment_request_id) return

        if (client.is_active === true) {
          serviceTakenCountByRequestId.set(
            client.assignment_request_id,
            (serviceTakenCountByRequestId.get(client.assignment_request_id) ?? 0) + 1
          )
        }

        if (client.is_active !== false) {
          occupiedCountByRequestId.set(
            client.assignment_request_id,
            (occupiedCountByRequestId.get(client.assignment_request_id) ?? 0) + 1
          )
        }
      })

      const shouldDisplayClient = (client: AssignedClient) => {
        if (!client.assignment_request_id) return false

        const requestSummary = requestSummariesById.get(client.assignment_request_id)

        if (!requestSummary) return false

        const requestMetrics = getAssignmentRequestMetrics({
          isActive: requestSummary.is_active,
          requestedCount: requestSummary.requested_count,
          acceptedCount:
            serviceTakenCountByRequestId.get(client.assignment_request_id) ?? 0,
          occupiedCount:
            occupiedCountByRequestId.get(client.assignment_request_id) ?? 0,
          remainingCount: requestSummary.remaining_count,
        })

        return requestMetrics.requestedCount > 0 && !requestMetrics.isCompleted
      }

      latestClientsRef.current = loadedClients
      requestSummariesRef.current = requestSummariesById
      setClients(loadedClients.filter(shouldDisplayClient))
      persistedStatusByClientIdRef.current = Object.fromEntries(
        loadedClients.map((client) => [client.id, client.is_active])
      )
      setLoading(false)
    }

    loadClients()
  }, [router])

  useEffect(
    () => () => {
      Object.values(autoSaveTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId)
      })
    },
    []
  )


  const hasNonServiceReason = (client: AssignedClient) =>
    Boolean(client.closure_reason?.trim())

  const shouldKeepClientVisible = (client: AssignedClient) => {
    if (!client.assignment_request_id) return false

    const requestSummary = requestSummariesRef.current.get(
      client.assignment_request_id
    )

    if (!requestSummary) return false

    const requestClients = latestClientsRef.current.filter(
      (currentClient) =>
        currentClient.assignment_request_id === client.assignment_request_id
    )
    const requestMetrics = getAssignmentRequestMetrics({
      isActive: requestSummary.is_active,
      requestedCount: requestSummary.requested_count,
      acceptedCount: getServiceTakenCount(requestClients),
      occupiedCount: getUsedAssignmentCount(requestClients),
      remainingCount: requestSummary.remaining_count,
    })

    return requestMetrics.requestedCount > 0 && !requestMetrics.isCompleted
  }

  const syncWaitingListStatus = async (
    client: AssignedClient
  ): Promise<string | null> => {
    if (!client.waiting_list_client_id) {
      return "Assignation sauvegardee, mais le client lie dans la liste d'attente est introuvable."
    }

    const { error: syncError } = await supabase.rpc(
      'sync_waiting_list_status_for_assigned_client',
      {
        assigned_client_id: client.id,
        next_is_active: client.is_active,
      }
    )

    return syncError?.message ?? null
  }

  const handleSaveClient = async (client: AssignedClient) => {
    setClientMessages((currentMessages) => ({ ...currentMessages, [client.id]: '' }))
    setClientErrors((currentErrors) => ({ ...currentErrors, [client.id]: '' }))

    if (!currentUserId) {
      setClientErrors((currentErrors) => ({
        ...currentErrors,
        [client.id]: 'Utilisateur introuvable.',
      }))
      return
    }

    if (client.is_active === false && !hasNonServiceReason(client)) {
      setClientErrors((currentErrors) => ({
        ...currentErrors,
        [client.id]:
          'Veuillez indiquer le motif avant de classer ce client comme service non pris.',
      }))
      return
    }

    setSavingClientIds((currentSavingIds) => ({
      ...currentSavingIds,
      [client.id]: true,
    }))

    const { error: updateError } = await supabase
      .from('assigned_clients')
      .update({
        is_active: client.is_active,
        closure_reason: nullableText(client.closure_reason),
      })
      .eq('id', client.id)
      .eq('professional_id', currentUserId)

    setSavingClientIds((currentSavingIds) => ({
      ...currentSavingIds,
      [client.id]: false,
    }))

    if (updateError) {
      setClientErrors((currentErrors) => ({
        ...currentErrors,
        [client.id]: updateError.message,
      }))
      return
    }

    const waitingListSyncError = await syncWaitingListStatus(client)

    const previousPersistedStatus =
      persistedStatusByClientIdRef.current[client.id] ?? null

    if (previousPersistedStatus !== client.is_active) {
      void logAssignedClientStatusChange({
        supabase,
        assignedClientId: client.id,
        previousStatus: previousPersistedStatus,
        newStatus: client.is_active,
        actor: {
          id: currentUserId,
          role: currentUserRole,
          name: currentUserName,
        },
      })
      void logAudit({
        supabase,
        actor: {
          id: currentUserId,
          role: currentUserRole,
          name: currentUserName,
        },
        action: 'assignment_status_changed',
        entityType: 'assigned_client',
        entityId: client.id,
        description: `${getAuditStatusLabel(previousPersistedStatus)} → ${getAuditStatusLabel(client.is_active)}`,
        metadata: {
          client_name: `${client.first_name} ${client.last_name}`.trim(),
          requester_name: client.requester_name,
          client_email: client.email,
          assignment_request_id: client.assignment_request_id,
          previous_status: previousPersistedStatus,
          new_status: client.is_active,
        },
      })
    }
    persistedStatusByClientIdRef.current[client.id] = client.is_active

    const updatedClients = latestClientsRef.current.map((currentClient) =>
      currentClient.id === client.id
        ? {
            ...currentClient,
            is_active: client.is_active,
            closure_reason: nullableText(client.closure_reason),
          }
        : currentClient
    )
    latestClientsRef.current = updatedClients

    if (!client.assignment_request_id) {
      setClients(updatedClients.filter(shouldKeepClientVisible))
      if (waitingListSyncError) {
        setClientErrors((currentErrors) => ({
          ...currentErrors,
          [client.id]: waitingListSyncError,
        }))
      } else {
        setClientMessages((currentMessages) => ({
          ...currentMessages,
          [client.id]: 'Sauvegardé',
        }))
      }
      return
    }

    const { data: request, error: requestLoadError } = await supabase
      .from('assignment_requests')
      .select('requested_count')
      .eq('id', client.assignment_request_id)
      .limit(1)
      .maybeSingle()

    if (requestLoadError) {
      setClientErrors((currentErrors) => ({
        ...currentErrors,
        [client.id]: requestLoadError.message,
      }))
      return
    }

    if (request) {
      const requestClients = updatedClients.filter(
        (currentClient) => currentClient.assignment_request_id === client.assignment_request_id
      )
      const nextServiceTakenCount = getServiceTakenCount(requestClients)
      const nextOccupiedCount = getUsedAssignmentCount(requestClients)
      const nextRemainingCount = getRemainingAssignmentCount(
        request.requested_count ?? 0,
        nextOccupiedCount
      )
      const { error: requestUpdateError } = await supabase
        .from('assignment_requests')
        .update({
          assigned_count: nextServiceTakenCount,
          remaining_count: nextRemainingCount,
          is_active: nextServiceTakenCount < (request.requested_count ?? 0),
        })
        .eq('id', client.assignment_request_id)

      if (requestUpdateError) {
        setClientErrors((currentErrors) => ({
          ...currentErrors,
          [client.id]: requestUpdateError.message,
        }))
        return
      }

      requestSummariesRef.current.set(client.assignment_request_id, {
        id: client.assignment_request_id,
        requested_count: request.requested_count,
        assigned_count: nextServiceTakenCount,
        remaining_count: nextRemainingCount,
        is_active: nextServiceTakenCount < (request.requested_count ?? 0),
      })
    }

    setClients(updatedClients.filter(shouldKeepClientVisible))
    if (waitingListSyncError) {
      setClientErrors((currentErrors) => ({
        ...currentErrors,
        [client.id]: waitingListSyncError,
      }))
    } else {
      setClientMessages((currentMessages) => ({
        ...currentMessages,
        [client.id]: 'Sauvegardé',
      }))
    }
  }

  const scheduleAutoSave = (client: AssignedClient) => {
    const currentTimer = autoSaveTimersRef.current[client.id]

    if (currentTimer) {
      window.clearTimeout(currentTimer)
    }

    autoSaveTimersRef.current[client.id] = window.setTimeout(() => {
      delete autoSaveTimersRef.current[client.id]
      void handleSaveClient(client)
    }, AUTO_SAVE_DEBOUNCE_MS)
  }

  const updateClientField = <Field extends EditableClientField>(
    clientId: string,
    field: Field,
    value: AssignedClient[Field]
  ) => {
    const currentClient = latestClientsRef.current.find((client) => client.id === clientId)

    if (!currentClient) return

    const nextClient = { ...currentClient, [field]: value } as AssignedClient

    if (field === 'closure_reason' && typeof value === 'string' && value.trim()) {
      setClientErrors((currentErrors) => ({ ...currentErrors, [clientId]: '' }))
    }

    latestClientsRef.current = latestClientsRef.current.map((client) =>
      client.id === clientId ? nextClient : client
    )

    setClients((currentClients) =>
      currentClients.map((client) => (client.id === clientId ? nextClient : client))
    )
    scheduleAutoSave(nextClient)
  }

  const updateClientServiceStatus = (client: AssignedClient, status: ServiceStatus) => {
    const nextIsActive = serviceStatusToIsActive(status)

    if (nextIsActive === false && !hasNonServiceReason(client)) {
      setClientErrors((currentErrors) => ({
        ...currentErrors,
        [client.id]:
          'Veuillez indiquer le motif avant de classer ce client comme service non pris.',
      }))
      return
    }

    updateClientField(client.id, 'is_active', nextIsActive)
  }

  const clientsToProcess = clients.filter((client) => client.is_active === null)
  const activeClients = clients.filter((client) => client.is_active === true)
  const noResponseClients = clients.filter((client) => client.is_active === false)

  const renderSaveStatus = (client: AssignedClient) => (
    <div className="text-sm">
      {savingClientIds[client.id] && (
        <p className="text-xs font-medium text-[#8a5633]">Sauvegarde...</p>
      )}
      {clientMessages[client.id] && (
        <p className="text-xs font-medium text-green-700">
          {clientMessages[client.id]}
        </p>
      )}
      {clientErrors[client.id] && (
        <p className="text-xs font-medium text-red-700">
          {clientErrors[client.id]}
        </p>
      )}
    </div>
  )

  const renderConsultationMotif = (client: AssignedClient) => (
    <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3 text-sm text-[#332820]">
      <p className="text-xs font-medium uppercase text-[#8a6f5d]">
        Motif de consultation
      </p>
      <p className="mt-1 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {client.short_comment?.trim() || '-'}
      </p>
    </div>
  )

  const renderMeetingDetails = (client: AssignedClient) => {
    const meetingModality = client.meeting_modality?.trim() ?? ''
    const showAddress =
      meetingModality === 'À domicile' && Boolean(client.service_address?.trim())

    return (
      <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-[#eadfd2] bg-white p-3 text-sm text-[#332820]">
        <p className="text-xs font-medium uppercase text-[#8a6f5d]">
          Modalité de rencontre
        </p>
        <p className="mt-1 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {meetingModality || '-'}
        </p>
        {showAddress && (
          <>
            <p className="mt-3 text-xs font-medium uppercase text-[#8a6f5d]">
              Adresse complète
            </p>
            <p className="mt-1 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {client.service_address}
            </p>
          </>
        )}
      </div>
    )
  }

  const renderServiceBadge = (client: AssignedClient) =>
    client.is_active === true ? (
      <Badge tone="success">Service pris</Badge>
    ) : client.is_active === false ? (
      <Badge tone="danger">Service non pris</Badge>
    ) : (
      <Badge tone="warning">En attente</Badge>
    )

  const renderNonServiceReason = (client: AssignedClient) =>
    client.is_active !== true ? (
      <div className="space-y-2">
        <label className="block text-xs font-medium text-[#5d4a3d]">
          Motif de non-prise de service
          <select
            value={client.closure_reason ?? ''}
            onChange={(event) =>
              updateClientField(client.id, 'closure_reason', event.target.value)
            }
            className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white px-2 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
          >
            {closureReasonOptions.map((option) => (
              <option key={option || 'empty-reason'} value={option}>
                {option || 'Aucun motif sélectionné'}
              </option>
            ))}
          </select>
        </label>
      </div>
    ) : null

  const renderClientsTable = (sectionClients: AssignedClient[], emptyMessage: string) => (
    <>
      <div className="space-y-4">
        {sectionClients.length === 0 ? (
          <EmptyState title={emptyMessage} />
        ) : (
          sectionClients.map((client) => (
            <article
              key={client.id}
              className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words text-base font-semibold text-[#332820]">
                      {client.first_name} {client.last_name}
                    </h3>
                    {renderServiceBadge(client)}
                  </div>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <div className="min-w-0 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                      <dt className="text-xs font-medium uppercase text-[#8a6f5d]">
                        Courriel
                      </dt>
                      <dd className="mt-1 break-words text-[#332820]">
                        {client.email || '-'}
                      </dd>
                    </div>
                    <div className="min-w-0 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                      <dt className="text-xs font-medium uppercase text-[#8a6f5d]">
                        Téléphone
                      </dt>
                      <dd className="mt-1 break-words text-[#332820]">
                        {client.phone || '-'}
                      </dd>
                    </div>
                    <div className="min-w-0 rounded-xl border border-[#d6c7aa] bg-[#f1ead9] p-3">
                      <dt className="text-xs font-semibold uppercase text-[#6d3f1f]">
                        Requérant
                      </dt>
                      <dd className="mt-1 break-words font-semibold text-[#332820]">
                        {client.requester_name || '-'}
                      </dd>
                    </div>
                    <div className="min-w-0 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
                      <dt className="text-xs font-medium uppercase text-[#8a6f5d]">
                        Date
                      </dt>
                      <dd className="mt-1 break-words text-[#332820]">
                        {client.assigned_date}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(14rem,0.55fr)]">
                {renderConsultationMotif(client)}
                {renderMeetingDetails(client)}

                <div className="min-w-0 rounded-xl border border-[#d8b992] bg-[#fffaf4] p-4 shadow-[0_8px_20px_rgba(138,86,51,0.08)]">
                  <label className="block text-sm font-semibold text-[#5d4a3d]">
                    Statut du service
                    <span className="mt-1 block text-xs font-normal leading-5 text-[#8a6f5d]">
                      À mettre à jour après le contact avec le client.
                    </span>
                    <select
                      value={getServiceStatus(client.is_active)}
                      onChange={(event) =>
                        updateClientServiceStatus(
                          client,
                          event.target.value as ServiceStatus
                        )
                      }
                      className="mt-3 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm font-medium text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                    >
                      <option value="pending">En attente</option>
                      <option value="yes">Oui</option>
                      <option value="no">Non</option>
                    </select>
                  </label>
                </div>

                <div className="min-w-0 lg:col-span-3">
                  {renderNonServiceReason(client)}
                </div>
              </div>
              {(savingClientIds[client.id] ||
                clientMessages[client.id] ||
                clientErrors[client.id]) && (
                <div className="mt-3">{renderSaveStatus(client)}</div>
              )}
            </article>
          ))
        )}
      </div>

      <div className={`${tableShellClass} hidden`}>
        <table className="w-full min-w-[760px] table-fixed divide-y divide-[#eadfd2] text-sm">
        <colgroup>
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[17%]" />
          <col className="w-[12%]" />
          <col className="w-[13%]" />
          <col className="w-[10%]" />
          <col />
          <col className="w-[9rem]" />
          <col className="w-[18rem]" />
        </colgroup>
        <thead className={tableHeaderClass}>
          <tr>
            <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#5d4a3d]">Prénom</th>
            <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#5d4a3d]">Nom</th>
            <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#5d4a3d]">Courriel</th>
            <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#5d4a3d]">Téléphone</th>
            <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#5d4a3d]">Requérant</th>
            <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#5d4a3d]">Date</th>
            <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#5d4a3d]">Motif de consultation</th>
            <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#5d4a3d]">Service</th>
            <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[#5d4a3d]">Motif de non-prise</th>
          </tr>
        </thead>
        <tbody className={tableBodyClass}>
          {sectionClients.length === 0 ? (
            <tr>
              <td colSpan={9} className="p-6">
                <EmptyState title={emptyMessage} />
              </td>
            </tr>
          ) : (
            sectionClients.map((client) => (
              <tr key={client.id} className={tableRowClass}>
                <td className="break-words px-3 py-3 align-top font-medium text-[#332820]">
                  {client.first_name}
                </td>
                <td className="break-words px-3 py-3 align-top font-medium text-[#332820]">
                  {client.last_name}
                </td>
                <td className="break-words px-3 py-3 align-top text-[#6c5a4d]">{client.email || '-'}</td>
                <td className="break-words px-3 py-3 align-top text-[#6c5a4d]">{client.phone || '-'}</td>
                <td className="break-words px-3 py-3 align-top text-[#6c5a4d]">{client.requester_name || '-'}</td>
                <td className="break-words px-3 py-3 align-top text-[#6c5a4d]">{client.assigned_date}</td>
                <td className="px-3 py-3 align-top">
                  {renderConsultationMotif(client)}
                </td>
                <td className="px-3 py-3 align-top text-[#6c5a4d]">
                  <select
                    value={getServiceStatus(client.is_active)}
                    onChange={(event) =>
                      updateClientServiceStatus(
                        client,
                        event.target.value as ServiceStatus
                      )
                    }
                    className="w-28 rounded-xl border border-[#dfd0bf] bg-white px-2 py-1 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  >
                    <option value="pending">En attente</option>
                    <option value="yes">Oui</option>
                    <option value="no">Non</option>
                  </select>
                </td>
                <td className="px-3 py-3 align-top">
                  {renderNonServiceReason(client)}
                  {(savingClientIds[client.id] ||
                    clientMessages[client.id] ||
                    clientErrors[client.id]) && (
                    <div className="mt-2">{renderSaveStatus(client)}</div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
        </table>
      </div>
    </>
  )

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <p className="text-sm font-medium text-[#9b6a3d]">Espace professionnel</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#332820]">
              Mes assignations
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
              Suivez la confirmation de service de vos assignations.
            </p>
          </div>

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
              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <h2 className="mb-3 text-lg font-semibold text-[#332820]">
                  Assignations à traiter
                </h2>
                {renderClientsTable(
                  clientsToProcess,
                  'Aucune assignation à traiter.'
                )}
              </section>

              <section className="rounded-2xl border border-[#d8e2c7] bg-[#f6faef] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <h2 className="mb-3 text-lg font-semibold text-[#3f4f2d]">
                  Clients ayant pris le service
                </h2>
                {renderClientsTable(
                  activeClients,
                  'Aucun client ayant pris le service.'
                )}
              </section>

              <section className="rounded-2xl border border-[#e9cfc5] bg-[#fff6f2] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <h2 className="mb-3 text-lg font-semibold text-[#6f3f32]">
                  Clients n&apos;ayant pas pris le service
                </h2>
                {renderClientsTable(
                  noResponseClients,
                  "Aucun client n'ayant pas pris le service."
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
