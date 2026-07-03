'use client'

import { type FormEvent, type RefObject, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
  type BadgeTone,
  buttonClass,
  EmptyState,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeaderClass,
  tableRowClass,
  tableShellClass,
} from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import { isSuperAdmin } from '@/lib/superAdmin'
import {
  getAssignmentRequestMetrics,
  getServiceTakenCount,
  getUsedAssignmentCount,
  logAudit,
} from '@/app/professionnel/shared'

type WaitingListClient = {
  id: string
  created_at: string | null
  contact_date: string | null
  status: string | null
  priority_level: string | null
  service_requested: string | null
  client_name: string | null
  first_requester_name: string | null
  second_requester_name: string | null
  birth_date: string | null
  city: string | null
  meeting_modality: string | null
  meeting_type: string | null
  availability: string | null
  contact_email: string | null
  contact_phone: string | null
  contact_emails: string[] | null
  contact_phones: string[] | null
  consultation_reason: string | null
  internal_notes: string | null
  assigned_professional_id: string | null
  assigned_at: string | null
}

type Professional = {
  id: string
  full_name: string | null
  email: string | null
}

type AuditActor = {
  id: string
  role: string | null
  name: string | null
}

type ActiveAssignmentRequest = {
  id: string
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  occupied_count?: number | null
}


type WaitingListForm = {
  status: string
  priority_level: string
  contact_date: string
  service_requested: string
  client_name: string
  first_requester_name: string
  second_requester_name: string
  birth_date: string
  address: string
  meeting_modality: string
  availability: string
  contact_email: string
  contact_phone: string
  contact_emails: string[]
  contact_phones: string[]
  consultation_reason: string
  internal_notes: string
}

const waitingListSelect =
  'id, created_at, contact_date, status, priority_level, service_requested, client_name, first_requester_name, second_requester_name, birth_date, city, meeting_modality, meeting_type, availability, contact_email, contact_phone, contact_emails, contact_phones, consultation_reason, internal_notes, assigned_professional_id, assigned_at'

const CLIENTS_PER_PAGE = 10
const HISTORY_CLIENTS_PER_PAGE = 5

const statusOptions = ['waiting', 'assigned', 'active', 'closed', 'blacklisted']

const statusLabels: Record<string, string> = {
  waiting: 'En attente',
  assigned: 'Assigné',
  active: 'Actif',
  closed: 'Fermé',
  blacklisted: 'Liste noire',
}

const statusTones: Record<string, BadgeTone> = {
  waiting: 'warning',
  assigned: 'success',
  active: 'success',
  closed: 'muted',
  blacklisted: 'danger',
}

const priorityOptions = ['normal', 'urgent', 'existing_or_transfer']

const priorityLabels: Record<string, string> = {
  normal: 'Normal',
  urgent: 'Urgent',
  existing_or_transfer: 'Existant / transfert',
}

const priorityTones: Record<string, BadgeTone> = {
  normal: 'neutral',
  urgent: 'danger',
  existing_or_transfer: 'warning',
}

const prioritySortOrder: Record<string, number> = {
  urgent: 0,
  existing_or_transfer: 1,
  normal: 2,
}

const serviceOptions = [
  'Intervention psychosociale',
  'Psychoéducation',
  'Psychothérapie',
  'Évaluation psychologique',
]

const meetingModalityOptions = [
  'Présentiel — bureau de Longueuil',
  'Présentiel — bureau de Montréal',
  'Visioconférence',
  'À domicile',
  'Hybride (présentiel + visioconférence)',
]

const emptyWaitingListForm: WaitingListForm = {
  status: 'waiting',
  priority_level: 'normal',
  contact_date: '',
  service_requested: serviceOptions[0],
  client_name: '',
  first_requester_name: '',
  second_requester_name: '',
  birth_date: '',
  address: '',
  meeting_modality: meetingModalityOptions[0],
  availability: '',
  contact_email: '',
  contact_phone: '',
  contact_emails: [''],
  contact_phones: [''],
  consultation_reason: '',
  internal_notes: '',
}

function formatText(value: string | null | undefined): string {
  return value?.trim() || '-'
}

function nullableText(value: string): string | null {
  const trimmedValue = value.trim()
  return trimmedValue || null
}

function normalizeTextList(values: Array<string | null | undefined>): string[] {
  const uniqueValues = new Set<string>()

  values.forEach((value) => {
    const trimmedValue = value?.trim()

    if (trimmedValue) {
      uniqueValues.add(trimmedValue)
    }
  })

  return Array.from(uniqueValues)
}

function getContactEmails(client: WaitingListClient): string[] {
  return normalizeTextList([
    client.contact_email,
    ...(client.contact_emails ?? []),
  ])
}

function getContactPhones(client: WaitingListClient): string[] {
  return normalizeTextList([
    client.contact_phone,
    ...(client.contact_phones ?? []),
  ])
}

async function recalculateAssignmentRequest(requestId: string): Promise<void> {
  const { data: request, error: requestError } = await supabase
    .from('assignment_requests')
    .select('requested_count')
    .eq('id', requestId)
    .limit(1)
    .maybeSingle()

  if (requestError || !request) return

  const { data: assignedClients, error: assignedClientsError } = await supabase
    .from('assigned_clients')
    .select('is_active')
    .eq('assignment_request_id', requestId)

  if (assignedClientsError || !assignedClients) return

  const assignedCount = getServiceTakenCount(assignedClients)
  const occupiedCount = getUsedAssignmentCount(assignedClients)
  const requestedCount = Math.max(request.requested_count ?? 0, 0)
  const remainingCount = Math.max(requestedCount - occupiedCount, 0)
  const isActive = assignedCount < requestedCount

  await supabase
    .from('assignment_requests')
    .update({
      assigned_count: assignedCount,
      remaining_count: remainingCount,
      is_active: isActive,
    })
    .eq('id', requestId)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'

  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('fr-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatRequester(client: WaitingListClient): string {
  return (
    [client.first_requester_name, client.second_requester_name]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(' / ') || '-'
  )
}

function getContactSortValue(client: WaitingListClient): number {
  const fallbackDate = client.contact_date ?? client.created_at

  if (!fallbackDate) return Number.MAX_SAFE_INTEGER

  const date = new Date(
    fallbackDate.includes('T') ? fallbackDate : `${fallbackDate}T00:00:00`
  )

  return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime()
}

function sortClientsByContactDate(
  clientsToSort: WaitingListClient[]
): WaitingListClient[] {
  return [...clientsToSort].sort(
    (firstClient, secondClient) =>
      getContactSortValue(firstClient) - getContactSortValue(secondClient)
  )
}

function sortWaitingClients(clientsToSort: WaitingListClient[]): WaitingListClient[] {
  return [...clientsToSort].sort((firstClient, secondClient) => {
    const firstPriority =
      prioritySortOrder[firstClient.priority_level ?? ''] ?? Number.MAX_SAFE_INTEGER
    const secondPriority =
      prioritySortOrder[secondClient.priority_level ?? ''] ?? Number.MAX_SAFE_INTEGER

    if (firstPriority !== secondPriority) {
      return firstPriority - secondPriority
    }

    return getContactSortValue(firstClient) - getContactSortValue(secondClient)
  })
}

function normalizeSearchValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function clientMatchesSearch(
  client: WaitingListClient,
  normalizedSearchQuery: string
): boolean {
  if (!normalizedSearchQuery) return true

  return [
    client.client_name,
    client.first_requester_name,
    client.second_requester_name,
    ...getContactEmails(client),
    ...getContactPhones(client),
    client.city,
    client.service_requested,
    client.meeting_modality,
  ]
    .map(normalizeSearchValue)
    .some((value) => value.includes(normalizedSearchQuery))
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function splitClientName(clientName: string | null): {
  firstName: string
  lastName: string
} {
  const nameParts = clientName?.trim().split(/\s+/).filter(Boolean) ?? []

  if (nameParts.length === 0) {
    return { firstName: 'Client', lastName: 'liste d’attente' }
  }

  if (nameParts.length === 1) {
    return { firstName: nameParts[0], lastName: '-' }
  }

  return {
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(' '),
  }
}

function normalizeOption(value: string | null, options: string[]): string {
  return value && options.includes(value) ? value : options[0]
}

function clientToForm(client: WaitingListClient): WaitingListForm {
  return {
    status: statusOptions.includes(client.status ?? '')
      ? client.status ?? 'waiting'
      : 'waiting',
    priority_level: priorityOptions.includes(client.priority_level ?? '')
      ? client.priority_level ?? 'normal'
      : 'normal',
    contact_date: client.contact_date ?? '',
    service_requested: normalizeOption(client.service_requested, serviceOptions),
    client_name: client.client_name ?? '',
    first_requester_name: client.first_requester_name ?? '',
    second_requester_name: client.second_requester_name ?? '',
    birth_date: client.birth_date ?? '',
    address: client.city ?? '',
    meeting_modality: normalizeOption(
      client.meeting_modality,
      meetingModalityOptions
    ),
    availability: client.availability ?? '',
    contact_email: getContactEmails(client)[0] ?? '',
    contact_phone: getContactPhones(client)[0] ?? '',
    contact_emails:
      getContactEmails(client).length > 0 ? getContactEmails(client) : [''],
    contact_phones:
      getContactPhones(client).length > 0 ? getContactPhones(client) : [''],
    consultation_reason: client.consultation_reason ?? '',
    internal_notes: client.internal_notes ?? '',
  }
}

function buildPayload(form: WaitingListForm) {
  const contactEmails = normalizeTextList(form.contact_emails)
  const contactPhones = normalizeTextList(form.contact_phones)

  return {
    status: form.status,
    priority_level: form.priority_level,
    contact_date: nullableText(form.contact_date),
    service_requested: form.service_requested,
    client_name: nullableText(form.client_name),
    first_requester_name: nullableText(form.first_requester_name),
    second_requester_name: nullableText(form.second_requester_name),
    birth_date: nullableText(form.birth_date),
    city: nullableText(form.address),
    meeting_modality: form.meeting_modality,
    availability: nullableText(form.availability),
    contact_email: contactEmails[0] ?? null,
    contact_phone: contactPhones[0] ?? null,
    contact_emails: contactEmails.length > 0 ? contactEmails : null,
    contact_phones: contactPhones.length > 0 ? contactPhones : null,
    consultation_reason: nullableText(form.consultation_reason),
    internal_notes: nullableText(form.internal_notes),
  }
}

export default function DirectionListeAttentePage() {
  const router = useRouter()
  const editSectionRef = useRef<HTMLElement | null>(null)
  const assignmentSectionRef = useRef<HTMLElement | null>(null)
  const waitingSectionRef = useRef<HTMLElement | null>(null)
  const assignedSectionRef = useRef<HTMLElement | null>(null)
  const historySectionRef = useRef<HTMLElement | null>(null)
  const [clients, setClients] = useState<WaitingListClient[]>([])
  const [auditActor, setAuditActor] = useState<AuditActor | null>(null)
  const [canUseSuperAdminActions, setCanUseSuperAdminActions] = useState(false)
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [activeRequests, setActiveRequests] = useState<ActiveAssignmentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<WaitingListForm>(emptyWaitingListForm)
  const [editingClientId, setEditingClientId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<WaitingListForm>(emptyWaitingListForm)
  const [assigningClientId, setAssigningClientId] = useState<string | null>(null)
  const [selectedProfessionalId, setSelectedProfessionalId] = useState('')
  const [savingClient, setSavingClient] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [savingAssignment, setSavingAssignment] = useState(false)
  const [permanentlyDeletingClientId, setPermanentlyDeletingClientId] =
    useState('')
  const [formMessage, setFormMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [waitingPage, setWaitingPage] = useState(0)
  const [assignedPage, setAssignedPage] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedMotifIds, setExpandedMotifIds] = useState<Record<string, boolean>>({})
  const [notifyProfessional, setNotifyProfessional] = useState(false)
  const [notifyClient, setNotifyClient] = useState(false)

  useEffect(() => {
    const loadWaitingList = async () => {
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
        .select('role, full_name, email')
        .eq('id', user.id)
        .limit(1)
        .maybeSingle()

      if (currentProfileError || currentProfile?.role !== 'direction') {
        router.push('/')
        return
      }

      setAuditActor({
        id: user.id,
        role: currentProfile.role,
        name: currentProfile.full_name ?? currentProfile.email ?? null,
      })
      setCanUseSuperAdminActions(isSuperAdmin(user, currentProfile))

      const { data, error: waitingListError } = await supabase
        .from('waiting_list_clients')
        .select(waitingListSelect)
        .order('contact_date', { ascending: true })
        .order('created_at', { ascending: true })

      if (waitingListError) {
        setError(waitingListError.message)
        setLoading(false)
        return
      }

      const loadedClients = (data ?? []) as WaitingListClient[]
      setClients(sortClientsByContactDate(loadedClients))

      const { data: professionalsData, error: professionalsError } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'professionnel')
        .eq('is_active', true)
        .order('full_name', { ascending: true })

      if (professionalsError) {
        setError(professionalsError.message)
        setLoading(false)
        return
      }

      const activeProfessionals = (professionalsData ?? []) as Professional[]
      setProfessionals(activeProfessionals)
      setSelectedProfessionalId((currentValue) =>
        currentValue || activeProfessionals[0]?.id || ''
      )

      const professionalIds = activeProfessionals.map(
        (professional) => professional.id
      )

      if (professionalIds.length > 0) {
        const requestsResponse = await supabase
          .from('assignment_requests')
          .select(
            'id, professional_id, is_active, requested_count, assigned_count, remaining_count'
          )
          .eq('is_active', true)
          .in('professional_id', professionalIds)
          .order('created_at', { ascending: false })

        if (requestsResponse.error) {
          setError(requestsResponse.error.message)
          setLoading(false)
          return
        }

        const requests =
          (requestsResponse.data ?? []) as ActiveAssignmentRequest[]
        const requestIds = requests.map((request) => request.id)

        const assignedClientsResponse =
          requestIds.length > 0
            ? await supabase
                .from('assigned_clients')
                .select('assignment_request_id, is_active')
                .in('assignment_request_id', requestIds)
            : { data: [], error: null }

        if (assignedClientsResponse.error) {
          setError(assignedClientsResponse.error.message)
          setLoading(false)
          return
        }

        const serviceTakenCountByRequestId = new Map<string, number>()
        const occupiedCountByRequestId = new Map<string, number>()

        ;(
          (assignedClientsResponse.data ?? []) as Array<{
            assignment_request_id: string | null
            is_active: boolean | null
          }>
        ).forEach((client) => {
          if (!client.assignment_request_id) return

          if (client.is_active === true) {
            serviceTakenCountByRequestId.set(
              client.assignment_request_id,
              (serviceTakenCountByRequestId.get(client.assignment_request_id) ??
                0) + 1
            )
            occupiedCountByRequestId.set(
              client.assignment_request_id,
              (occupiedCountByRequestId.get(client.assignment_request_id) ?? 0) +
                1
            )
          } else if (client.is_active === null) {
            occupiedCountByRequestId.set(
              client.assignment_request_id,
              (occupiedCountByRequestId.get(client.assignment_request_id) ?? 0) +
                1
            )
          }
        })

        setActiveRequests(
          requests
            .map((request) => {
              const assignedCount = serviceTakenCountByRequestId.get(request.id) ?? 0
              const occupiedCount = occupiedCountByRequestId.get(request.id) ?? 0
              const requestedCount = Math.max(request.requested_count ?? 0, 0)
              const remainingCount = Math.max(requestedCount - occupiedCount, 0)

              return {
                ...request,
                assigned_count: assignedCount,
                occupied_count: occupiedCount,
                remaining_count: remainingCount,
              }
            })
            .filter((request) =>
              getAssignmentRequestMetrics({
                isActive: request.is_active,
                requestedCount: request.requested_count,
                acceptedCount: request.assigned_count,
                occupiedCount: request.occupied_count,
                remainingCount: request.remaining_count,
              }).isActive
            )
        )
      } else {
        setActiveRequests([])
      }

      setLoading(false)
    }

    loadWaitingList()
  }, [router])

  useEffect(() => {
    if (!assigningClientId) return

    window.setTimeout(() => {
      assignmentSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }, [assigningClientId])

  useEffect(() => {
    if (!editingClientId) return

    window.setTimeout(() => {
      editSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }, [editingClientId])

  const updateFormField = (
    field: keyof WaitingListForm,
    value: string | string[]
  ) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  const updateEditFormField = (
    field: keyof WaitingListForm,
    value: string | string[]
  ) => {
    setEditForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  const startEditing = (client: WaitingListClient) => {
    setEditingClientId(client.id)
    setEditForm(clientToForm(client))
    setShowForm(false)
    setAssigningClientId(null)
    setFormError('')
    setFormMessage('')
  }

  const startAssigning = (client: WaitingListClient) => {
    if (client.status !== 'waiting') {
      setFormError('Ce client est déjà assigné ou n’est plus en attente.')
      setFormMessage('')
      return
    }

    setAssigningClientId(client.id)
    setEditingClientId(null)
    setShowForm(false)
    setFormError('')
    setFormMessage('')
    setNotifyProfessional(false)
    setNotifyClient(false)
    setSelectedProfessionalId(
      client.assigned_professional_id ||
        selectedProfessionalId ||
        professionals[0]?.id ||
        ''
    )
  }

  const stopEditing = () => {
    setEditingClientId(null)
    setEditForm(emptyWaitingListForm)
    setFormError('')
  }

  const getPendingAssignmentCount = async (
    professionalId: string
  ): Promise<number | null> => {
    const { count, error: countError } = await supabase
      .from('assigned_clients')
      .select('id', { count: 'exact', head: true })
      .eq('professional_id', professionalId)
      .is('is_active', null)

    if (countError) {
      console.error(
        '[professional-assignment-notification] Impossible de compter les assignations en attente:',
        countError
      )
      return null
    }

    return count ?? 0
  }

  const sendProfessionalAssignmentNotification = async ({
    professionalId,
    previousPendingCount,
  }: {
    professionalId: string
    previousPendingCount: number | null
  }): Promise<boolean> => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.access_token) {
      console.error(
        "[professional-assignment-notification] Session introuvable pour l'envoi.",
        sessionError
      )
      return false
    }

    try {
      console.log('[professional-assignment-notification] Appel route:', {
        professionalId,
        pendingBefore: previousPendingCount,
      })

      const response = await fetch(
        '/api/direction/professional-assignment-notification',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ professionalId, previousPendingCount }),
        }
      )

      const result = (await response.json().catch(() => null)) as
        | {
            error?: string
            skipped?: boolean
            reason?: string
            pendingBefore?: number | null
            pendingAfter?: number
          }
        | null

      console.log('[professional-assignment-notification] Réponse route:', {
        professionalId,
        status: response.status,
        ok: response.ok,
        skipped: result?.skipped ?? false,
        reason: result?.reason ?? null,
        pendingBefore: result?.pendingBefore ?? previousPendingCount,
        pendingAfter: result?.pendingAfter ?? null,
      })

      if (!response.ok) {
        console.error(
          "[professional-assignment-notification] Échec de l'envoi:",
          result?.error ?? response.statusText
        )
        return false
      }

      return true;
    } catch (notificationError) {
      console.error(
        "[professional-assignment-notification] Erreur réseau pendant l'envoi:",
        notificationError
      )
      return false
    }
  }

  const sendClientAssignmentNotification = async (
    assignedClientId: string
  ): Promise<boolean> => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError || !session?.access_token) {
      console.error(
        "[client-assignment-notification] Session introuvable pour l'envoi.",
        sessionError
      )
      return false
    }

    try {
      console.log('[client-assignment-notification] Appel route:', {
        assignedClientId,
      })

      const response = await fetch(
        '/api/direction/client-assignment-notification',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ assignedClientId }),
        }
      )

      const result = (await response.json().catch(() => null)) as
        | {
            error?: string
            skipped?: boolean
            reason?: string
          }
        | null

      console.log('[client-assignment-notification] Réponse route:', {
        assignedClientId,
        status: response.status,
        ok: response.ok,
        skipped: result?.skipped ?? false,
        reason: result?.reason ?? null,
      })

      if (!response.ok) {
        console.error(
          "[client-assignment-notification] Échec de l'envoi:",
          result?.error ?? response.statusText
        )
        return false
      }

      return true
    } catch (notificationError) {
      console.error(
        "[client-assignment-notification] Erreur réseau pendant l'envoi:",
        notificationError
      )
      return false
    }
  }

  const handleCreateClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (savingClient) return

    setFormMessage('')
    setFormError('')

    if (!form.client_name.trim()) {
      setFormError('Le nom du client est requis.')
      return
    }

    setSavingClient(true)

    const { data, error: insertError } = await supabase
      .from('waiting_list_clients')
      .insert({ ...buildPayload(form), status: 'waiting' })
      .select(waitingListSelect)
      .limit(1)
      .maybeSingle()

    setSavingClient(false)

    if (insertError) {
      setFormError(insertError.message)
      return
    }

    if (data) {
      setClients((currentClients) => [
        ...sortClientsByContactDate([
          data as WaitingListClient,
          ...currentClients,
        ]),
      ])
      if (auditActor) {
        void logAudit({
          supabase,
          actor: auditActor,
          action: 'waiting_list_client_created',
          entityType: 'waiting_list_client',
          entityId: (data as WaitingListClient).id,
          description: `Client ${form.client_name.trim()} ajouté à la liste d’attente.`,
          metadata: {
            client_name: form.client_name.trim(),
            requester_name: nullableText(
              [form.first_requester_name, form.second_requester_name]
                .map((value) => value.trim())
                .filter(Boolean)
                .join(' / ')
            ),
            contact_email: normalizeTextList(form.contact_emails)[0] ?? null,
            priority_level: form.priority_level,
            service_requested: form.service_requested,
          },
        })
      }
    }

    setForm(emptyWaitingListForm)
    setShowForm(false)
    setFormMessage('Client ajouté à la liste d’attente.')
  }

  const handleUpdateClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!editingClientId || savingEdit) return

    setFormMessage('')
    setFormError('')

    if (!editForm.client_name.trim()) {
      setFormError('Le nom du client est requis.')
      return
    }

    setSavingEdit(true)

    const { data, error: updateError } = await supabase
      .from('waiting_list_clients')
      .update(buildPayload(editForm))
      .eq('id', editingClientId)
      .select(waitingListSelect)
      .limit(1)
      .maybeSingle()

    setSavingEdit(false)

    if (updateError) {
      setFormError(updateError.message)
      return
    }

    if (data) {
      setClients((currentClients) =>
        sortClientsByContactDate(
          currentClients.map((client) =>
            client.id === editingClientId ? (data as WaitingListClient) : client
          )
        )
      )
    }

    setEditingClientId(null)
    setEditForm(emptyWaitingListForm)
    setFormMessage('Client modifié avec succès.')
  }

  const handlePermanentDeleteClient = async (client: WaitingListClient) => {
    const confirmed = window.confirm(
      'Cette action supprimera définitivement le client ainsi que toutes les données associées.\n\nCette action est irréversible.'
    )

    if (!confirmed) return

    setFormMessage('')
    setFormError('')
    setPermanentlyDeletingClientId(client.id)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      setFormError('Session introuvable.')
      setPermanentlyDeletingClientId('')
      return
    }

    const response = await fetch(`/api/direction/waiting-list-clients/${client.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    setPermanentlyDeletingClientId('')

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null
      setFormError(body?.error ?? 'La suppression définitive a échoué.')
      return
    }

    setClients((currentClients) =>
      currentClients.filter((currentClient) => currentClient.id !== client.id)
    )

    if (editingClientId === client.id) {
      setEditingClientId(null)
      setEditForm(emptyWaitingListForm)
    }

    setFormMessage('Client supprimé définitivement.')
  }

  const handleAssignClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!assigningClientId || savingAssignment) return

    setFormMessage('')
    setFormError('')

    const client = clients.find(
      (currentClient) => currentClient.id === assigningClientId
    )

    if (!client) {
      setFormError('Client introuvable.')
      return
    }

    if (client.status !== 'waiting') {
      setFormError('Ce client est déjà assigné ou n’est plus en attente.')
      return
    }

    if (!selectedProfessionalId) {
      setFormError('Veuillez choisir un professionnel.')
      return
    }

    const assignmentRequest = activeRequests.find(
      (request) =>
        request.professional_id === selectedProfessionalId &&
        getAssignmentRequestMetrics({
          isActive: request.is_active,
          requestedCount: request.requested_count,
          acceptedCount: request.assigned_count,
          occupiedCount: request.occupied_count,
          remainingCount: request.remaining_count,
        }).isActive
    )
    if (!assignmentRequest?.id) {
      setFormError('Ce professionnel n’a aucune demande active avec place restante.')
      return
    }

    const { firstName, lastName } = splitClientName(client.client_name)
    const requesterName = nullableText(
      [client.first_requester_name, client.second_requester_name]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join(' / ')
    )

    setSavingAssignment(true)
    const previousPendingCount = await getPendingAssignmentCount(
      selectedProfessionalId
    )

    const { data: insertedAssignment, error: insertError } = await supabase
      .from('assigned_clients')
      .insert({
        assignment_request_id: assignmentRequest.id,
        waiting_list_client_id: client.id,
        professional_id: selectedProfessionalId,
        first_name: firstName,
        last_name: lastName,
        email: getContactEmails(client)[0] ?? null,
        phone: getContactPhones(client)[0] ?? null,
        requester_name: requesterName,
        short_comment: nullableText(client.consultation_reason ?? ''),
        meeting_modality: nullableText(client.meeting_modality ?? ''),
        service_address: nullableText(client.city ?? ''),
        assigned_date: getTodayDate(),
        contacted: false,
        is_active: null,
        dossier_closed: false,
        closure_reason: null,
        meeting_count: 0,
      })
      .select('id')
      .limit(1)
      .maybeSingle()

    if (insertError) {
      setSavingAssignment(false)
      setFormError(insertError.message)
      return
    }

    if (!insertedAssignment?.id) {
      setSavingAssignment(false)
      setFormError("L'assignation a été créée, mais son identifiant est introuvable.")
      return
    }

    await recalculateAssignmentRequest(assignmentRequest.id)

    const { data, error: updateError } = await supabase
      .from('waiting_list_clients')
      .update({
        status: 'assigned',
        assigned_professional_id: selectedProfessionalId,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', client.id)
      .select(waitingListSelect)
      .limit(1)
      .maybeSingle()

    setSavingAssignment(false)

    if (updateError) {
      setFormError(updateError.message)
      return
    }

    if (data) {
      setClients((currentClients) =>
        sortClientsByContactDate(
          currentClients.map((currentClient) =>
            currentClient.id === client.id
              ? (data as WaitingListClient)
              : currentClient
          )
        )
      )
    }

    setAssigningClientId(null)
    setNotifyProfessional(false)
    setNotifyClient(false)
    setFormMessage('Client assigné au professionnel avec succès.')
    const selectedProfessional = professionals.find(
      (professional) => professional.id === selectedProfessionalId
    )

    if (auditActor) {
      void logAudit({
        supabase,
        actor: auditActor,
        action: 'assignment_created',
        entityType: 'assigned_client',
        entityId: insertedAssignment.id,
        description: `Client ${client.client_name ?? 'sans nom'} assigné à ${
          selectedProfessional?.full_name ?? 'professionnel inconnu'
        }.`,
        metadata: {
          client_name: client.client_name,
          professional_name: selectedProfessional?.full_name ?? null,
          requester_name: requesterName,
          client_email: getContactEmails(client)[0] ?? null,
          professional_id: selectedProfessionalId,
          waiting_list_client_id: client.id,
          assignment_request_id: assignmentRequest.id,
          has_assignment_request: true,
          assignment_mode: 'request_assignment',
        },
      })
    }

    if (notifyProfessional) {
      const notificationSent = await sendProfessionalAssignmentNotification({
        professionalId: selectedProfessionalId,
        previousPendingCount,
      })

      if (auditActor) {
        void logAudit({
          supabase,
          actor: auditActor,
          action: notificationSent
            ? 'professional_notification_sent'
            : 'professional_notification_failed',
          entityType: 'assigned_client',
          entityId: insertedAssignment.id,
          description: notificationSent
            ? `Courriel professionnel envoyé à ${
                selectedProfessional?.full_name ?? 'professionnel inconnu'
              }.`
            : `Courriel professionnel non envoyé à ${
                selectedProfessional?.full_name ?? 'professionnel inconnu'
              }.`,
          metadata: {
            client_name: client.client_name,
            professional_name: selectedProfessional?.full_name ?? null,
            professional_id: selectedProfessionalId,
            notification_type: 'professional_assignment',
          },
        })
      }
    } else if (auditActor) {
      void logAudit({
        supabase,
        actor: auditActor,
        action: 'professional_notification_not_sent',
        entityType: 'assigned_client',
        entityId: insertedAssignment.id,
        description: 'Courriel professionnel non envoyé (case décochée).',
        metadata: {
          client_name: client.client_name,
          professional_name: selectedProfessional?.full_name ?? null,
          professional_id: selectedProfessionalId,
          notification_type: 'professional_assignment',
        },
      })
    }

    if (notifyClient && getContactEmails(client).length > 0) {
      const notificationSent = await sendClientAssignmentNotification(
        insertedAssignment.id
      )

      if (auditActor) {
        void logAudit({
          supabase,
          actor: auditActor,
          action: notificationSent
            ? 'client_notification_sent'
            : 'client_notification_failed',
          entityType: 'assigned_client',
          entityId: insertedAssignment.id,
          description: notificationSent
            ? `Courriel client envoyé pour ${client.client_name ?? 'client sans nom'}.`
            : `Courriel client non envoyé pour ${client.client_name ?? 'client sans nom'}.`,
          metadata: {
            client_name: client.client_name,
            client_email: getContactEmails(client)[0] ?? null,
            professional_name: selectedProfessional?.full_name ?? null,
            waiting_list_client_id: client.id,
            notification_type: 'client_assignment',
          },
        })
      }
    } else if (notifyClient) {
      console.log('[client-assignment-notification] Courriel client absent.', {
        assignedClientId: insertedAssignment.id,
      })
      if (auditActor) {
        void logAudit({
          supabase,
          actor: auditActor,
          action: 'client_notification_not_sent',
          entityType: 'assigned_client',
          entityId: insertedAssignment.id,
          description: 'Courriel client non envoyé (courriel absent).',
          metadata: {
            client_name: client.client_name,
            professional_name: selectedProfessional?.full_name ?? null,
            waiting_list_client_id: client.id,
            notification_type: 'client_assignment',
            reason: 'missing_email',
          },
        })
      }
    } else if (auditActor) {
      void logAudit({
        supabase,
        actor: auditActor,
        action: 'client_notification_not_sent',
        entityType: 'assigned_client',
        entityId: insertedAssignment.id,
        description: 'Courriel client non envoyé (case décochée).',
        metadata: {
          client_name: client.client_name,
          client_email: getContactEmails(client)[0] ?? null,
          professional_name: selectedProfessional?.full_name ?? null,
          waiting_list_client_id: client.id,
          notification_type: 'client_assignment',
        },
      })
    }
  }

  const inputClass =
    'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition duration-200 placeholder:text-[#b09c8a] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const filteredClients = normalizedSearchQuery
    ? clients.filter((client) => clientMatchesSearch(client, normalizedSearchQuery))
    : clients
  const hasSearchQuery = normalizedSearchQuery.length > 0
  const emptySearchMessage = 'Aucun client ne correspond à cette recherche.'
  const waitingClients = sortWaitingClients(
    filteredClients.filter((client) => client.status === 'waiting')
  )
  const assignedClients = filteredClients.filter(
    (client) => client.status === 'assigned'
  )
  const historyClients = filteredClients.filter((client) =>
    ['active', 'closed', 'blacklisted'].includes(client.status ?? '')
  )
  const selectedProfessionalHasActiveRequest = activeRequests.some(
    (request) =>
      request.professional_id === selectedProfessionalId &&
      getAssignmentRequestMetrics({
        isActive: request.is_active,
        requestedCount: request.requested_count,
        acceptedCount: request.assigned_count,
        occupiedCount: request.occupied_count,
        remainingCount: request.remaining_count,
      }).isActive
  )
  const selectedProfessionalHasNoActiveRequest =
    Boolean(selectedProfessionalId) && !selectedProfessionalHasActiveRequest
  const selectedAssignmentClient = assigningClientId
    ? clients.find((client) => client.id === assigningClientId) ?? null
    : null
  const selectedAssignmentClientHasEmail = Boolean(
    selectedAssignmentClient && getContactEmails(selectedAssignmentClient).length > 0
  )
  const getPageCount = (totalCount: number, pageSize = CLIENTS_PER_PAGE) =>
    Math.max(Math.ceil(totalCount / pageSize), 1)
  const getPaginatedClients = (
    sectionClients: WaitingListClient[],
    currentPage: number,
    pageSize = CLIENTS_PER_PAGE
  ) =>
    sectionClients.slice(
      currentPage * pageSize,
      currentPage * pageSize + pageSize
    )
  const waitingPageCount = getPageCount(waitingClients.length)
  const assignedPageCount = getPageCount(assignedClients.length)
  const historyPageCount = getPageCount(
    historyClients.length,
    HISTORY_CLIENTS_PER_PAGE
  )
  const safeWaitingPage = Math.min(waitingPage, waitingPageCount - 1)
  const safeAssignedPage = Math.min(assignedPage, assignedPageCount - 1)
  const safeHistoryPage = Math.min(historyPage, historyPageCount - 1)
  const paginatedWaitingClients = getPaginatedClients(
    waitingClients,
    safeWaitingPage
  )
  const paginatedAssignedClients = getPaginatedClients(
    assignedClients,
    safeAssignedPage
  )
  const paginatedHistoryClients = getPaginatedClients(
    historyClients,
    safeHistoryPage,
    HISTORY_CLIENTS_PER_PAGE
  )

  const renderConsultationReason = (client: WaitingListClient) => {
    const isExpanded = expandedMotifIds[client.id] === true

    return (
      <div className="space-y-2">
        <p
          className={`break-words text-sm text-[#6c5a4d] ${
            isExpanded
              ? 'whitespace-pre-wrap'
              : 'line-clamp-2 whitespace-normal'
          }`}
        >
          {formatText(client.consultation_reason)}
        </p>
        {client.consultation_reason?.trim() && (
          <button
            type="button"
            className="text-sm font-medium text-[#6d3f1f] underline decoration-[#d9b591] underline-offset-2 hover:decoration-[#9b6a3d]"
            onClick={() =>
              setExpandedMotifIds((currentIds) => ({
                ...currentIds,
                [client.id]: !isExpanded,
              }))
            }
          >
            {isExpanded ? 'Masquer le motif' : 'Voir le motif'}
          </button>
        )}
      </div>
    )
  }

  const renderContactInfo = (client: WaitingListClient) => {
    const emails = getContactEmails(client)
    const phones = getContactPhones(client)

    if (emails.length === 0 && phones.length === 0) return '-'

    return (
      <div className="space-y-3 text-sm text-[#6c5a4d]">
        {emails.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase text-[#8a6f5d]">
              Courriels
            </p>
            <div className="mt-1 space-y-1">
              {emails.map((email) => (
                <a
                  key={email}
                  href={`mailto:${email}`}
                  className="block break-words text-[#6d3f1f] underline decoration-[#d9b591] underline-offset-2 hover:decoration-[#9b6a3d]"
                >
                  {email}
                </a>
              ))}
            </div>
          </div>
        )}
        {phones.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase text-[#8a6f5d]">
              Téléphones
            </p>
            <div className="mt-1 space-y-1">
              {phones.map((phone) => (
                <p key={phone} className="break-words">
                  {phone}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderInternalNotes = (client: WaitingListClient) => {
    if (!client.internal_notes?.trim()) return null

    return (
      <div className="mt-3 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-3">
        <p className="text-xs font-semibold uppercase text-[#8a6f5d]">
          Notes internes
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[#6c5a4d]">
          {client.internal_notes.trim()}
        </p>
      </div>
    )
  }

  const renderClientsTable = (
    sectionClients: WaitingListClient[],
    emptyMessage: string,
    allowAssignment: boolean
  ) => (
    <div className={tableShellClass}>
      <table className={`${tableClass} w-full min-w-[1320px]`}>
        <thead className={tableHeaderClass}>
          <tr>
            <th className={tableHeadCellClass}>Priorité</th>
            <th className={tableHeadCellClass}>Statut</th>
            <th className={tableHeadCellClass}>Date de contact</th>
            <th className={tableHeadCellClass}>Service demandé</th>
            <th className={tableHeadCellClass}>Client</th>
            <th className={tableHeadCellClass}>Requérant</th>
            <th className={tableHeadCellClass}>Date de naissance</th>
            <th className={tableHeadCellClass}>Adresse complète</th>
            <th className={tableHeadCellClass}>Modalité</th>
            <th className={tableHeadCellClass}>Préférence horaire</th>
            <th className={tableHeadCellClass}>Contact</th>
            <th className={`${tableHeadCellClass} min-w-[24rem]`}>Motif</th>
            <th className={`${tableHeadCellClass} w-28`}>Actions</th>
          </tr>
        </thead>
        <tbody className={tableBodyClass}>
          {sectionClients.length === 0 ? (
            <tr>
              <td colSpan={13} className="px-4 py-8">
                <EmptyState title={emptyMessage} />
              </td>
            </tr>
          ) : (
            sectionClients.map((client) => {
              const isAlreadyAssigned = client.status === 'assigned'

              return (
                <tr
                  key={client.id}
                  className={`${tableRowClass} ${
                    isAlreadyAssigned ? 'bg-[#f7f2eb] opacity-80' : ''
                  }`}
                >
                  <td className="px-3 py-2 align-top text-[#6c5a4d]">
                    <div className="flex w-28 flex-col items-start gap-2">
                      <Badge tone={priorityTones[client.priority_level ?? ''] ?? 'muted'}>
                        {priorityLabels[client.priority_level ?? ''] ??
                          formatText(client.priority_level)}
                      </Badge>
                      {allowAssignment && (
                        <button
                          type="button"
                          className={`${buttonClass('primary')} !min-h-8 !w-full justify-center whitespace-nowrap px-2 py-1 text-xs`}
                          onClick={() => startAssigning(client)}
                        >
                          Assigner
                        </button>
                      )}
                      {!allowAssignment && isAlreadyAssigned && (
                        <button
                          type="button"
                          className={`${buttonClass('secondary')} !min-h-8 !w-full justify-center whitespace-nowrap px-2 py-1 text-xs`}
                          disabled
                        >
                          Déjà assigné
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-[#6c5a4d]">
                    <div className="space-y-1">
                      <Badge tone={statusTones[client.status ?? ''] ?? 'muted'}>
                        {statusLabels[client.status ?? ''] ??
                          formatText(client.status)}
                      </Badge>
                      {isAlreadyAssigned && (
                        <p className="text-xs font-medium text-[#8a6f5d]">
                          Assignation faite
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-[#6c5a4d]">
                    {formatDate(client.contact_date ?? client.created_at)}
                  </td>
                  <td className="px-3 py-2 align-top text-[#6c5a4d]">
                    {formatText(client.service_requested)}
                  </td>
                  <td className="px-3 py-2 align-top text-[#6c5a4d]">
                    {formatText(client.client_name)}
                  </td>
                  <td className="px-3 py-2 align-top text-[#6c5a4d]">
                    {formatRequester(client)}
                  </td>
                  <td className="px-3 py-2 align-top text-[#6c5a4d]">
                    {formatDate(client.birth_date)}
                  </td>
                  <td className="px-3 py-2 align-top text-[#6c5a4d]">
                    {formatText(client.city)}
                  </td>
                  <td className="px-3 py-2 align-top text-[#6c5a4d]">
                    {formatText(client.meeting_modality)}
                  </td>
                  <td className="px-3 py-2 align-top text-[#6c5a4d]">
                    {formatText(client.availability)}
                  </td>
                  <td className="px-3 py-2 align-top text-[#6c5a4d]">
                    {renderContactInfo(client)}
                  </td>
                  <td className="min-w-[24rem] px-3 py-2 align-top">
                    {renderConsultationReason(client)}
                    {renderInternalNotes(client)}
                  </td>
                  <td className="w-28 px-3 py-2 align-top text-[#6c5a4d]">
                    <div className="flex w-24 flex-col gap-2">
                      <button
                        type="button"
                        className={`${buttonClass('secondary')} !min-h-8 !w-full justify-center whitespace-nowrap px-2 py-1 text-xs`}
                        onClick={() => startEditing(client)}
                      >
                        Modifier
                      </button>
                      {canUseSuperAdminActions && (
                        <button
                          type="button"
                          className={`${buttonClass('danger')} !min-h-8 !w-full justify-center whitespace-normal px-2 py-1 text-xs`}
                          disabled={permanentlyDeletingClientId === client.id}
                          onClick={() => handlePermanentDeleteClient(client)}
                        >
                          {permanentlyDeletingClientId === client.id
                            ? 'Suppression...'
                            : 'Supprimer définitivement'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )

  const renderPagination = ({
    totalCount,
    currentPage,
    pageCount,
    onPageChange,
    sectionRef,
    pageSize = CLIENTS_PER_PAGE,
  }: {
    totalCount: number
    currentPage: number
    pageCount: number
    onPageChange: (page: number) => void
    sectionRef: RefObject<HTMLElement | null>
    pageSize?: number
  }) => {
    if (totalCount <= pageSize) return null
    const changePage = (nextPage: number) => {
      onPageChange(nextPage)
      window.setTimeout(() => {
        sectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      }, 0)
    }

    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[#7a6859]">
          Page {currentPage + 1} sur {pageCount}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`${buttonClass('secondary')} !w-auto min-w-10 px-3`}
            onClick={() => changePage(Math.max(currentPage - 1, 0))}
            disabled={currentPage === 0}
          >
            &lt;
          </button>
          {Array.from({ length: pageCount }, (_, pageIndex) => (
            <button
              key={pageIndex}
              type="button"
              className={`min-h-10 min-w-10 rounded-xl px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#ead2bd] ${
                pageIndex === currentPage
                  ? 'border border-[#d8b992] bg-[#8a5633] text-white shadow-[0_8px_18px_rgba(138,86,51,0.18)]'
                  : 'border border-[#eadfd2] bg-[#fffdf9] text-[#6c5a4d] hover:border-[#d8b992] hover:bg-[#fffaf4] hover:text-[#332820]'
              }`}
              onClick={() => changePage(pageIndex)}
              aria-current={pageIndex === currentPage ? 'page' : undefined}
            >
              {pageIndex + 1}
            </button>
          ))}
          <button
            type="button"
            className={`${buttonClass('secondary')} !w-auto min-w-10 px-3`}
            onClick={() => changePage(Math.min(currentPage + 1, pageCount - 1))}
            disabled={currentPage >= pageCount - 1}
          >
            &gt;
          </button>
        </div>
      </div>
    )
  }

  const renderClientForm = ({
    currentForm,
    onChange,
    onSubmit,
    submitLabel,
    saving,
    showStatus,
    onCancel,
  }: {
    currentForm: WaitingListForm
    onChange: (field: keyof WaitingListForm, value: string | string[]) => void
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    submitLabel: string
    saving: boolean
    showStatus: boolean
    onCancel: () => void
  }) => {
    const updateListValue = (
      field: 'contact_emails' | 'contact_phones',
      index: number,
      value: string
    ) => {
      onChange(
        field,
        currentForm[field].map((currentValue, currentIndex) =>
          currentIndex === index ? value : currentValue
        )
      )
    }

    const addListValue = (field: 'contact_emails' | 'contact_phones') => {
      onChange(field, [...currentForm[field], ''])
    }

    const removeListValue = (
      field: 'contact_emails' | 'contact_phones',
      index: number
    ) => {
      const nextValues = currentForm[field].filter(
        (_currentValue, currentIndex) => currentIndex !== index
      )

      onChange(field, nextValues.length > 0 ? nextValues : [''])
    }

    return (
    <form onSubmit={onSubmit} className="mt-5 space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {showStatus && (
          <label className="text-sm font-medium text-[#5d4a3d]">
            Statut
            <select
              value={currentForm.status}
              onChange={(event) => onChange('status', event.target.value)}
              className={`${inputClass} mt-1`}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm font-medium text-[#5d4a3d]">
          Priorité
          <select
            value={currentForm.priority_level}
            onChange={(event) => onChange('priority_level', event.target.value)}
            className={`${inputClass} mt-1`}
          >
            {priorityOptions.map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabels[priority]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-[#5d4a3d]">
          Date de contact
          <input
            type="date"
            value={currentForm.contact_date}
            onChange={(event) => onChange('contact_date', event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-sm font-medium text-[#5d4a3d]">
          Service demandé
          <select
            value={currentForm.service_requested}
            onChange={(event) =>
              onChange('service_requested', event.target.value)
            }
            className={`${inputClass} mt-1`}
          >
            {serviceOptions.map((service) => (
              <option key={service} value={service}>
                {service}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-[#5d4a3d]">
          Nom du client
          <input
            value={currentForm.client_name}
            onChange={(event) => onChange('client_name', event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-sm font-medium text-[#5d4a3d]">
          1er requérant
          <input
            value={currentForm.first_requester_name}
            onChange={(event) =>
              onChange('first_requester_name', event.target.value)
            }
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-sm font-medium text-[#5d4a3d]">
          2e requérant
          <input
            value={currentForm.second_requester_name}
            onChange={(event) =>
              onChange('second_requester_name', event.target.value)
            }
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-sm font-medium text-[#5d4a3d]">
          Date de naissance
          <input
            type="date"
            value={currentForm.birth_date}
            onChange={(event) => onChange('birth_date', event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-sm font-medium text-[#5d4a3d]">
          Adresse complète
          <input
            value={currentForm.address}
            onChange={(event) => onChange('address', event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-sm font-medium text-[#5d4a3d]">
          Modalité de rencontre
          <select
            value={currentForm.meeting_modality}
            onChange={(event) => onChange('meeting_modality', event.target.value)}
            className={`${inputClass} mt-1`}
          >
            {meetingModalityOptions.map((modality) => (
              <option key={modality} value={modality}>
                {modality}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-2 text-sm font-medium text-[#5d4a3d]">
          <p>Courriel</p>
          {currentForm.contact_emails.map((email, index) => (
            <div key={`email-${index}`} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(event) =>
                  updateListValue('contact_emails', index, event.target.value)
                }
                className={inputClass}
              />
              {currentForm.contact_emails.length > 1 && (
                <button
                  type="button"
                  className={buttonClass('secondary')}
                  onClick={() => removeListValue('contact_emails', index)}
                >
                  Supprimer
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="text-sm font-medium text-[#6d3f1f] underline decoration-[#d9b591] underline-offset-2 hover:decoration-[#9b6a3d]"
            onClick={() => addListValue('contact_emails')}
          >
            Ajouter un autre courriel
          </button>
        </div>
        <div className="space-y-2 text-sm font-medium text-[#5d4a3d]">
          <p>Téléphone</p>
          {currentForm.contact_phones.map((phone, index) => (
            <div key={`phone-${index}`} className="flex gap-2">
              <input
                value={phone}
                onChange={(event) =>
                  updateListValue('contact_phones', index, event.target.value)
                }
                className={inputClass}
              />
              {currentForm.contact_phones.length > 1 && (
                <button
                  type="button"
                  className={buttonClass('secondary')}
                  onClick={() => removeListValue('contact_phones', index)}
                >
                  Supprimer
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="text-sm font-medium text-[#6d3f1f] underline decoration-[#d9b591] underline-offset-2 hover:decoration-[#9b6a3d]"
            onClick={() => addListValue('contact_phones')}
          >
            Ajouter un autre téléphone
          </button>
        </div>
        <label className="text-sm font-medium text-[#5d4a3d] md:col-span-2 xl:col-span-1">
          Préférence horaire
          <input
            value={currentForm.availability}
            onChange={(event) => onChange('availability', event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="text-sm font-medium text-[#5d4a3d]">
          Motif de consultation
          <textarea
            value={currentForm.consultation_reason}
            onChange={(event) =>
              onChange('consultation_reason', event.target.value)
            }
            className={`${inputClass} mt-1 min-h-28 resize-y`}
          />
        </label>
        <label className="text-sm font-medium text-[#5d4a3d]">
          Notes internes
          <textarea
            value={currentForm.internal_notes}
            onChange={(event) => onChange('internal_notes', event.target.value)}
            className={`${inputClass} mt-1 min-h-28 resize-y`}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          className={buttonClass('secondary')}
          onClick={onCancel}
          disabled={saving}
        >
          Annuler
        </button>
        <button
          type="submit"
          className={buttonClass('primary')}
          disabled={saving}
        >
          {saving ? 'Sauvegarde...' : submitLabel}
        </button>
      </div>
    </form>
    )
  }

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8">
            <p className="text-sm font-medium text-[#9b6a3d]">Direction</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#332820]">
              Liste d&apos;attente
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
              Vue de consultation des clients en attente de service.
            </p>
          </div>

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement de la liste d&apos;attente...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Erreur: {error}
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-6">
              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <label className="block text-sm font-medium text-[#5d4a3d]">
                  Recherche
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value)
                      setWaitingPage(0)
                      setAssignedPage(0)
                      setHistoryPage(0)
                    }}
                    placeholder="Rechercher un client, requérant, courriel ou téléphone..."
                    className={`${inputClass} mt-2`}
                  />
                </label>
                {hasSearchQuery && filteredClients.length === 0 && (
                  <p className="mt-3 rounded-xl border border-[#eadfd2] bg-[#f7efe7] px-4 py-3 text-sm text-[#7a6859]">
                    {emptySearchMessage}
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-[#332820]">
                      Ajouter un client
                    </h2>
                    <p className="mt-1 text-sm text-[#7a6859]">
                      Création manuelle dans la liste d’attente, sans assignation.
                    </p>
                  </div>
                  <button
                    type="button"
                    className={buttonClass(showForm ? 'secondary' : 'primary')}
                    onClick={() => {
                      setShowForm((currentValue) => !currentValue)
                      setEditingClientId(null)
                      setAssigningClientId(null)
                      setFormError('')
                      setFormMessage('')
                    }}
                  >
                    {showForm ? 'Fermer' : 'Ajouter un client'}
                  </button>
                </div>

                {formMessage && (
                  <div className="mt-4 rounded-xl border border-[#d6c7aa] bg-[#f1ead9] px-4 py-3 text-sm text-[#5f5932]">
                    {formMessage}
                  </div>
                )}

                {formError && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {formError}
                  </div>
                )}

                {showForm &&
                  renderClientForm({
                    currentForm: form,
                    onChange: updateFormField,
                    onSubmit: handleCreateClient,
                    submitLabel: 'Ajouter à la liste',
                    saving: savingClient,
                    showStatus: false,
                    onCancel: () => {
                      setShowForm(false)
                      setForm(emptyWaitingListForm)
                      setFormError('')
                    },
                  })}
              </section>

              {editingClientId && (
                <section
                  ref={editSectionRef}
                  className="scroll-mt-6 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]"
                >
                  <div>
                    <h2 className="text-base font-semibold text-[#332820]">
                      Modifier le client
                    </h2>
                    <p className="mt-1 text-sm text-[#7a6859]">
                      Mise à jour des informations de la liste d’attente.
                    </p>
                  </div>
                  {renderClientForm({
                    currentForm: editForm,
                    onChange: updateEditFormField,
                    onSubmit: handleUpdateClient,
                    submitLabel: 'Enregistrer les modifications',
                    saving: savingEdit,
                    showStatus: true,
                    onCancel: stopEditing,
                  })}
                </section>
              )}

              {assigningClientId && (
                <section
                  ref={assignmentSectionRef}
                  className="scroll-mt-6 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]"
                >
                  <div>
                    <h2 className="text-base font-semibold text-[#332820]">
                      Assigner le client
                    </h2>
                    <p className="mt-1 text-sm text-[#7a6859]">
                      Choisissez un professionnel actif ayant une demande active
                      avec place restante.
                    </p>
                  </div>
                  <form onSubmit={handleAssignClient} className="mt-5 space-y-4">
                    <label className="text-sm font-medium text-[#5d4a3d]">
                      Professionnel
                      <select
                        value={selectedProfessionalId}
                        onChange={(event) =>
                          setSelectedProfessionalId(event.target.value)
                        }
                        className={`${inputClass} mt-1`}
                      >
                        {professionals.length === 0 ? (
                          <option value="">Aucun professionnel actif</option>
                        ) : (
                          professionals.map((professional) => (
                            <option key={professional.id} value={professional.id}>
                              {professional.full_name || professional.email || 'Sans nom'}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                    {selectedProfessionalHasNoActiveRequest ? (
                      <div className="rounded-xl border border-[#eadfd2] bg-[#fffaf4] px-4 py-3 text-sm text-[#7a6859]">
                        Ce professionnel n’a aucune demande active avec place restante.
                      </div>
                    ) : (
                      <div className="rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-4">
                        <p className="text-sm font-semibold text-[#332820]">
                          Souhaitez-vous envoyer les notifications ?
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <label className="flex items-start gap-2 text-sm text-[#6c5a4d]">
                            <input
                              type="checkbox"
                              checked={notifyProfessional}
                              onChange={(event) =>
                                setNotifyProfessional(event.target.checked)
                              }
                              className="mt-0.5 h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633]"
                            />
                            Envoyer un courriel au professionnel
                          </label>
                          <label className="flex items-start gap-2 text-sm text-[#6c5a4d]">
                            <input
                              type="checkbox"
                              checked={notifyClient}
                              disabled={!selectedAssignmentClientHasEmail}
                              onChange={(event) => setNotifyClient(event.target.checked)}
                              className="mt-0.5 h-4 w-4 rounded border-[#dfd0bf] accent-[#8a5633] disabled:opacity-50"
                            />
                            Envoyer un courriel au client
                          </label>
                        </div>
                        {!selectedAssignmentClientHasEmail && (
                          <p className="mt-2 text-xs text-[#8a6f5d]">
                            Courriel client absent : la notification client est
                            désactivée.
                          </p>
                        )}
                      </div>
                    )}
                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        className={buttonClass('secondary')}
                        onClick={() => {
                          setAssigningClientId(null)
                          setFormError('')
                        }}
                        disabled={savingAssignment}
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        className={buttonClass('primary')}
                        disabled={
                          savingAssignment ||
                          professionals.length === 0 ||
                          selectedProfessionalHasNoActiveRequest
                        }
                      >
                        {savingAssignment
                          ? 'Assignation...'
                          : 'Créer l’assignation'}
                      </button>
                    </div>
                  </form>
                </section>
              )}

              <section ref={waitingSectionRef} className="scroll-mt-6 space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-[#332820]">
                    Clients en attente ({waitingClients.length})
                  </h2>
                  <p className="mt-1 text-sm text-[#7a6859]">
                    Liste active des clients à assigner.
                  </p>
                </div>
                {renderClientsTable(
                  paginatedWaitingClients,
                  hasSearchQuery ? emptySearchMessage : 'Aucun client en attente.',
                  true
                )}
                {renderPagination({
                  totalCount: waitingClients.length,
                  currentPage: safeWaitingPage,
                  pageCount: waitingPageCount,
                  onPageChange: setWaitingPage,
                  sectionRef: waitingSectionRef,
                })}
              </section>

              <section ref={assignedSectionRef} className="scroll-mt-6 space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-[#332820]">
                    Clients assignés ({assignedClients.length})
                  </h2>
                  <p className="mt-1 text-sm text-[#7a6859]">
                    Clients déjà assignés à un professionnel.
                  </p>
                </div>
                {renderClientsTable(
                  paginatedAssignedClients,
                  hasSearchQuery ? emptySearchMessage : 'Aucun client assigné.',
                  false
                )}
                {renderPagination({
                  totalCount: assignedClients.length,
                  currentPage: safeAssignedPage,
                  pageCount: assignedPageCount,
                  onPageChange: setAssignedPage,
                  sectionRef: assignedSectionRef,
                })}
              </section>

              <section ref={historySectionRef} className="scroll-mt-6 space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-[#332820]">
                    Historique clients ({historyClients.length})
                  </h2>
                  <p className="mt-1 text-sm text-[#7a6859]">
                    Clients actifs, fermés ou inscrits en liste noire.
                  </p>
                </div>
                {renderClientsTable(
                  paginatedHistoryClients,
                  hasSearchQuery ? emptySearchMessage : 'Aucun client dans l’historique.',
                  false
                )}
                {renderPagination({
                  totalCount: historyClients.length,
                  currentPage: safeHistoryPage,
                  pageCount: historyPageCount,
                  onPageChange: setHistoryPage,
                  sectionRef: historySectionRef,
                  pageSize: HISTORY_CLIENTS_PER_PAGE,
                })}
              </section>

              <div className="hidden">
                <table className={`${tableClass} w-full`}>
                  <thead className={tableHeaderClass}>
                    <tr>
                      <th className={tableHeadCellClass}>Priorité</th>
                      <th className={tableHeadCellClass}>Statut</th>
                      <th className={tableHeadCellClass}>Service demandé</th>
                      <th className={tableHeadCellClass}>Client</th>
                      <th className={tableHeadCellClass}>Requérant</th>
                      <th className={tableHeadCellClass}>Date de naissance</th>
                      <th className={tableHeadCellClass}>Adresse complète</th>
                      <th className={tableHeadCellClass}>Modalité</th>
                      <th className={tableHeadCellClass}>Préférence horaire</th>
                      <th className={tableHeadCellClass}>Contact</th>
                      <th className={tableHeadCellClass}>Motif</th>
                      <th className={tableHeadCellClass}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className={tableBodyClass}>
                    {clients.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-4 py-8">
                          <EmptyState title="Aucun client en liste d’attente pour le moment." />
                        </td>
                      </tr>
                    ) : (
                      clients.map((client) => {
                        const isAlreadyAssigned = client.status === 'assigned'

                        return (
                        <tr
                          key={client.id}
                          className={`${tableRowClass} ${
                            isAlreadyAssigned ? 'bg-[#f7f2eb] opacity-80' : ''
                          }`}
                        >
                          <td className={tableCellClass}>
                            <Badge tone="warning">
                              {priorityLabels[client.priority_level ?? ''] ??
                                formatText(client.priority_level)}
                            </Badge>
                          </td>
                          <td className={tableCellClass}>
                            <div className="space-y-1">
                            <Badge tone={statusTones[client.status ?? ''] ?? 'muted'}>
                              {statusLabels[client.status ?? ''] ??
                                formatText(client.status)}
                            </Badge>
                            {isAlreadyAssigned && (
                              <p className="text-xs font-medium text-[#8a6f5d]">
                                Assignation faite
                              </p>
                            )}
                            </div>
                          </td>
                          <td className={tableCellClass}>
                            {formatText(client.service_requested)}
                          </td>
                          <td className={tableCellClass}>
                            {formatText(client.client_name)}
                          </td>
                          <td className={tableCellClass}>{formatRequester(client)}</td>
                          <td className={tableCellClass}>
                            {formatDate(client.birth_date)}
                          </td>
                          <td className={tableCellClass}>{formatText(client.city)}</td>
                          <td className={tableCellClass}>
                            {formatText(client.meeting_modality)}
                          </td>
                          <td className={tableCellClass}>
                            {formatText(client.availability)}
                          </td>
                          <td className={tableCellClass}>{renderContactInfo(client)}</td>
                          <td className="max-w-xs whitespace-pre-wrap break-words px-4 py-3 align-top text-[#6c5a4d]">
                            {formatText(client.consultation_reason)}
                            {renderInternalNotes(client)}
                          </td>
                          <td className={tableCellClass}>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <button
                                type="button"
                                className={buttonClass('primary')}
                                disabled={isAlreadyAssigned}
                                onClick={() => startAssigning(client)}
                              >
                                {isAlreadyAssigned ? 'Déjà assigné' : 'Assigner'}
                              </button>
                              <button
                                type="button"
                                className={buttonClass('secondary')}
                                onClick={() => startEditing(client)}
                              >
                                Modifier
                              </button>
                              {canUseSuperAdminActions && (
                                <button
                                  type="button"
                                  className={buttonClass('danger')}
                                  disabled={permanentlyDeletingClientId === client.id}
                                  onClick={() => handlePermanentDeleteClient(client)}
                                >
                                  {permanentlyDeletingClientId === client.id
                                    ? 'Suppression...'
                                    : 'Supprimer définitivement'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
