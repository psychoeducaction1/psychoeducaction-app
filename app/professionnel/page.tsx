'use client'

import { useEffect, useState } from 'react'
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
  pref_client_types: string | null
  pref_modalities: string | null
  pref_followup_types: string | null
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

export default function ProfessionnelPage() {
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
        setError('Utilisateur introuvable.')
        setLoading(false)
        return
      }

      setCurrentUserId(user.id)

      const [clientsResponse, requestResponse, profileResponse] = await Promise.all([
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
        supabase
          .from('profiles')
          .select('pref_client_types, pref_modalities, pref_followup_types, pref_notes')
          .eq('id', user.id)
          .single(),
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

      if (profileResponse.error) {
        setError(profileResponse.error.message)
        setLoading(false)
        return
      }

      const currentRequest = (requestResponse.data?.[0] ?? null) as AssignmentRequest | null
      const currentPreferences = profileResponse.data as ProfessionalPreferences

      setClients(clientsResponse.data || [])
      setHasExistingRequest(Boolean(currentRequest))
      setRequestActive(currentRequest?.is_active ?? false)
      setRequestedCount(currentRequest?.requested_count ?? 0)
      setAssignedCount(currentRequest?.assigned_count ?? 0)
      setRemainingCount(currentRequest?.remaining_count ?? 0)
      setRequestComment(currentRequest?.request_comment ?? '')
      setPreferences({
        pref_client_types: currentPreferences.pref_client_types ?? '',
        pref_modalities: currentPreferences.pref_modalities ?? '',
        pref_followup_types: currentPreferences.pref_followup_types ?? '',
        pref_notes: currentPreferences.pref_notes ?? '',
      })
      setLoading(false)
    }

    loadData()
  }, [])

  const handleSaveRequest = async () => {
    setSavingRequest(true)
    setRequestMessage('')
    setRequestError('')

    const normalizedRequestedCount = Math.max(0, Math.trunc(requestedCount || 0))
    const normalizedAssignedCount = Math.max(0, Math.trunc(assignedCount || 0))
    const remainingCount = requestActive
      ? Math.max(normalizedRequestedCount - normalizedAssignedCount, 0)
      : 0

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
      is_active: requestActive,
      requested_count: normalizedRequestedCount,
      assigned_count: normalizedAssignedCount,
      remaining_count: remainingCount,
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
    setRequestedCount(normalizedRequestedCount)
    setAssignedCount(normalizedAssignedCount)
    setRemainingCount(remainingCount)
    setRequestMessage('Demande sauvegardée.')
    setSavingRequest(false)
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

    if (!currentUserId) {
      setPreferencesError('Utilisateur introuvable.')
      setSavingPreferences(false)
      return
    }

    const { error: saveError } = await supabase
      .from('profiles')
      .update({
        pref_client_types: nullableText(preferences.pref_client_types),
        pref_modalities: nullableText(preferences.pref_modalities),
        pref_followup_types: nullableText(preferences.pref_followup_types),
        pref_notes: nullableText(preferences.pref_notes),
      })
      .eq('id', currentUserId)

    if (saveError) {
      setPreferencesError(saveError.message)
      setSavingPreferences(false)
      return
    }

    setPreferences((currentPreferences) => ({
      pref_client_types: nullableText(currentPreferences.pref_client_types) ?? '',
      pref_modalities: nullableText(currentPreferences.pref_modalities) ?? '',
      pref_followup_types: nullableText(currentPreferences.pref_followup_types) ?? '',
      pref_notes: nullableText(currentPreferences.pref_notes) ?? '',
    }))
    setPreferencesMessage('Préférences sauvegardées.')
    setSavingPreferences(false)
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

  const requestStatusText = requestActive ? 'demande active' : 'demande inactive'
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

  const renderClientsTable = (sectionClients: AssignedClient[], emptyMessage: string) => (
    <div className="overflow-x-auto bg-white rounded-2xl shadow">
      <table className="min-w-full text-sm text-gray-900">
        <thead className="bg-gray-200 text-left text-gray-950">
          <tr>
            <th className="p-3">Prénom</th>
            <th className="p-3">Nom</th>
            <th className="p-3">Courriel</th>
            <th className="p-3">Téléphone</th>
            <th className="p-3">Requérant</th>
            <th className="p-3">Date assignation</th>
            <th className="p-3">Contact effectué (courriel / téléphone / SMS)</th>
            <th className="p-3">Service pris</th>
            <th className="p-3">Motif / commentaire</th>
            <th className="p-3">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 text-gray-900">
          {sectionClients.length === 0 ? (
            <tr>
              <td colSpan={10} className="p-4 text-center text-gray-600">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sectionClients.map((client) => (
              <tr key={client.id} className="hover:bg-gray-50">
                <td className="p-3">{client.first_name}</td>
                <td className="p-3">{client.last_name}</td>
                <td className="p-3">{client.email || '-'}</td>
                <td className="p-3">{client.phone || '-'}</td>
                <td className="p-3">{client.requester_name || '-'}</td>
                <td className="p-3">{client.assigned_date}</td>
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={client.contacted}
                    onChange={(event) =>
                      updateClientField(client.id, 'contacted', event.target.checked)
                    }
                    className="h-4 w-4 rounded border-gray-400"
                  />
                </td>
                <td className="p-3">
                  <select
                    value={client.is_active ? 'yes' : 'no'}
                    onChange={(event) =>
                      updateClientField(
                        client.id,
                        'is_active',
                        event.target.value === 'yes'
                      )
                    }
                    className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900"
                  >
                    <option value="yes">Oui</option>
                    <option value="no">Non</option>
                  </select>
                </td>
                <td className="min-w-72 p-3">
                  {client.is_active ? (
                    <span className="text-sm text-gray-500">Service pris</span>
                  ) : (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-gray-700">
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
                          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900"
                        >
                          {closureReasonOptions.map((option) => (
                            <option key={option || 'empty-reason'} value={option}>
                              {option || 'Aucun motif sélectionné'}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-xs font-medium text-gray-700">
                        Commentaire
                        <textarea
                          value={client.short_comment ?? ''}
                          onChange={(event) =>
                            updateClientField(client.id, 'short_comment', event.target.value)
                          }
                          rows={2}
                          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900"
                        />
                      </label>
                    </div>
                  )}
                </td>
                <td className="min-w-40 p-3">
                  <button
                    type="button"
                    onClick={() => handleSaveClient(client)}
                    disabled={savingClientIds[client.id]}
                    className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
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
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold mb-6">Mes clients assignés</h1>

        {loading && <p>Chargement...</p>}

        {error && (
          <div className="mb-4 rounded-lg bg-red-100 text-red-700 p-3">
            {error}
          </div>
        )}

        {!loading && !error && (
          <section className="mb-6 rounded-lg bg-white p-6 shadow">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Demande d&apos;assignation
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Statut actuel: {requestStatusText}
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={requestActive}
                  onChange={(event) => setRequestActive(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Demande active
              </label>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase text-gray-600">Demandés</p>
                <p className="mt-1 text-2xl font-semibold text-gray-950">
                  {requestedCount}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase text-gray-600">Assignés</p>
                <p className="mt-1 text-2xl font-semibold text-gray-950">
                  {assignedCount}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase text-gray-600">Restants</p>
                <p className="mt-1 text-2xl font-semibold text-gray-950">
                  {remainingCount}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase text-gray-600">Statut</p>
                <p className="mt-2 text-sm font-semibold text-gray-950">
                  {requestStatusText}
                </p>
              </div>
            </div>

            {requestProgressText && (
              <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm font-medium text-blue-900">
                {requestProgressText}
              </p>
            )}

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-gray-700">
                Nombre de nouveaux clients souhaités
                <input
                  type="number"
                  min={0}
                  value={requestedCount}
                  onChange={(event) => setRequestedCount(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-sm"
                />
              </label>

              <label className="block text-sm font-medium text-gray-700">
                Commentaire
                <textarea
                  value={requestComment}
                  onChange={(event) => setRequestComment(event.target.value)}
                  maxLength={300}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-sm"
                  placeholder="Court commentaire pour la direction"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleSaveRequest}
                disabled={savingRequest}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {savingRequest ? 'Sauvegarde...' : 'Sauvegarder la demande'}
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
          <section className="mb-6 rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-semibold text-gray-900">
              Mes préférences d&apos;assignation
            </h2>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-gray-700">
                Clientèles souhaitées
                <textarea
                  value={preferences.pref_client_types ?? ''}
                  onChange={(event) =>
                    updatePreferenceField('pref_client_types', event.target.value)
                  }
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-sm"
                />
              </label>

              <label className="block text-sm font-medium text-gray-700">
                Modalités souhaitées
                <textarea
                  value={preferences.pref_modalities ?? ''}
                  onChange={(event) =>
                    updatePreferenceField('pref_modalities', event.target.value)
                  }
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-sm"
                />
              </label>

              <label className="block text-sm font-medium text-gray-700">
                Types de suivis souhaités
                <textarea
                  value={preferences.pref_followup_types ?? ''}
                  onChange={(event) =>
                    updatePreferenceField('pref_followup_types', event.target.value)
                  }
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-sm"
                />
              </label>

              <label className="block text-sm font-medium text-gray-700">
                Notes / précisions
                <textarea
                  value={preferences.pref_notes ?? ''}
                  onChange={(event) =>
                    updatePreferenceField('pref_notes', event.target.value)
                  }
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-sm"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleSavePreferences}
                disabled={savingPreferences}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
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
              <h2 className="mb-3 text-lg font-semibold text-gray-900">Clients actifs</h2>
              {renderClientsTable(activeClients, 'Aucun client actif.')}
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-gray-900">
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
  )
}
