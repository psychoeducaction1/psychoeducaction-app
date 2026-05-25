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
  getRemainingAssignmentCount,
  getUsedAssignmentCount,
  nullableText,
  type AssignedClient,
  type AssignmentRequest,
  type EditableClientField,
} from '../shared'

type ServiceStatus = 'pending' | 'yes' | 'no'

const AUTO_SAVE_DEBOUNCE_MS = 700

function getServiceStatus(isActive: boolean | null): ServiceStatus {
  if (isActive === null) return 'pending'
  return isActive ? 'yes' : 'no'
}

function serviceStatusToIsActive(status: ServiceStatus): boolean | null {
  if (status === 'pending') return null
  return status === 'yes'
}

export default function ProfessionnelClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<AssignedClient[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingClientIds, setSavingClientIds] = useState<Record<string, boolean>>({})
  const [clientMessages, setClientMessages] = useState<Record<string, string>>({})
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
  const autoSaveTimersRef = useRef<Record<string, number>>({})
  const latestClientsRef = useRef<AssignedClient[]>([])

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

      const { data: request, error: requestError } = await supabase
        .from('assignment_requests')
        .select(
          'id, professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment'
        )
        .eq('professional_id', user.id)
        .eq('is_active', true)
        .gt('remaining_count', 0)
        .limit(1)
        .maybeSingle()

      if (requestError) {
        setError(requestError.message)
        setLoading(false)
        return
      }

      const activeRequest = (request as AssignmentRequest | null) ?? null
      setCurrentRequestId(activeRequest?.id ?? null)

      if (!activeRequest) {
        setClients([])
        setLoading(false)
        return
      }

      const { data, error: clientsError } = await supabase
        .from('assigned_clients')
        .select(`
          id,
          assignment_request_id,
          first_name,
          last_name,
          email,
          phone,
          requester_name,
          assigned_date,
          contacted,
          is_active,
          short_comment,
          closure_reason
        `)
        .eq('professional_id', user.id)
        .eq('assignment_request_id', activeRequest.id)
        .order('assigned_date', { ascending: false })

      if (clientsError) {
        setError(clientsError.message)
        setLoading(false)
        return
      }

      setClients(data || [])
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

  useEffect(() => {
    latestClientsRef.current = clients
  }, [clients])

  const hasNonServiceReason = (client: AssignedClient) =>
    Boolean(client.closure_reason?.trim())

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

    const updatedClients = latestClientsRef.current.map((currentClient) =>
      currentClient.id === client.id
        ? {
            ...currentClient,
            is_active: client.is_active,
            closure_reason: nullableText(client.closure_reason),
          }
        : currentClient
    )

    if (!currentRequestId) {
      setClients(updatedClients)
      setClientMessages((currentMessages) => ({
        ...currentMessages,
        [client.id]: 'Sauvegardé',
      }))
      return
    }

    const { data: request, error: requestLoadError } = await supabase
      .from('assignment_requests')
      .select('requested_count')
      .eq('id', currentRequestId)
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
      const nextAssignedCount = getUsedAssignmentCount(updatedClients)
      const nextRemainingCount = getRemainingAssignmentCount(
        request.requested_count ?? 0,
        nextAssignedCount
      )
      const { error: requestUpdateError } = await supabase
        .from('assignment_requests')
        .update({
          assigned_count: nextAssignedCount,
          remaining_count: nextRemainingCount,
        })
        .eq('id', currentRequestId)

      if (requestUpdateError) {
        setClientErrors((currentErrors) => ({
          ...currentErrors,
          [client.id]: requestUpdateError.message,
        }))
        return
      }
    }

    setClients(updatedClients)
    setClientMessages((currentMessages) => ({
      ...currentMessages,
      [client.id]: 'Sauvegardé',
    }))
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

    setClients((currentClients) =>
      currentClients.map((client) => (client.id === clientId ? nextClient : client))
    )
    scheduleAutoSave(nextClient)
  }

  const clientsToProcess = clients.filter(
    (client) => client.is_active === null || (client.is_active === false && !hasNonServiceReason(client))
  )
  const activeClients = clients.filter((client) => client.is_active === true)
  const noResponseClients = clients.filter(
    (client) => client.is_active === false && hasNonServiceReason(client)
  )

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
    <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3 text-sm text-[#332820]">
      <p className="text-xs font-medium uppercase text-[#8a6f5d]">
        Motif de consultation
      </p>
      <p className="mt-1 whitespace-pre-wrap">
        {client.short_comment?.trim() || '-'}
      </p>
    </div>
  )

  const renderServiceBadge = (client: AssignedClient) =>
    client.is_active === true ? (
      <Badge tone="success">Service pris</Badge>
    ) : client.is_active === false ? (
      <Badge tone="danger">Service non pris</Badge>
    ) : (
      <Badge tone="warning">En attente</Badge>
    )

  const renderNonServiceReason = (client: AssignedClient) =>
    client.is_active === false ? (
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
              className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4 shadow-[0_1px_2px_rgba(72,49,30,0.06)]"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words text-base font-semibold text-[#332820]">
                      {client.first_name} {client.last_name}
                    </h3>
                    {renderServiceBadge(client)}
                  </div>
                  <div className="mt-2 grid gap-1 text-sm text-[#7a6859] sm:grid-cols-2">
                    <p className="break-words">Courriel: {client.email || '-'}</p>
                    <p>Téléphone: {client.phone || '-'}</p>
                    <p className="break-words">
                      Requérant: {client.requester_name || '-'}
                    </p>
                    <p>Date: {client.assigned_date}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_8.5rem_minmax(0,1fr)]">
                {renderConsultationMotif(client)}

                <label className="block text-xs font-medium text-[#5d4a3d]">
                  Service pris
                  <select
                    value={getServiceStatus(client.is_active)}
                    onChange={(event) =>
                      updateClientField(
                        client.id,
                        'is_active',
                        serviceStatusToIsActive(event.target.value as ServiceStatus)
                      )
                    }
                    className="mt-1 w-28 rounded-xl border border-[#dfd0bf] bg-white px-2 py-2 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  >
                    <option value="pending">En attente</option>
                    <option value="yes">Oui</option>
                    <option value="no">Non</option>
                  </select>
                </label>

                <div>{renderNonServiceReason(client)}</div>
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
                      updateClientField(
                        client.id,
                        'is_active',
                        serviceStatusToIsActive(event.target.value as ServiceStatus)
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
              <section className="rounded-3xl border border-[#eadfd2] bg-[#fffdf9] p-4 shadow-[0_1px_2px_rgba(72,49,30,0.04)] sm:p-5">
                <h2 className="mb-3 text-lg font-semibold text-[#332820]">
                  Assignations à traiter
                </h2>
                {renderClientsTable(
                  clientsToProcess,
                  'Aucune assignation à traiter.'
                )}
              </section>

              <section className="rounded-3xl border border-[#d8e2c7] bg-[#f6faef] p-4 shadow-[0_1px_2px_rgba(72,49,30,0.04)] sm:p-5">
                <h2 className="mb-3 text-lg font-semibold text-[#3f4f2d]">
                  Clients ayant pris le service
                </h2>
                {renderClientsTable(
                  activeClients,
                  'Aucun client ayant pris le service.'
                )}
              </section>

              <section className="rounded-3xl border border-[#e9cfc5] bg-[#fff6f2] p-4 shadow-[0_1px_2px_rgba(72,49,30,0.04)] sm:p-5">
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
