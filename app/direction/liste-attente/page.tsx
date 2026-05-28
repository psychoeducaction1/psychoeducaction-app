'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
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

type ActiveAssignmentRequest = {
  id: string
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  remaining_count: number | null
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
  consultation_reason: string
  internal_notes: string
}

const waitingListSelect =
  'id, created_at, contact_date, status, priority_level, service_requested, client_name, first_requester_name, second_requester_name, birth_date, city, meeting_modality, meeting_type, availability, contact_email, contact_phone, consultation_reason, internal_notes, assigned_professional_id, assigned_at'

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

function formatContact(client: WaitingListClient): string {
  return (
    [client.contact_email, client.contact_phone]
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
    contact_email: client.contact_email ?? '',
    contact_phone: client.contact_phone ?? '',
    consultation_reason: client.consultation_reason ?? '',
    internal_notes: client.internal_notes ?? '',
  }
}

function buildPayload(form: WaitingListForm) {
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
    contact_email: nullableText(form.contact_email),
    contact_phone: nullableText(form.contact_phone),
    consultation_reason: nullableText(form.consultation_reason),
    internal_notes: nullableText(form.internal_notes),
  }
}

export default function DirectionListeAttentePage() {
  const router = useRouter()
  const editSectionRef = useRef<HTMLElement | null>(null)
  const assignmentSectionRef = useRef<HTMLElement | null>(null)
  const [clients, setClients] = useState<WaitingListClient[]>([])
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
  const [formMessage, setFormMessage] = useState('')
  const [formError, setFormError] = useState('')

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
        .select('role')
        .eq('id', user.id)
        .limit(1)
        .maybeSingle()

      if (currentProfileError || currentProfile?.role !== 'direction') {
        router.push('/')
        return
      }

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

      setClients(sortClientsByContactDate((data ?? []) as WaitingListClient[]))

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
        const { data: requestsData, error: requestsError } = await supabase
          .from('assignment_requests')
          .select('id, professional_id, is_active, requested_count, remaining_count')
          .eq('is_active', true)
          .in('professional_id', professionalIds)
          .order('created_at', { ascending: false })

        if (requestsError) {
          setError(requestsError.message)
          setLoading(false)
          return
        }

        setActiveRequests((requestsData ?? []) as ActiveAssignmentRequest[])
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

  const updateFormField = (field: keyof WaitingListForm, value: string) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
  }

  const updateEditFormField = (field: keyof WaitingListForm, value: string) => {
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

  const handleDeleteClient = async (client: WaitingListClient) => {
    const confirmed = window.confirm(
      'Êtes-vous sûr de vouloir supprimer ce client de la liste d’attente ? Cette action ne touchera pas aux autres données.'
    )

    if (!confirmed) return

    setFormMessage('')
    setFormError('')

    const { error: deleteError } = await supabase
      .from('waiting_list_clients')
      .delete()
      .eq('id', client.id)

    if (deleteError) {
      setFormError(deleteError.message)
      return
    }

    setClients((currentClients) =>
      currentClients.filter((currentClient) => currentClient.id !== client.id)
    )

    if (editingClientId === client.id) {
      setEditingClientId(null)
      setEditForm(emptyWaitingListForm)
    }

    setFormMessage('Client supprimé de la liste d’attente.')
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
        request.is_active === true &&
        (request.remaining_count ?? 0) > 0
    )

    if (!assignmentRequest) {
      setFormError(
        'Ce professionnel n’a aucune demande active avec place restante.'
      )
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

    const { error: insertError } = await supabase.from('assigned_clients').insert({
      assignment_request_id: assignmentRequest.id,
      professional_id: selectedProfessionalId,
      first_name: firstName,
      last_name: lastName,
      email: nullableText(client.contact_email ?? ''),
      phone: nullableText(client.contact_phone ?? ''),
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

    if (insertError) {
      setSavingAssignment(false)
      setFormError(insertError.message)
      return
    }

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
    setFormMessage('Client assigné au professionnel avec succès.')
  }

  const inputClass =
    'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition duration-200 placeholder:text-[#b09c8a] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

  const waitingClients = sortWaitingClients(
    clients.filter((client) => client.status === 'waiting')
  )
  const assignedClients = clients.filter((client) => client.status === 'assigned')
  const historyClients = clients.filter((client) =>
    ['active', 'closed', 'blacklisted'].includes(client.status ?? '')
  )

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
            <th className={`${tableHeadCellClass} w-32`}>Actions</th>
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
                  <td className={tableCellClass}>
                    <Badge tone={priorityTones[client.priority_level ?? ''] ?? 'muted'}>
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
                    {formatDate(client.contact_date ?? client.created_at)}
                  </td>
                  <td className={tableCellClass}>
                    {formatText(client.service_requested)}
                  </td>
                  <td className={tableCellClass}>
                    {formatText(client.client_name)}
                  </td>
                  <td className={tableCellClass}>{formatRequester(client)}</td>
                  <td className={tableCellClass}>{formatDate(client.birth_date)}</td>
                  <td className={tableCellClass}>{formatText(client.city)}</td>
                  <td className={tableCellClass}>
                    {formatText(client.meeting_modality)}
                  </td>
                  <td className={tableCellClass}>
                    {formatText(client.availability)}
                  </td>
                  <td className={tableCellClass}>{formatContact(client)}</td>
                  <td className="min-w-[24rem] whitespace-pre-wrap break-words px-4 py-3 align-top text-[#6c5a4d]">
                    {formatText(client.consultation_reason)}
                  </td>
                  <td className={`${tableCellClass} w-32`}>
                    <div className="flex w-28 flex-col gap-2">
                      {allowAssignment && (
                        <button
                          type="button"
                          className={`${buttonClass('primary')} !w-full justify-center whitespace-nowrap`}
                          onClick={() => startAssigning(client)}
                        >
                          Assigner
                        </button>
                      )}
                      {!allowAssignment && isAlreadyAssigned && (
                        <button
                          type="button"
                          className={`${buttonClass('secondary')} !w-full justify-center whitespace-nowrap`}
                          disabled
                        >
                          Déjà assigné
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${buttonClass('secondary')} !w-full justify-center whitespace-nowrap`}
                        onClick={() => startEditing(client)}
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        className={`${buttonClass('danger')} !w-full justify-center whitespace-nowrap`}
                        onClick={() => handleDeleteClient(client)}
                      >
                        Supprimer
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
  )

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
    onChange: (field: keyof WaitingListForm, value: string) => void
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    submitLabel: string
    saving: boolean
    showStatus: boolean
    onCancel: () => void
  }) => (
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
        <label className="text-sm font-medium text-[#5d4a3d]">
          Courriel
          <input
            type="email"
            value={currentForm.contact_email}
            onChange={(event) => onChange('contact_email', event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-sm font-medium text-[#5d4a3d]">
          Téléphone
          <input
            value={currentForm.contact_phone}
            onChange={(event) => onChange('contact_phone', event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
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
                      Choisissez un professionnel actif avec une demande ouverte.
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
                        disabled={savingAssignment || professionals.length === 0}
                      >
                        {savingAssignment ? 'Assignation...' : 'Confirmer l’assignation'}
                      </button>
                    </div>
                  </form>
                </section>
              )}

              <section className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-[#332820]">
                    Clients en attente
                  </h2>
                  <p className="mt-1 text-sm text-[#7a6859]">
                    Liste active des clients à assigner.
                  </p>
                </div>
                {renderClientsTable(waitingClients, 'Aucun client en attente.', true)}
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-[#332820]">
                    Clients assignés
                  </h2>
                  <p className="mt-1 text-sm text-[#7a6859]">
                    Clients déjà assignés à un professionnel.
                  </p>
                </div>
                {renderClientsTable(assignedClients, 'Aucun client assigné.', false)}
              </section>

              <section className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-[#332820]">
                    Historique clients
                  </h2>
                  <p className="mt-1 text-sm text-[#7a6859]">
                    Clients actifs, fermés ou inscrits en liste noire.
                  </p>
                </div>
                {renderClientsTable(
                  historyClients,
                  'Aucun client dans l’historique.',
                  false
                )}
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
                          <td className={tableCellClass}>{formatContact(client)}</td>
                          <td className="max-w-xs whitespace-pre-wrap break-words px-4 py-3 align-top text-[#6c5a4d]">
                            {formatText(client.consultation_reason)}
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
                              <button
                                type="button"
                                className={buttonClass('danger')}
                                onClick={() => handleDeleteClient(client)}
                              >
                                Supprimer
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
            </div>
          )}
        </div>
      </main>
    </>
  )
}
