'use client'

import { type FormEvent, useEffect, useMemo, useState } from 'react'
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
import { getAssignmentRequestMetrics } from '@/app/professionnel/shared'

type Profile = {
  id: string
  full_name: string | null
  email: string | null
  professional_title: string | null
  professional_phone: string | null
  professional_license_number: string | null
  is_active: boolean | null
  platform_access_enabled: boolean | null
}

type AssignedClient = {
  professional_id: string | null
  assignment_request_id: string | null
  is_active: boolean | null
}

type AssignmentRequest = {
  id: string
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  request_comment: string | null
  created_at?: string | null
}

type ClientStats = {
  total: number
  active: number
  noResponse: number
  pending: number
  usedAssignments: number
}

type ProfessionalRow = {
  id: string
  fullName: string
  email: string
  professionalTitle: string
  professionalPhone: string
  professionalLicenseNumber: string
  isActive: boolean | null
  platformAccessEnabled: boolean
  requestActive: boolean
  requestedCount: number
  assignedCount: number
  remainingCount: number
  pendingClients: number
  activeClients: number
  noResponseClients: number
  requestComment: string
}

export default function DirectionProfessionnelsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<ProfessionalRow[]>([])
  const [archivedRows, setArchivedRows] = useState<ProfessionalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteProfessionalTitle, setInviteProfessionalTitle] = useState('')
  const [inviteProfessionalPhone, setInviteProfessionalPhone] = useState('')
  const [inviteProfessionalLicenseNumber, setInviteProfessionalLicenseNumber] =
    useState('')
  const [invitePlatformAccessEnabled, setInvitePlatformAccessEnabled] =
    useState(true)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [deactivatingProfessionalId, setDeactivatingProfessionalId] = useState<
    string | null
  >(null)
  const [deactivateError, setDeactivateError] = useState('')
  const [reactivatingProfessionalId, setReactivatingProfessionalId] = useState<
    string | null
  >(null)
  const [reactivateError, setReactivateError] = useState('')
  const [resendingAccessProfessionalId, setResendingAccessProfessionalId] =
    useState<string | null>(null)
  const [resendAccessSuccess, setResendAccessSuccess] = useState('')
  const [resendAccessError, setResendAccessError] = useState('')
  const [
    updatingPlatformAccessProfessionalId,
    setUpdatingPlatformAccessProfessionalId,
  ] = useState<string | null>(null)
  const [platformAccessSuccess, setPlatformAccessSuccess] = useState('')
  const [platformAccessError, setPlatformAccessError] = useState('')

  useEffect(() => {
    const loadProfessionals = async () => {
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
        .limit(1)
        .maybeSingle()

      if (currentProfileError || currentProfile?.role !== 'direction') {
        router.push('/')
        return
      }

      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select(
          'id, full_name, email, professional_title, professional_phone, professional_license_number, is_active, platform_access_enabled'
        )
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
        setArchivedRows([])
        setLoading(false)
        return
      }

      const [assignedClientsResponse, assignmentRequestsResponse] = await Promise.all([
        supabase
          .from('assigned_clients')
          .select('professional_id, assignment_request_id, is_active')
          .in('professional_id', professionalIds),
        supabase
          .from('assignment_requests')
          .select(
            'id, professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment, created_at'
          )
          .in('professional_id', professionalIds)
          .order('created_at', { ascending: false }),
      ])

      if (assignedClientsResponse.error) {
        setError(assignedClientsResponse.error.message)
        setLoading(false)
        return
      }

      if (assignmentRequestsResponse.error) {
        setError(assignmentRequestsResponse.error.message)
        setLoading(false)
        return
      }

      const assignedClients = (assignedClientsResponse.data ?? []) as AssignedClient[]
      const assignmentRequests = (assignmentRequestsResponse.data ?? []) as AssignmentRequest[]

      const clientStatsByRequestId = new Map<string, ClientStats>()
      const clientStatsByProfessionalId = new Map<string, ClientStats>()

      assignedClients.forEach((client) => {
        if (!client.professional_id) return

        const currentProfessionalStats = clientStatsByProfessionalId.get(
          client.professional_id
        ) ?? {
          total: 0,
          active: 0,
          noResponse: 0,
          pending: 0,
          usedAssignments: 0,
        }

        currentProfessionalStats.total += 1

        if (client.is_active === true) {
          currentProfessionalStats.usedAssignments += 1
        }

        if (client.is_active === true) {
          currentProfessionalStats.active += 1
        } else if (client.is_active === false) {
          currentProfessionalStats.noResponse += 1
        } else {
          currentProfessionalStats.pending += 1
        }

        clientStatsByProfessionalId.set(
          client.professional_id,
          currentProfessionalStats
        )

        if (!client.assignment_request_id) return

        const currentRequestStats = clientStatsByRequestId.get(
          client.assignment_request_id
        ) ?? {
          total: 0,
          active: 0,
          noResponse: 0,
          pending: 0,
          usedAssignments: 0,
        }

        currentRequestStats.total += 1

        if (client.is_active === true) {
          currentRequestStats.usedAssignments += 1
          currentRequestStats.active += 1
        } else if (client.is_active === false) {
          currentRequestStats.noResponse += 1
        } else {
          currentRequestStats.pending += 1
        }

        clientStatsByRequestId.set(client.assignment_request_id, currentRequestStats)
      })

      const requestsByProfessionalId = new Map<string, AssignmentRequest[]>()

      assignmentRequests.forEach((request) => {
        const currentRequests = requestsByProfessionalId.get(request.professional_id) ?? []
        currentRequests.push(request)
        requestsByProfessionalId.set(request.professional_id, currentRequests)
      })

      const nextRows = professionals.map((profile) => {
        const professionalRequests = requestsByProfessionalId.get(profile.id) ?? []
        const getRequestMetrics = (currentRequest: AssignmentRequest) => {
          const requestStats = clientStatsByRequestId.get(currentRequest.id)

          return getAssignmentRequestMetrics({
            isActive: currentRequest.is_active,
            requestedCount: currentRequest.requested_count,
            acceptedCount: requestStats?.usedAssignments ?? 0,
            remainingCount: currentRequest.remaining_count,
          })
        }
        const request =
          professionalRequests.find((currentRequest) =>
            getRequestMetrics(currentRequest).isActive
          ) ?? professionalRequests[0]
        const requestClientStats = request
          ? clientStatsByRequestId.get(request.id)
          : undefined
        const professionalClientStats = clientStatsByProfessionalId.get(profile.id)

        const requestMetrics = request
          ? getRequestMetrics(request)
          : getAssignmentRequestMetrics({
              isActive: null,
              requestedCount: null,
              acceptedCount: null,
              remainingCount: null,
            })

        return {
          id: profile.id,
          fullName: profile.full_name ?? '-',
          email: profile.email ?? '-',
          professionalTitle: profile.professional_title ?? '-',
          professionalPhone: profile.professional_phone ?? '-',
          professionalLicenseNumber: profile.professional_license_number ?? '-',
          isActive: profile.is_active,
          platformAccessEnabled: profile.platform_access_enabled !== false,
          requestActive: requestMetrics.isActive,
          requestedCount: requestMetrics.requestedCount,
          assignedCount: requestClientStats?.usedAssignments ?? 0,
          remainingCount: requestMetrics.isActive
            ? Math.max(
                requestMetrics.requestedCount -
                  (requestClientStats?.usedAssignments ?? 0) -
                  (requestClientStats?.pending ?? 0),
                0
              )
            : 0,
          pendingClients: professionalClientStats?.pending ?? 0,
          activeClients: professionalClientStats?.active ?? 0,
          noResponseClients: professionalClientStats?.noResponse ?? 0,
          requestComment: request?.request_comment?.trim() || '-',
        }
      })

      setRows(nextRows.filter((row) => row.isActive === true))
      setArchivedRows(nextRows.filter((row) => row.isActive === false))
      setLoading(false)
    }

    loadProfessionals()
  }, [router])

  const visibleRows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()

    return rows.filter((row) => {
      if (!normalizedSearch) return true

      return [row.fullName, row.email, row.requestComment]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    })
  }, [rows, searchQuery])

  const visibleArchivedRows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()

    return archivedRows.filter((row) => {
      if (!normalizedSearch) return true

      return [row.fullName, row.email, row.requestComment]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    })
  }, [archivedRows, searchQuery])

  const handleInviteProfessional = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (inviteLoading) return

    setInviteSuccess('')
    setInviteError('')

    const fullName = inviteFullName.trim()
    const email = inviteEmail.trim()

    if (!fullName) {
      setInviteError('Le nom complet est requis.')
      return
    }

    if (!email) {
      setInviteError('Le courriel est requis.')
      return
    }

    setInviteLoading(true)

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.access_token) {
      setInviteLoading(false)
      setInviteError('Session introuvable. Veuillez vous reconnecter.')
      return
    }

    try {
      const response = await fetch('/api/direction/invite-professional', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          professional_title: inviteProfessionalTitle.trim(),
          professional_phone: inviteProfessionalPhone.trim(),
          professional_license_number: inviteProfessionalLicenseNumber.trim(),
          platform_access_enabled: invitePlatformAccessEnabled,
        }),
      })

      const result = (await response.json()) as {
        error?: string
        invitation_sent?: boolean
      }

      if (!response.ok) {
        setInviteError(result.error ?? "Impossible d'envoyer l'invitation.")
        return
      }

      setInviteFullName('')
      setInviteEmail('')
      setInviteProfessionalTitle('')
      setInviteProfessionalPhone('')
      setInviteProfessionalLicenseNumber('')
      setInvitePlatformAccessEnabled(true)
      setInviteSuccess(
        result.invitation_sent
          ? 'Invitation envoyée avec succès.'
          : 'Profil créé sans invitation. Le suivi sera géré par la direction.'
      )
    } catch {
      setInviteError("Erreur réseau pendant l'envoi de l'invitation.")
    } finally {
      setInviteLoading(false)
    }
  }

  const handleDeactivateProfessional = async (professional: ProfessionalRow) => {
    const confirmed = window.confirm(
      'Êtes-vous sûr de vouloir désactiver ce professionnel ? Il ne sera plus visible dans les assignations actives, mais son historique sera conservé.'
    )

    if (!confirmed) return

    setDeactivateError('')
    setReactivateError('')
    setDeactivatingProfessionalId(professional.id)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ is_active: false })
      .eq('id', professional.id)

    if (updateError) {
      setDeactivateError(updateError.message)
      setDeactivatingProfessionalId(null)
      return
    }

    setRows((currentRows) =>
      currentRows.filter((row) => row.id !== professional.id)
    )
    setArchivedRows((currentRows) => [
      ...currentRows,
      { ...professional, isActive: false },
    ].sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr')))
    setDeactivatingProfessionalId(null)
  }

  const handleReactivateProfessional = async (professional: ProfessionalRow) => {
    const confirmed = window.confirm(
      `Réactiver le professionnel "${professional.fullName}" ? Il redeviendra visible dans les listes actives.`
    )

    if (!confirmed) return

    setDeactivateError('')
    setReactivateError('')
    setReactivatingProfessionalId(professional.id)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ is_active: true })
      .eq('id', professional.id)

    if (updateError) {
      setReactivateError(updateError.message)
      setReactivatingProfessionalId(null)
      return
    }

    setArchivedRows((currentRows) =>
      currentRows.filter((row) => row.id !== professional.id)
    )
    setRows((currentRows) => [
      ...currentRows,
      { ...professional, isActive: true },
    ].sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr')))
    setReactivatingProfessionalId(null)
  }

  const handleEnablePlatformAccess = async (professional: ProfessionalRow) => {
    const confirmed = window.confirm(
      `Activer l'accès plateforme pour "${professional.fullName}" et envoyer un lien d'accès ?`
    )

    if (!confirmed) return

    setPlatformAccessSuccess('')
    setPlatformAccessError('')
    setUpdatingPlatformAccessProfessionalId(professional.id)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ platform_access_enabled: true })
      .eq('id', professional.id)

    if (updateError) {
      setPlatformAccessError(updateError.message)
      setUpdatingPlatformAccessProfessionalId(null)
      return
    }

    const updateRows = (currentRows: ProfessionalRow[]) =>
      currentRows.map((row) =>
        row.id === professional.id
          ? { ...row, platformAccessEnabled: true }
          : row
      )

    setRows(updateRows)
    setArchivedRows(updateRows)

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.access_token) {
      setPlatformAccessError(
        "Accès activé, mais session introuvable pour envoyer le lien."
      )
      setUpdatingPlatformAccessProfessionalId(null)
      return
    }

    try {
      const response = await fetch('/api/direction/resend-professional-access', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          professionalId: professional.id,
        }),
      })

      const result = (await response.json()) as { error?: string; email?: string }

      if (!response.ok) {
        setPlatformAccessError(
          result.error ??
            "Accès activé, mais impossible d'envoyer le lien d'accès."
        )
        return
      }

      setPlatformAccessSuccess(
        `Accès plateforme activé. Lien envoyé à ${
          result.email ?? professional.email
        }.`
      )
    } catch {
      setPlatformAccessError(
        "Accès activé, mais erreur réseau pendant l'envoi du lien."
      )
    } finally {
      setUpdatingPlatformAccessProfessionalId(null)
    }
  }

  const handleDisablePlatformAccess = async (professional: ProfessionalRow) => {
    const confirmed = window.confirm(
      `Désactiver l'accès plateforme pour "${professional.fullName}" ? Les assignations et statistiques seront conservées.`
    )

    if (!confirmed) return

    setPlatformAccessSuccess('')
    setPlatformAccessError('')
    setUpdatingPlatformAccessProfessionalId(professional.id)

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ platform_access_enabled: false })
      .eq('id', professional.id)

    if (updateError) {
      setPlatformAccessError(updateError.message)
      setUpdatingPlatformAccessProfessionalId(null)
      return
    }

    const updateRows = (currentRows: ProfessionalRow[]) =>
      currentRows.map((row) =>
        row.id === professional.id
          ? { ...row, platformAccessEnabled: false }
          : row
      )

    setRows(updateRows)
    setArchivedRows(updateRows)
    setPlatformAccessSuccess(
      `Accès plateforme désactivé pour ${professional.fullName}.`
    )
    setUpdatingPlatformAccessProfessionalId(null)
  }

  const handleResendAccess = async (professional: ProfessionalRow) => {
    const confirmed = window.confirm(
      `Renvoyer un lien d'accès à "${professional.fullName}" ?`
    )

    if (!confirmed) return

    setResendAccessSuccess('')
    setResendAccessError('')
    setResendingAccessProfessionalId(professional.id)

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.access_token) {
      setResendingAccessProfessionalId(null)
      setResendAccessError('Session introuvable. Veuillez vous reconnecter.')
      return
    }

    try {
      const response = await fetch('/api/direction/resend-professional-access', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          professionalId: professional.id,
        }),
      })

      const result = (await response.json()) as { error?: string; email?: string }

      if (!response.ok) {
        setResendAccessError(
          result.error ?? "Impossible de renvoyer le lien d'accès."
        )
        return
      }

      setResendAccessSuccess(
        `Lien d'accès envoyé à ${result.email ?? professional.email}.`
      )
    } catch {
      setResendAccessError("Erreur réseau pendant l'envoi du lien d'accès.")
    } finally {
      setResendingAccessProfessionalId(null)
    }
  }

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <p className="text-sm font-medium text-[#9b6a3d]">Direction</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#332820]">
              Professionnels
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
              Liste detaillee des professionnels, de leurs demandes et de leurs
              clients assignés.
            </p>
          </div>

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement des professionnels...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Erreur: {error}
            </div>
          )}

          {!loading && !error && (
            <>
              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <div className="mb-5">
                  <h2 className="text-lg font-semibold text-[#332820]">
                    Inviter un professionnel
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-[#7a6859]">
                    Envoyez un lien par courriel pour permettre au professionnel
                    de créer son compte.
                  </p>
                </div>

                <form
                  onSubmit={handleInviteProfessional}
                  className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Nom complet
                    <input
                      type="text"
                      value={inviteFullName}
                      onChange={(event) => setInviteFullName(event.target.value)}
                      placeholder="Nom du professionnel"
                      disabled={inviteLoading}
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] disabled:cursor-not-allowed disabled:bg-[#f7efe7]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Courriel
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="professionnel@exemple.com"
                      disabled={inviteLoading}
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] disabled:cursor-not-allowed disabled:bg-[#f7efe7]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Titre professionnel
                    <input
                      type="text"
                      value={inviteProfessionalTitle}
                      onChange={(event) =>
                        setInviteProfessionalTitle(event.target.value)
                      }
                      placeholder="Psychoéducatrice, psychologue..."
                      disabled={inviteLoading}
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] disabled:cursor-not-allowed disabled:bg-[#f7efe7]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Téléphone professionnel
                    <input
                      type="tel"
                      value={inviteProfessionalPhone}
                      onChange={(event) =>
                        setInviteProfessionalPhone(event.target.value)
                      }
                      placeholder="Téléphone"
                      disabled={inviteLoading}
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] disabled:cursor-not-allowed disabled:bg-[#f7efe7]"
                    />
                  </label>

                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Numéro de permis
                    <input
                      type="text"
                      value={inviteProfessionalLicenseNumber}
                      onChange={(event) =>
                        setInviteProfessionalLicenseNumber(event.target.value)
                      }
                      placeholder="Numéro de permis"
                      disabled={inviteLoading}
                      className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] disabled:cursor-not-allowed disabled:bg-[#f7efe7]"
                    />
                  </label>

                  <label className="flex items-center gap-2 self-end text-sm font-medium text-[#5d4a3d]">
                    <input
                      type="checkbox"
                      checked={invitePlatformAccessEnabled}
                      onChange={(event) =>
                        setInvitePlatformAccessEnabled(event.target.checked)
                      }
                      disabled={inviteLoading}
                      className="h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633] disabled:cursor-not-allowed"
                    />
                    Accès plateforme activé
                  </label>

                  <div className="flex items-end xl:col-start-3 xl:row-start-1">
                    <button
                      type="submit"
                      disabled={inviteLoading}
                      className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-[#8a5633] px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-[#6d3f1f] disabled:cursor-not-allowed disabled:bg-[#c8b8a8] lg:w-auto"
                    >
                      {inviteLoading
                        ? 'Envoi...'
                        : invitePlatformAccessEnabled
                          ? "Envoyer l'invitation"
                          : 'Créer sans invitation'}
                    </button>
                  </div>
                </form>

                {inviteSuccess && (
                  <p className="mt-4 rounded-xl border border-[#d6c7aa] bg-[#f1ead9] p-3 text-sm text-[#5f5932]">
                    {inviteSuccess}
                  </p>
                )}

                {inviteError && (
                  <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {inviteError}
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.06)]">
                <label className="block text-sm font-medium text-[#5d4a3d]">
                  Recherche
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Nom, email, commentaire de demande"
                    className="mt-2 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  />
                </label>
              </section>

              {deactivateError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Impossible de désactiver le professionnel: {deactivateError}
                </div>
              )}

              {reactivateError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Impossible de réactiver le professionnel: {reactivateError}
                </div>
              )}

              {resendAccessSuccess && (
                <div className="mt-4 rounded-xl border border-[#d6c7aa] bg-[#f1ead9] p-3 text-sm text-[#5f5932]">
                  {resendAccessSuccess}
                </div>
              )}

              {resendAccessError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {resendAccessError}
                </div>
              )}

              {platformAccessSuccess && (
                <div className="mt-4 rounded-xl border border-[#d6c7aa] bg-[#f1ead9] p-3 text-sm text-[#5f5932]">
                  {platformAccessSuccess}
                </div>
              )}

              {platformAccessError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {platformAccessError}
                </div>
              )}

              <div className="mt-6">
                <h2 className="text-lg font-semibold text-[#332820]">
                  Professionnels actifs
                </h2>
                <p className="mt-1 text-sm text-[#7a6859]">
                  Ces professionnels sont visibles dans les listes actives et les
                  assignations.
                </p>
              </div>

              <div className={`mt-6 ${tableShellClass}`}>
                <table className={`${tableClass} w-full`}>
                  <thead className={tableHeaderClass}>
                    <tr>
                      <th className={tableHeadCellClass}>Nom</th>
                      <th className={tableHeadCellClass}>Email</th>
                      <th className={tableHeadCellClass}>Accès plateforme</th>
                      <th className={tableHeadCellClass}>Statut demande</th>
                      <th className={tableHeadCellClass}>Clients demandes</th>
                      <th className={tableHeadCellClass}>En attente</th>
                      <th className={tableHeadCellClass}>Services pris</th>
                      <th className={tableHeadCellClass}>Places restantes</th>
                      <th className={tableHeadCellClass}>Services non pris</th>
                      <th className={tableHeadCellClass}>Commentaire demande</th>
                      <th className={tableHeadCellClass}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className={tableBodyClass}>
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-4 py-8">
                          <EmptyState
                            title="Aucun professionnel trouvé"
                            description="Ajustez la recherche pour élargir la liste."
                          />
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((row) => {
                        const requestStatus = getAssignmentRequestStatus({
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
                              <Badge
                                tone={row.platformAccessEnabled ? 'success' : 'muted'}
                              >
                                {row.platformAccessEnabled
                                  ? 'Accès plateforme activé'
                                  : 'Suivi direction seulement'}
                              </Badge>
                            </td>
                            <td className={tableCellClass}>
                              <Badge tone={requestStatus.tone}>
                                {requestStatus.label}
                              </Badge>
                            </td>
                            <td className={tableCellClass}>{row.requestedCount}</td>
                            <td className={tableCellClass}>
                              <Badge
                                tone={row.pendingClients > 0 ? 'warning' : 'muted'}
                              >
                                {row.pendingClients} à confirmer
                              </Badge>
                            </td>
                            <td className={tableCellClass}>{row.activeClients}</td>
                            <td className={tableCellClass}>
                              <Badge
                                tone={row.remainingCount > 0 ? 'warning' : 'success'}
                              >
                                {row.remainingCount} restants
                              </Badge>
                            </td>
                            <td className={tableCellClass}>
                              <Badge
                                tone={row.noResponseClients > 0 ? 'danger' : 'muted'}
                              >
                                {row.noResponseClients} service non pris
                              </Badge>
                            </td>
                            <td className={tableCellClass}>{row.requestComment}</td>
                            <td className={tableCellClass}>
                              <div className="flex flex-wrap gap-2">
                                {row.platformAccessEnabled ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDisablePlatformAccess(row)}
                                    disabled={
                                      updatingPlatformAccessProfessionalId === row.id
                                    }
                                    className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[#d6c7aa] bg-white px-3 py-2 text-xs font-medium text-[#6d3f1f] transition hover:bg-[#f7efe7] disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {updatingPlatformAccessProfessionalId === row.id
                                      ? 'Mise à jour...'
                                      : 'Désactiver accès'}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleEnablePlatformAccess(row)}
                                    disabled={
                                      updatingPlatformAccessProfessionalId === row.id
                                    }
                                    className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[#d6c7aa] bg-[#f1ead9] px-3 py-2 text-xs font-medium text-[#6d3f1f] transition hover:bg-[#eadfc8] disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {updatingPlatformAccessProfessionalId === row.id
                                      ? 'Activation...'
                                      : 'Activer accès plateforme'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleResendAccess(row)}
                                  disabled={
                                    !row.platformAccessEnabled ||
                                    resendingAccessProfessionalId === row.id
                                  }
                                  className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[#d6c7aa] bg-[#f1ead9] px-3 py-2 text-xs font-medium text-[#6d3f1f] transition hover:bg-[#eadfc8] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {resendingAccessProfessionalId === row.id
                                    ? 'Envoi...'
                                    : 'Renvoyer accès'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeactivateProfessional(row)}
                                  disabled={deactivatingProfessionalId === row.id}
                                  className="inline-flex min-h-9 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {deactivatingProfessionalId === row.id
                                    ? 'Désactivation...'
                                    : 'Désactiver'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <section className="mt-8">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-[#332820]">
                    Professionnels archivés
                  </h2>
                  <p className="mt-1 text-sm text-[#7a6859]">
                    Ces professionnels sont désactivés. Leur profil et leur
                    historique restent conserves.
                  </p>
                </div>

                <div className={tableShellClass}>
                  <table className={`${tableClass} w-full`}>
                    <thead className={tableHeaderClass}>
                      <tr>
                        <th className={tableHeadCellClass}>Nom</th>
                        <th className={tableHeadCellClass}>Email</th>
                        <th className={tableHeadCellClass}>Accès plateforme</th>
                        <th className={tableHeadCellClass}>Statut</th>
                        <th className={tableHeadCellClass}>Commentaire demande</th>
                        <th className={tableHeadCellClass}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className={tableBodyClass}>
                      {visibleArchivedRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8">
                            <EmptyState
                              title="Aucun professionnel archivé"
                              description="Les professionnels désactivés apparaîtront ici."
                            />
                          </td>
                        </tr>
                      ) : (
                        visibleArchivedRows.map((row) => (
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
                              <Badge
                                tone={row.platformAccessEnabled ? 'success' : 'muted'}
                              >
                                {row.platformAccessEnabled
                                  ? 'Accès plateforme activé'
                                  : 'Suivi direction seulement'}
                              </Badge>
                            </td>
                            <td className={tableCellClass}>
                              <Badge tone="muted">Inactif</Badge>
                            </td>
                            <td className={tableCellClass}>{row.requestComment}</td>
                            <td className={tableCellClass}>
                              <div className="flex flex-wrap gap-2">
                                {row.platformAccessEnabled ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDisablePlatformAccess(row)}
                                    disabled={
                                      updatingPlatformAccessProfessionalId === row.id
                                    }
                                    className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[#d6c7aa] bg-white px-3 py-2 text-xs font-medium text-[#6d3f1f] transition hover:bg-[#f7efe7] disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {updatingPlatformAccessProfessionalId === row.id
                                      ? 'Mise à jour...'
                                      : 'Désactiver accès'}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleEnablePlatformAccess(row)}
                                    disabled={
                                      updatingPlatformAccessProfessionalId === row.id
                                    }
                                    className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[#d6c7aa] bg-[#f1ead9] px-3 py-2 text-xs font-medium text-[#6d3f1f] transition hover:bg-[#eadfc8] disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {updatingPlatformAccessProfessionalId === row.id
                                      ? 'Activation...'
                                      : 'Activer accès plateforme'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleResendAccess(row)}
                                  disabled={
                                    !row.platformAccessEnabled ||
                                    resendingAccessProfessionalId === row.id
                                  }
                                  className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[#d6c7aa] bg-[#f1ead9] px-3 py-2 text-xs font-medium text-[#6d3f1f] transition hover:bg-[#eadfc8] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {resendingAccessProfessionalId === row.id
                                    ? 'Envoi...'
                                    : 'Renvoyer accès'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReactivateProfessional(row)}
                                  disabled={reactivatingProfessionalId === row.id}
                                  className="inline-flex min-h-9 items-center justify-center rounded-xl border border-[#d6c7aa] bg-[#f1ead9] px-3 py-2 text-xs font-medium text-[#6d3f1f] transition hover:bg-[#eadfc8] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {reactivatingProfessionalId === row.id
                                    ? 'Réactivation...'
                                    : 'Réactiver'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </>
  )
}
