'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { Badge, buttonClass, getAssignmentRequestStatus } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import {
  getRemainingAssignmentCount,
  getUsedAssignmentCount,
  type AssignmentRequest,
} from '../shared'

export default function ProfessionnelDemandePage() {
  const router = useRouter()
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
  const [completedRequestHidden, setCompletedRequestHidden] = useState(false)

  useEffect(() => {
    const loadData = async () => {
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

      const [requestResponse, clientsResponse] = await Promise.all([
        supabase
          .from('assignment_requests')
          .select(
            'professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment'
          )
          .eq('professional_id', user.id)
          .limit(1),
        supabase
          .from('assigned_clients')
          .select('is_active')
          .eq('professional_id', user.id),
      ])

      if (requestResponse.error) {
        setError(requestResponse.error.message)
        setLoading(false)
        return
      }

      if (clientsResponse.error) {
        setError(clientsResponse.error.message)
        setLoading(false)
        return
      }

      const currentRequest = (requestResponse.data?.[0] ?? null) as AssignmentRequest | null
      const currentAssignedCount = getUsedAssignmentCount(
        (clientsResponse.data ?? []) as Array<{ is_active: boolean | null }>
      )
      const currentRemainingCount = getRemainingAssignmentCount(
        currentRequest?.requested_count ?? 0,
        currentAssignedCount
      )
      const isLoadedRequestCompleted = Boolean(
        currentRequest &&
          currentRequest.is_active !== false &&
          currentRemainingCount === 0
      )

      setHasExistingRequest(Boolean(currentRequest))
      setCompletedRequestHidden(isLoadedRequestCompleted)

      if (isLoadedRequestCompleted) {
        setRequestActive(false)
        setRequestedCount(0)
        setAssignedCount(0)
        setRemainingCount(0)
        setRequestComment('')
      } else {
        setRequestActive(currentRequest?.is_active ?? false)
        setRequestedCount(currentRequest?.requested_count ?? 0)
        setAssignedCount(currentAssignedCount)
        setRemainingCount(currentRemainingCount)
        setRequestComment(currentRequest?.request_comment ?? '')
      }
      setLoading(false)
    }

    loadData()
  }, [router])

  const handleSaveRequest = async () => {
    setSavingRequest(true)
    setRequestMessage('')
    setRequestError('')

    const normalizedRequestedCount = Math.max(0, Math.trunc(requestedCount || 0))
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setRequestError('Utilisateur introuvable.')
      setSavingRequest(false)
      return
    }

    const { data: clientsData, error: clientsError } = await supabase
      .from('assigned_clients')
      .select('is_active')
      .eq('professional_id', user.id)

    if (clientsError) {
      setRequestError(clientsError.message)
      setSavingRequest(false)
      return
    }

    const normalizedAssignedCount = getUsedAssignmentCount(
      (clientsData ?? []) as Array<{ is_active: boolean | null }>
    )
    const nextRemainingCount = getRemainingAssignmentCount(
      normalizedRequestedCount,
      normalizedAssignedCount
    )

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
    setCompletedRequestHidden(false)
    setRequestedCount(normalizedRequestedCount)
    setAssignedCount(normalizedAssignedCount)
    setRemainingCount(nextRemainingCount)
    setRequestMessage(
      nextRemainingCount === 0 && normalizedRequestedCount > 0
        ? 'Demande complétée sauvegardée.'
        : 'Demande active sauvegardée.'
    )
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
    setCompletedRequestHidden(false)
    setRequestedCount(0)
    setAssignedCount(0)
    setRemainingCount(0)
    setRequestComment('')
    setRequestMessage('Demande effacée.')
    setClearingRequest(false)
  }

  const requestStatus = getAssignmentRequestStatus({
    isActive: requestActive,
    remainingCount,
    requestedCount,
  })
  const isRequestCompleted = completedRequestHidden

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8">
            <p className="text-sm font-medium text-[#9b6a3d]">Espace professionnel</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#332820]">
              Ma demande
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
              Creer, mettre a jour ou desactiver votre demande d&apos;assignation.
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
            <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
              <div>
                <h2 className="text-lg font-semibold text-[#332820]">
                  Demande d&apos;assignation
                </h2>
                <p className="mt-1 text-sm text-[#7a6859]">
                  Statut actuel:{' '}
                  <Badge tone={requestStatus.tone}>{requestStatus.label}</Badge>
                </p>
                <p className="mt-2 text-sm text-[#7a6859]">
                  Sauvegarder crée ou met à jour une demande active. Effacer
                  désactive la demande actuelle.
                </p>
              </div>

              {isRequestCompleted && (
                <div className="mt-5 rounded-2xl border border-[#d6c7aa] bg-[#f1ead9] p-4 text-sm text-[#5f5932]">
                  Votre dernière demande est complétée. Vous pouvez créer une
                  nouvelle demande au besoin.
                </div>
              )}

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
                    <Badge tone={requestStatus.tone}>{requestStatus.label}</Badge>
                  </div>
                </div>
              </div>

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

                {!isRequestCompleted && (
                  <button
                    type="button"
                    onClick={handleClearRequest}
                    disabled={savingRequest || clearingRequest}
                    className={buttonClass('secondary')}
                  >
                    {clearingRequest ? 'Effacement...' : 'Effacer la demande'}
                  </button>
                )}

                {requestMessage && (
                  <p className="text-sm font-medium text-green-700">{requestMessage}</p>
                )}

                {requestError && (
                  <p className="text-sm font-medium text-red-700">{requestError}</p>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  )
}
