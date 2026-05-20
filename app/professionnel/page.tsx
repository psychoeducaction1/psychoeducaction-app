'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
  AlertCard,
  EmptyState,
  buttonClass,
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

type AssignedClient = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  requester_name: string | null
  assigned_date: string
  contacted: boolean
  is_active: boolean
  short_comment: string | null
  closure_reason: string | null
}

type AssignmentRequest = {
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  request_comment: string | null
}

type ProfessionalPreferences = {
  pref_client_types: string
  pref_modalities: string
  pref_followup_types: string
  pref_notes: string
}

type ProfilePreferencesRow = {
  role: string | null
  pref_client_types: string[] | null
  pref_modalities: string[] | null
  pref_followup_types: string[] | null
  pref_notes: string | null
}

type PreferenceField = keyof ProfessionalPreferences

type EditableClientField =
  | 'contacted'
  | 'is_active'
  | 'short_comment'
  | 'closure_reason'

const closureReasonOptions = [
  '',
  'Aucune réponse après les tentatives de contact',
  'Client non intéressé par le service',
  'Client a trouvé un autre service',
  'Coordonnées invalides',
  'Autre',
]

function nullableText(value: string | null): string | null {
  const trimmedValue = value?.trim() ?? ''
  return trimmedValue.length > 0 ? trimmedValue : null
}

function arrayToTextareaValue(value: string[] | null): string {
  return value?.join(', ') ?? ''
}

function textareaValueToArray(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function isRecentDate(value: string): boolean {
  const assignedDate = new Date(`${value}T00:00:00`)

  if (Number.isNaN(assignedDate.getTime())) {
    return false
  }

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  return assignedDate >= sevenDaysAgo
}

export default function ProfessionnelPage() {
  const router = useRouter()
  const [clients, setClients] = useState<AssignedClient[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [hasExistingRequest, setHasExistingRequest] = useState(false)
  const [requestActive, setRequestActive] = useState(false)
  const [requestedCount, setRequestedCount] = useState(0)
  const [assignedCount, setAssignedCount] = useState(0)
  const [remainingCount, setRemainingCount] = useState(0)
  const [requestComment, setRequestComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingRequest, setSavingRequest] = useState(false)
  const [clearingRequest, setClearingRequest] = useState(false)
  const [error, setError] = useState('')
  const [requestMessage, setRequestMessage] = useState('')
  const [requestError, setRequestError] = useState('')
  const [preferences, setPreferences] = useState<ProfessionalPreferences>({
    pref_client_types: '',
    pref_modalities: '',
    pref_followup_types: '',
    pref_notes: '',
  })
  const [savingPreferences, setSavingPreferences] = useState(false)
  const [preferencesMessage, setPreferencesMessage] = useState('')
  const [preferencesError, setPreferencesError] = useState('')
  const [savingClientIds, setSavingClientIds] = useState<Record<string, boolean>>({})
  const [clientMessages, setClientMessages] = useState<Record<string, string>>({})
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError('')
      setRequestMessage('')
      setRequestError('')
      setPreferencesMessage('')
      setPreferencesError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.push('/login')
        return
      }

      setCurrentUserId(user.id)

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('role, pref_client_types, pref_modalities, pref_followup_types, pref_notes')
        .eq('id', user.id)
        .single()

      if (profileError) {
        setError(profileError.message)
        setLoading(false)
        return
      }

      const currentPreferences = profileData as ProfilePreferencesRow

      if (
        currentPreferences.role !== 'professionnel' &&
        currentPreferences.role !== 'direction'
      ) {
        router.push('/')
        return
      }

      const [clientsResponse, requestResponse] = await Promise.all([
        supabase
          .from('assigned_clients')
          .select(`
            id,
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
          .order('assigned_date', { ascending: false }),
        supabase
          .from('assignment_requests')
          .select(
            'professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment'
          )
          .eq('professional_id', user.id)
          .limit(1),
      ])

      if (clientsResponse.error) {
        setError(clientsResponse.error.message)
        setLoading(false)
        return
      }

      if (requestResponse.error) {
        setError(requestResponse.error.message)
        setLoading(false)
        return
      }

      const currentRequest = (requestResponse.data?.[0] ?? null) as AssignmentRequest | null

      setClients(clientsResponse.data || [])
      setHasExistingRequest(Boolean(currentRequest))
      setRequestActive(currentRequest?.is_active ?? false)
      setRequestedCount(currentRequest?.requested_count ?? 0)
      setAssignedCount(currentRequest?.assigned_count ?? 0)
      setRemainingCount(currentRequest?.remaining_count ?? 0)
      setRequestComment(currentRequest?.request_comment ?? '')
      setPreferences({
        pref_client_types: arrayToTextareaValue(currentPreferences.pref_client_types),
        pref_modalities: arrayToTextareaValue(currentPreferences.pref_modalities),
        pref_followup_types: arrayToTextareaValue(
          currentPreferences.pref_followup_types
        ),
        pref_notes: currentPreferences.pref_notes ?? '',
      })
      setLoading(false)
    }

    loadData()
  }, [router])

  const handleSaveRequest = async () => {
    setSavingRequest(true)
    setRequestMessage('')
    setRequestError('')

    const normalizedRequestedCount = Math.max(0, Math.trunc(requestedCount || 0))
    const normalizedAssignedCount = Math.max(0, Math.trunc(assignedCount || 0))
    const nextRemainingCount = Math.max(
      normalizedRequestedCount - normalizedAssignedCount,
      0
    )

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setRequestError('Utilisateur introuvable.')
      setSavingRequest(false)
      return
    }

    const requestPayload = {
      professional_id: user.id,
      is_active: true,
      requested_count: normalizedRequestedCount,
      assigned_count: normalizedAssignedCount,
      remaining_count: nextRemainingCount,
      request_comment: requestComment.trim() || null,
    }

    const { error: saveError } = hasExistingRequest
      ? await supabase
          .from('assignment_requests')
          .update(requestPayload)
          .eq('professional_id', user.id)
      : await supabase.from('assignment_requests').insert(requestPayload)

    if (saveError) {
      setRequestError(saveError.message)
      setSavingRequest(false)
      return
    }

    setHasExistingRequest(true)
    setRequestActive(true)
    setRequestedCount(normalizedRequestedCount)
    setAssignedCount(normalizedAssignedCount)
    setRemainingCount(nextRemainingCount)
    setRequestMessage('Demande active sauvegardée.')
    setSavingRequest(false)
  }

  const handleClearRequest = async () => {
    setClearingRequest(true)
    setRequestMessage('')
    setRequestError('')

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setRequestError('Utilisateur introuvable.')
      setClearingRequest(false)
      return
    }

    const clearPayload = {
      professional_id: user.id,
      is_active: false,
      requested_count: 0,
      assigned_count: 0,
      remaining_count: 0,
      request_comment: null,
    }

    const { error: clearError } = hasExistingRequest
      ? await supabase
          .from('assignment_requests')
          .update(clearPayload)
          .eq('professional_id', user.id)
      : await supabase.from('assignment_requests').insert(clearPayload)

    if (clearError) {
      setRequestError(clearError.message)
      setClearingRequest(false)
      return
    }

    setHasExistingRequest(true)
    setRequestActive(false)
    setRequestedCount(0)
    setAssignedCount(0)
    setRemainingCount(0)
    setRequestComment('')
    setRequestMessage('Demande effacée.')
    setClearingRequest(false)
  }

  const updatePreferenceField = (field: PreferenceField, value: string) => {
    setPreferences((currentPreferences) => ({
      ...currentPreferences,
      [field]: value,
    }))
  }

  const handleSavePreferences = async () => {
    setSavingPreferences(true)
    setPreferencesMessage('')
    setPreferencesError('')

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setPreferencesError('Utilisateur introuvable.')
        return
      }

      const { error: saveError } = await supabase
        .from('profiles')
        .update({
          pref_client_types: textareaValueToArray(preferences.pref_client_types),
          pref_modalities: textareaValueToArray(preferences.pref_modalities),
          pref_followup_types: textareaValueToArray(preferences.pref_followup_types),
          pref_notes: nullableText(preferences.pref_notes),
        })
        .eq('id', user.id)

      if (saveError) {
        setPreferencesError(saveError.message)
        return
      }

      setCurrentUserId(user.id)
      setPreferences((currentPreferences) => ({
        pref_client_types: textareaValueToArray(
          currentPreferences.pref_client_types
        ).join(', '),
        pref_modalities: textareaValueToArray(currentPreferences.pref_modalities).join(
          ', '
        ),
        pref_followup_types: textareaValueToArray(
          currentPreferences.pref_followup_types
        ).join(', '),
        pref_notes: nullableText(currentPreferences.pref_notes) ?? '',
      }))
      setPreferencesMessage('Préférences sauvegardées.')
    } catch (caughtError: unknown) {
      setPreferencesError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Une erreur est survenue pendant la sauvegarde.'
      )
    } finally {
      setSavingPreferences(false)
    }
  }

  const updateClientField = <Field extends EditableClientField>(
    clientId: string,
    field: Field,
    value: AssignedClient[Field]
  ) => {
    setClients((currentClients) =>
      currentClients.map((client) =>
        client.id === clientId ? { ...client, [field]: value } : client
      )
    )
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

    setSavingClientIds((currentSavingIds) => ({
      ...currentSavingIds,
      [client.id]: true,
    }))

    const { error: updateError } = await supabase
      .from('assigned_clients')
      .update({
        contacted: client.contacted,
        is_active: client.is_active,
        short_comment: nullableText(client.short_comment),
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

    setClients((currentClients) =>
      currentClients.map((currentClient) =>
        currentClient.id === client.id
          ? {
              ...currentClient,
              short_comment: nullableText(client.short_comment),
              closure_reason: nullableText(client.closure_reason),
            }
          : currentClient
      )
    )
    setClientMessages((currentMessages) => ({
      ...currentMessages,
      [client.id]: 'Client sauvegardé.',
    }))
  }

  const requestStatus = getAssignmentRequestStatus({
    isActive: requestActive,
    remainingCount,
    requestedCount,
  })
  const requestProgressText =
    assignedCount > 0 && remainingCount > 0
      ? 'Votre demande est partiellement répondue'
      : remainingCount === 0 && requestedCount > 0
        ? 'Votre demande est entièrement répondue'
        : assignedCount === 0 && requestedCount > 0
          ? 'Votre demande est en attente'
          : ''
  const activeClients = clients.filter((client) => client.is_active)
  const noResponseClients = clients.filter((client) => !client.is_active)
  const recentAssignmentsCount = clients.filter((client) =>
    isRecentDate(client.assigned_date)
  ).length
  const notContactedClientsCount = clients.filter((client) => !client.contacted).length
  const professionalAlerts = [
    recentAssignmentsCount > 0
      ? {
          title: 'Nouvelle assignation recente',
          description: `${recentAssignmentsCount} client${
            recentAssignmentsCount > 1 ? 's ont' : ' a'
          } ete assigne${
            recentAssignmentsCount > 1 ? 's' : ''
          } dans les 7 derniers jours.`,
          tone: 'warning' as const,
        }
      : null,
    notContactedClientsCount > 0
      ? {
          title: 'Clients a contacter',
          description: `${notContactedClientsCount} client${
            notContactedClientsCount > 1 ? 's ne sont' : " n'est"
          } pas encore contacte${notContactedClientsCount > 1 ? 's' : ''}.`,
          tone: 'warning' as const,
        }
      : null,
    requestStatus.label === 'demande complétée'
      ? {
          title: 'Demande completee',
          description: 'Votre demande actuelle est entierement repondue.',
          tone: 'success' as const,
        }
      : null,
    activeClients.length === 0
      ? {
          title: 'Aucun client ayant pris le service',
          description: 'Aucun client avec service pris actuellement.',
          tone: 'muted' as const,
        }
      : null,
  ].filter((alert): alert is { title: string; description: string; tone: 'warning' | 'success' | 'muted' } =>
    Boolean(alert)
  )

  const renderClientsTable = (sectionClients: AssignedClient[], emptyMessage: string) => (
    <div className={tableShellClass}>
      <table className={tableClass}>
        <thead className={tableHeaderClass}>
          <tr>
            <th className={tableHeadCellClass}>Prénom</th>
            <th className={tableHeadCellClass}>Nom</th>
            <th className={tableHeadCellClass}>Courriel</th>
            <th className={tableHeadCellClass}>Téléphone</th>
            <th className={tableHeadCellClass}>Requérant</th>
            <th className={tableHeadCellClass}>Date assignation</th>
            <th className={tableHeadCellClass}>Contact effectué</th>
            <th className={tableHeadCellClass}>Service pris</th>
            <th className={tableHeadCellClass}>Motif / commentaire</th>
            <th className={tableHeadCellClass}>Action</th>
          </tr>
        </thead>
        <tbody className={tableBodyClass}>
          {sectionClients.length === 0 ? (
            <tr>
              <td colSpan={10} className="p-6">
                <EmptyState title={emptyMessage} />
              </td>
            </tr>
          ) : (
            sectionClients.map((client) => (
              <tr key={client.id} className={tableRowClass}>
                <td className="px-4 py-4 align-top font-medium text-[#332820]">{client.first_name}</td>
                <td className="px-4 py-4 align-top font-medium text-[#332820]">{client.last_name}</td>
                <td className={tableCellClass}>{client.email || '-'}</td>
                <td className={tableCellClass}>{client.phone || '-'}</td>
                <td className={tableCellClass}>{client.requester_name || '-'}</td>
                <td className={tableCellClass}>{client.assigned_date}</td>
                <td className={tableCellClass}>
                  <input
                    type="checkbox"
                    checked={client.contacted}
                    onChange={(event) =>
                      updateClientField(client.id, 'contacted', event.target.checked)
                    }
                    className="h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
                  />
                </td>
                <td className={tableCellClass}>
                  <select
                    value={client.is_active ? 'yes' : 'no'}
                    onChange={(event) =>
                      updateClientField(
                        client.id,
                        'is_active',
                        event.target.value === 'yes'
                      )
                    }
                    className="w-24 rounded-xl border border-[#dfd0bf] bg-white px-2 py-1 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  >
                    <option value="yes">Oui</option>
                    <option value="no">Non</option>
                  </select>
                </td>
                <td className="min-w-72 px-4 py-4 align-top">
                  {client.is_active ? (
                    <Badge tone="success">Service pris</Badge>
                  ) : (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-[#5d4a3d]">
                        Motif de non-prise de service
                        <select
                          value={client.closure_reason ?? ''}
                          onChange={(event) =>
                            updateClientField(
                              client.id,
                              'closure_reason',
                              event.target.value
                            )
                          }
                          className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white px-2 py-1 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                        >
                          {closureReasonOptions.map((option) => (
                            <option key={option || 'empty-reason'} value={option}>
                              {option || 'Aucun motif sélectionné'}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-xs font-medium text-[#5d4a3d]">
                        Commentaire
                        <textarea
                          value={client.short_comment ?? ''}
                          onChange={(event) =>
                            updateClientField(client.id, 'short_comment', event.target.value)
                          }
                          rows={2}
                          className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white px-2 py-1 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                        />
                      </label>
                    </div>
                  )}
                </td>
                <td className="min-w-40 px-4 py-4 align-top">
                  <button
                    type="button"
                    onClick={() => handleSaveClient(client)}
                    disabled={savingClientIds[client.id]}
                    className={buttonClass('primary')}
                  >
                    {savingClientIds[client.id] ? 'Sauvegarde...' : 'Sauvegarder'}
                  </button>

                  {clientMessages[client.id] && (
                    <p className="mt-2 text-xs font-medium text-green-700">
                      {clientMessages[client.id]}
                    </p>
                  )}

                  {clientErrors[client.id] && (
                    <p className="mt-2 text-xs font-medium text-red-700">
                      {clientErrors[client.id]}
                    </p>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <p className="text-sm font-medium text-[#9b6a3d]">Espace professionnel</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#332820]">
              Mes clients assignés
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
              Suivi des demandes, preferences d&apos;assignation et accompagnements
              en cours.
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

        {!loading && !error && professionalAlerts.length > 0 && (
          <section className="mb-6 grid gap-3 lg:grid-cols-2">
            {professionalAlerts.map((alert) => (
              <AlertCard
                key={alert.title}
                title={alert.title}
                description={alert.description}
                tone={alert.tone}
              />
            ))}
          </section>
        )}

        {!loading && !error && (
          <section className="mb-6 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
            <div>
              <div>
                <h2 className="text-lg font-semibold text-[#332820]">
                  Demande d&apos;assignation
                </h2>
                <p className="mt-1 text-sm text-[#7a6859]">
                  Statut actuel:{' '}
                  <Badge tone={requestStatus.tone}>
                    {requestStatus.label}
                  </Badge>
                </p>
                <p className="mt-2 text-sm text-[#7a6859]">
                  Sauvegarder crée ou met à jour une demande active. Effacer
                  désactive la demande actuelle.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4">
                <p className="text-xs font-medium uppercase text-[#8a6f5d]">Demandés</p>
                <p className="mt-1 text-2xl font-semibold text-[#332820]">
                  {requestedCount}
                </p>
              </div>
              <div className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4">
                <p className="text-xs font-medium uppercase text-[#8a6f5d]">Assignés</p>
                <p className="mt-1 text-2xl font-semibold text-[#332820]">
                  {assignedCount}
                </p>
              </div>
              <div className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4">
                <p className="text-xs font-medium uppercase text-[#8a6f5d]">Restants</p>
                <p className="mt-1 text-2xl font-semibold text-[#332820]">
                  {remainingCount}
                </p>
              </div>
              <div className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4">
                <p className="text-xs font-medium uppercase text-[#8a6f5d]">Statut</p>
                <div className="mt-2">
                  <Badge tone={requestStatus.tone}>
                    {requestStatus.label}
                  </Badge>
                </div>
              </div>
            </div>

            {requestProgressText && (
              <div className="mt-3">
                <Badge tone={remainingCount > 0 ? 'warning' : 'success'}>
                  {requestProgressText}
                </Badge>
              </div>
            )}

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-[#5d4a3d]">
                Nombre de nouveaux clients souhaités
                <input
                  type="number"
                  min={0}
                  value={requestedCount}
                  onChange={(event) => setRequestedCount(Number(event.target.value))}
                  className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                />
              </label>

              <label className="block text-sm font-medium text-[#5d4a3d]">
                Commentaire
                <textarea
                  value={requestComment}
                  onChange={(event) => setRequestComment(event.target.value)}
                  maxLength={300}
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  placeholder="Court commentaire pour la direction"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleSaveRequest}
                disabled={savingRequest || clearingRequest}
                className={buttonClass('primary')}
              >
                {savingRequest ? 'Sauvegarde...' : 'Sauvegarder la demande'}
              </button>

              <button
                type="button"
                onClick={handleClearRequest}
                disabled={savingRequest || clearingRequest}
                className={buttonClass('secondary')}
              >
                {clearingRequest ? 'Effacement...' : 'Effacer la demande'}
              </button>

              {requestMessage && (
                <p className="text-sm font-medium text-green-700">{requestMessage}</p>
              )}

              {requestError && (
                <p className="text-sm font-medium text-red-700">{requestError}</p>
              )}
            </div>
          </section>
        )}

        {!loading && !error && (
          <section className="mb-6 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
            <h2 className="text-lg font-semibold text-[#332820]">
              Mes préférences d&apos;assignation
            </h2>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-[#5d4a3d]">
                Clientèles souhaitées
                <textarea
                  value={preferences.pref_client_types ?? ''}
                  onChange={(event) =>
                    updatePreferenceField('pref_client_types', event.target.value)
                  }
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                />
              </label>

              <label className="block text-sm font-medium text-[#5d4a3d]">
                Modalités souhaitées
                <textarea
                  value={preferences.pref_modalities ?? ''}
                  onChange={(event) =>
                    updatePreferenceField('pref_modalities', event.target.value)
                  }
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                />
              </label>

              <label className="block text-sm font-medium text-[#5d4a3d]">
                Types de suivis souhaités
                <textarea
                  value={preferences.pref_followup_types ?? ''}
                  onChange={(event) =>
                    updatePreferenceField('pref_followup_types', event.target.value)
                  }
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                />
              </label>

              <label className="block text-sm font-medium text-[#5d4a3d]">
                Notes / précisions
                <textarea
                  value={preferences.pref_notes ?? ''}
                  onChange={(event) =>
                    updatePreferenceField('pref_notes', event.target.value)
                  }
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white p-3 text-sm text-[#332820] outline-none focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleSavePreferences}
                disabled={savingPreferences}
                className={buttonClass('secondary')}
              >
                {savingPreferences ? 'Sauvegarde...' : 'Sauvegarder les préférences'}
              </button>

              {preferencesMessage && (
                <p className="text-sm font-medium text-green-700">
                  {preferencesMessage}
                </p>
              )}

              {preferencesError && (
                <p className="text-sm font-medium text-red-700">{preferencesError}</p>
              )}
            </div>
          </section>
        )}

        {!loading && !error && (
          <div className="space-y-8">
            <section>
              <h2 className="mb-3 text-lg font-semibold text-[#332820]">
                Clients ayant pris le service
              </h2>
              {renderClientsTable(
                activeClients,
                'Aucun client ayant pris le service.'
              )}
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-[#332820]">
                Clients sans réponse / service non pris
              </h2>
              {renderClientsTable(
                noResponseClients,
                'Aucun client sans réponse ou service non pris.'
              )}
            </section>
          </div>
        )}
        </div>
      </main>
    </>
  )
}
