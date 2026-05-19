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
  dossier_closed: boolean
  closure_reason: string | null
  meeting_count: number
}

type AssignmentRequest = {
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  request_comment: string | null
}

export default function ProfessionnelPage() {
  const [clients, setClients] = useState<AssignedClient[]>([])
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

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError('')
      setRequestMessage('')
      setRequestError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setError('Utilisateur introuvable.')
        setLoading(false)
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
            dossier_closed,
            closure_reason,
            meeting_count
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

  const requestStatusText = requestActive ? 'demande active' : 'demande inactive'
  const requestProgressText =
    assignedCount > 0 && remainingCount > 0
      ? 'Votre demande est partiellement répondue'
      : remainingCount === 0 && requestedCount > 0
        ? 'Votre demande est entièrement répondue'
        : assignedCount === 0 && requestedCount > 0
          ? 'Votre demande est en attente'
          : ''

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

        {!loading && !error && clients.length === 0 && (
          <div className="rounded-lg bg-white p-6 shadow">
            Aucun client assigné pour l&apos;instant.
          </div>
        )}

        {!loading && !error && clients.length > 0 && (
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
                  <th className="p-3">Contacté</th>
                  <th className="p-3">Actif</th>
                  <th className="p-3">Commentaire</th>
                  <th className="p-3">Fermé</th>
                  <th className="p-3">Motif fermeture</th>
                  <th className="p-3">Rencontres</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-900">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="p-3">{client.first_name}</td>
                    <td className="p-3">{client.last_name}</td>
                    <td className="p-3">{client.email || '-'}</td>
                    <td className="p-3">{client.phone || '-'}</td>
                    <td className="p-3">{client.requester_name || '-'}</td>
                    <td className="p-3">{client.assigned_date}</td>
                    <td className="p-3">{client.contacted ? 'Oui' : 'Non'}</td>
                    <td className="p-3">{client.is_active ? 'Oui' : 'Non'}</td>
                    <td className="p-3">{client.short_comment || '-'}</td>
                    <td className="p-3">{client.dossier_closed ? 'Oui' : 'Non'}</td>
                    <td className="p-3">{client.closure_reason || '-'}</td>
                    <td className="p-3">{client.meeting_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
