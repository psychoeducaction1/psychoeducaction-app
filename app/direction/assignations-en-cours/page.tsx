'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { Badge, buttonClass, EmptyState } from '@/components/ui/index'
import { logAudit } from '@/app/professionnel/shared'
import { supabase } from '@/lib/supabaseClient'
import { createAssignmentFromWaitingListClient } from '@/lib/waitingListAssignment'

type ProcessStatus =
  | 'to_contact'
  | 'voicemail_left'
  | 'text_sent'
  | 'email_sent'
  | 'text_email_sent'
  | 'contacted_waiting_response'
  | 'interested'
  | 'client_refusal'
  | 'no_response'
  | 'assigned'
  | 'classified'
  | 'returned'

type AssignmentProcess = {
  id: string
  waiting_list_client_id: string
  status: ProcessStatus
  prospective_professional_id: string | null
  responsible_profile_id: string | null
  started_at: string
  assigned_at: string | null
  classified_at: string | null
  returned_at: string | null
  classification_reason: string | null
  classification_details: string | null
  created_at: string
  updated_at: string
}

type WaitingListClient = {
  id: string
  created_at: string | null
  contact_date: string | null
  client_name: string | null
  first_requester_name: string | null
  second_requester_name: string | null
  birth_date: string | null
  city: string | null
  meeting_modality: string[] | string | null
  availability: string | null
  contact_email: string | null
  contact_phone: string | null
  contact_emails: string[] | null
  contact_phones: string[] | null
  consultation_reason: string | null
  internal_notes: string | null
}

type Profile = {
  id: string
  full_name: string | null
  email: string | null
  role: string | null
}

type ProcessEvent = {
  id: string
  assignment_process_id: string
  event_type: string
  status: string | null
  contact_method: string | null
  note: string | null
  actor_profile_id: string | null
  actor_name: string | null
  created_at: string
}

type Actor = { id: string; role: string | null; name: string | null }

type ContactForm = {
  occurredAt: string
  method: 'call' | 'voicemail' | 'text' | 'email'
  note: string
}

const activeStatuses: ProcessStatus[] = [
  'to_contact',
  'voicemail_left',
  'text_sent',
  'email_sent',
  'text_email_sent',
  'contacted_waiting_response',
  'interested',
  'client_refusal',
  'no_response',
]

const statusLabels: Record<ProcessStatus, string> = {
  to_contact: 'Non contacté',
  voicemail_left: 'Aucune réponse (message vocal laissé)',
  text_sent: 'Texto envoyé',
  email_sent: 'Courriel envoyé',
  text_email_sent: 'Texto et courriel envoyés',
  contacted_waiting_response: 'Autre',
  interested: 'Autre',
  client_refusal: 'Refus du client',
  no_response: 'Aucune réponse (message vocal laissé)',
  assigned: 'Assigné',
  classified: 'Classé',
  returned: 'Retourné en liste d’attente',
}

const statusTones: Record<ProcessStatus, 'neutral' | 'warning' | 'success' | 'danger' | 'muted'> = {
  to_contact: 'warning',
  voicemail_left: 'neutral',
  text_sent: 'neutral',
  email_sent: 'neutral',
  text_email_sent: 'success',
  contacted_waiting_response: 'warning',
  interested: 'success',
  client_refusal: 'danger',
  no_response: 'danger',
  assigned: 'success',
  classified: 'muted',
  returned: 'muted',
}

const contactMethodLabels: Record<string, string> = {
  call: 'Appel',
  voicemail: 'Message vocal',
  text: 'Texto',
  email: 'Courriel',
}

const editableStatuses: ProcessStatus[] = [
  'to_contact',
  'contacted_waiting_response',
  'client_refusal',
  'no_response',
]

const inputClass =
  'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const hasTime = value.includes('T')
  const date = new Date(hasTime ? value : `${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(
    'fr-CA',
    hasTime
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : { dateStyle: 'medium' }
  ).format(date)
}

function calculateAge(value: string | null) {
  if (!value) return null
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  const today = new Date()
  let age = today.getFullYear() - year
  if (
    today.getMonth() < month - 1 ||
    (today.getMonth() === month - 1 && today.getDate() < day)
  ) {
    age -= 1
  }
  return age >= 0 ? age : null
}

function formatBirthDate(value: string | null) {
  if (!value) return '-'
  const age = calculateAge(value)
  return `${value.slice(0, 10)}${age === null ? '' : ` (${age} ans)`}`
}

function normalizeList(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])
  )
}

function getLocalDateTimeValue() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 16)
}

export default function AssignmentProcessesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [processes, setProcesses] = useState<AssignmentProcess[]>([])
  const [clients, setClients] = useState<WaitingListClient[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [events, setEvents] = useState<ProcessEvent[]>([])
  const [actor, setActor] = useState<Actor | null>(null)
  const [view, setView] = useState<'active' | 'history'>('active')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [professionalFilter, setProfessionalFilter] = useState('all')
  const [responsibleFilter, setResponsibleFilter] = useState('all')
  const [startedDateFilter, setStartedDateFilter] = useState('')
  const [followUpOnly, setFollowUpOnly] = useState(false)
  const [busyProcessId, setBusyProcessId] = useState('')
  const [contactProcessId, setContactProcessId] = useState('')
  const [contactForm, setContactForm] = useState<ContactForm>({
    occurredAt: getLocalDateTimeValue(),
    method: 'call',
    note: '',
  })
  const [otherStatusProcessId, setOtherStatusProcessId] = useState('')
  const [otherStatusDetails, setOtherStatusDetails] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: currentProfile } = await supabase
      .from('profiles')
      .select('id, role, full_name, email')
      .eq('id', user.id)
      .limit(1)
      .maybeSingle()

    if (currentProfile?.role !== 'direction') {
      router.push('/')
      return
    }

    setActor({
      id: user.id,
      role: currentProfile.role,
      name: currentProfile.full_name ?? currentProfile.email ?? null,
    })

    const [processResponse, profileResponse] = await Promise.all([
      supabase.from('assignment_processes').select('*').order('started_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .in('role', ['direction', 'professionnel'])
        .eq('is_active', true)
        .order('full_name'),
    ])

    if (processResponse.error || profileResponse.error) {
      setError(processResponse.error?.message ?? profileResponse.error?.message ?? '')
      setLoading(false)
      return
    }

    const loadedProcesses = (processResponse.data ?? []) as AssignmentProcess[]
    const clientIds = Array.from(
      new Set(loadedProcesses.map((process) => process.waiting_list_client_id))
    )
    const processIds = loadedProcesses.map((process) => process.id)

    const [clientResponse, eventResponse] = await Promise.all([
      clientIds.length
        ? supabase
            .from('waiting_list_clients')
            .select(
              'id, created_at, contact_date, client_name, first_requester_name, second_requester_name, birth_date, city, meeting_modality, availability, contact_email, contact_phone, contact_emails, contact_phones, consultation_reason, internal_notes'
            )
            .in('id', clientIds)
        : Promise.resolve({ data: [], error: null }),
      processIds.length
        ? supabase
            .from('assignment_process_events')
            .select('*')
            .in('assignment_process_id', processIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])

    if (clientResponse.error || eventResponse.error) {
      setError(clientResponse.error?.message ?? eventResponse.error?.message ?? '')
      setLoading(false)
      return
    }

    setProcesses(loadedProcesses)
    setProfiles((profileResponse.data ?? []) as Profile[])
    setClients((clientResponse.data ?? []) as WaitingListClient[])
    setEvents((eventResponse.data ?? []) as ProcessEvent[])
    setLoading(false)
  }, [router])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients]
  )
  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  )
  const professionals = profiles.filter((profile) => profile.role === 'professionnel')
  const directionMembers = profiles.filter((profile) => profile.role === 'direction')
  const filteredProcesses = processes.filter((process) => {
    const isActive = activeStatuses.includes(process.status)
    if (view === 'active' ? !isActive : isActive) return false
    const client = clientsById.get(process.waiting_list_client_id)
    if (
      search.trim() &&
      !client?.client_name?.toLowerCase().includes(search.trim().toLowerCase())
    ) return false
    if (statusFilter !== 'all' && process.status !== statusFilter) return false
    if (
      professionalFilter !== 'all' &&
      process.prospective_professional_id !== professionalFilter
    ) return false
    if (
      responsibleFilter !== 'all' &&
      process.responsible_profile_id !== responsibleFilter
    ) return false
    if (startedDateFilter && process.started_at.slice(0, 10) !== startedDateFilter) return false
    if (followUpOnly) {
      const firstContact = events
        .filter(
          (event) =>
            event.assignment_process_id === process.id &&
            event.event_type === 'contact_attempt'
        )
        .map((event) => new Date(event.created_at).getTime())
        .filter(Number.isFinite)
        .sort((left, right) => left - right)[0]
      if (!firstContact || Date.now() < firstContact + 48 * 60 * 60 * 1000) return false
    }
    return true
  })

  const insertEvent = async (
    processId: string,
    values: Partial<ProcessEvent> & { event_type: string }
  ) => {
    const { data, error: eventError } = await supabase
      .from('assignment_process_events')
      .insert({
        assignment_process_id: processId,
        event_type: values.event_type,
        status: values.status ?? null,
        contact_method: values.contact_method ?? null,
        note: values.note?.trim() || null,
        actor_profile_id: actor?.id ?? null,
        actor_name: actor?.name ?? null,
        created_at: values.created_at ?? new Date().toISOString(),
      })
      .select('*')
      .limit(1)
      .maybeSingle()

    if (eventError) throw eventError
    if (data) setEvents((current) => [data as ProcessEvent, ...current])
  }

  const ensureFollowUpTask = async (
    process: AssignmentProcess,
    firstAttemptAt: string
  ) => {
    try {
      const { data: existingTask, error: existingError } = await supabase
        .from('administrative_tasks')
        .select('id')
        .eq('source_type', 'assignment_process_follow_up')
        .eq('source_id', process.id)
        .neq('status', 'canceled')
        .limit(1)
        .maybeSingle()
      if (existingError) throw existingError
      if (existingTask) return

      const client = clientsById.get(process.waiting_list_client_id)
      const dueAt = new Date(
        new Date(firstAttemptAt).getTime() + 48 * 60 * 60 * 1000
      ).toISOString()
      const { data: task, error: taskError } = await supabase
        .from('administrative_tasks')
        .insert({
          title: `Relancer ${client?.client_name ?? 'un client'}`,
          description:
            'Vérifier si le client a répondu depuis la première tentative de contact. Aucun nouveau texto ou courriel ne doit être envoyé automatiquement.',
          assigned_to: 'both',
          status: 'pending',
          due_at: dueAt,
          source_type: 'assignment_process_follow_up',
          source_id: process.id,
          created_by: actor?.id ?? null,
        })
        .select('id')
        .limit(1)
        .maybeSingle()
      if (taskError) throw taskError
      if (!task?.id) return

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return
      const notificationResponse = await fetch(
        '/api/direction/administrative-task-notification',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ taskId: task.id }),
        }
      )
      if (!notificationResponse.ok) {
        console.error('[administrative-task-notification] Notification non envoyée.')
      }
    } catch (taskError) {
      console.error('[assignment-process-follow-up] Tâche non créée:', taskError)
    }
  }

  const closeFollowUpTask = async (
    processId: string,
    status: 'completed' | 'canceled' = 'completed'
  ) => {
    const completedAt = status === 'completed' ? new Date().toISOString() : null
    const { error: taskError } = await supabase
      .from('administrative_tasks')
      .update({ status, completed_at: completedAt })
      .eq('source_type', 'assignment_process_follow_up')
      .eq('source_id', processId)
      .in('status', ['pending', 'in_progress'])
    if (taskError) {
      console.error('[assignment-process-follow-up] Tâche non fermée:', taskError)
    }
  }

  const refuseClient = async (process: AssignmentProcess) => {
    const client = clientsById.get(process.waiting_list_client_id)
    if (!window.confirm(`Classer ${client?.client_name ?? 'ce client'} comme refus du client ?`)) return

    setBusyProcessId(process.id)
    setError('')
    const classifiedAt = new Date().toISOString()
    try {
      const { error: processError } = await supabase
        .from('assignment_processes')
        .update({
          status: 'classified',
          classified_at: classifiedAt,
          classification_reason: 'Refus du client',
          classification_details: null,
        })
        .eq('id', process.id)
      if (processError) throw processError

      const { error: clientError } = await supabase
        .from('waiting_list_clients')
        .update({ status: 'closed' })
        .eq('id', process.waiting_list_client_id)
      if (clientError) throw clientError

      await insertEvent(process.id, {
        event_type: 'classified',
        status: 'classified',
        note: 'Refus du client.',
      })
      await closeFollowUpTask(process.id)
      setProcesses((current) => current.map((item) =>
        item.id === process.id
          ? {
              ...item,
              status: 'classified',
              classified_at: classifiedAt,
              classification_reason: 'Refus du client',
              classification_details: null,
            }
          : item
      ))
      setMessage('Le refus du client a été classé sans créer d’assignation.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Classement impossible.')
    } finally {
      setBusyProcessId('')
    }
  }

  const updateProcessStatus = async (
    process: AssignmentProcess,
    status: ProcessStatus,
    details = ''
  ) => {
    if (status === 'client_refusal') {
      await refuseClient(process)
      return
    }
    if (status === 'contacted_waiting_response' && !details.trim()) {
      setOtherStatusProcessId(process.id)
      setOtherStatusDetails('')
      return
    }
    setBusyProcessId(process.id)
    setError('')
    const { error: updateError } = await supabase
      .from('assignment_processes')
      .update({ status })
      .eq('id', process.id)

    if (updateError) {
      setError(updateError.message)
      setBusyProcessId('')
      return
    }

    try {
      await insertEvent(process.id, {
        event_type: 'status_changed',
        status,
        note: details.trim()
          ? `Statut modifié : ${statusLabels[process.status]} → Autre. Précision : ${details.trim()}`
          : `Statut modifié : ${statusLabels[process.status]} → ${statusLabels[status]}.`,
      })
    } catch (eventError) {
      setError(eventError instanceof Error ? eventError.message : 'Historique non enregistré.')
    }

    setProcesses((current) =>
      current.map((item) => item.id === process.id ? { ...item, status } : item)
    )
    setOtherStatusProcessId('')
    setOtherStatusDetails('')
    setBusyProcessId('')
  }

  const updateProspectiveProfessional = async (
    process: AssignmentProcess,
    professionalId: string
  ) => {
    setBusyProcessId(process.id)
    const { error: updateError } = await supabase
      .from('assignment_processes')
      .update({ prospective_professional_id: professionalId || null })
      .eq('id', process.id)

    if (updateError) {
      setError(updateError.message)
      setBusyProcessId('')
      return
    }

    setProcesses((current) => current.map((item) =>
      item.id === process.id
        ? { ...item, prospective_professional_id: professionalId || null }
        : item
    ))
    await insertEvent(process.id, {
      event_type: 'professional_selected',
      note: professionalId
        ? `Professionnel envisagé : ${profilesById.get(professionalId)?.full_name ?? 'Professionnel'}.`
        : 'Professionnel envisagé retiré.',
    })
    setBusyProcessId('')
  }

  const saveContactAttempt = async (process: AssignmentProcess) => {
    if (!contactForm.note.trim()) {
      setError('Ajoutez une courte note sur la tentative de contact.')
      return
    }

    const occurredAt = new Date(contactForm.occurredAt)
    if (Number.isNaN(occurredAt.getTime())) {
      setError('Indiquez une date et une heure valides pour la tentative de contact.')
      return
    }

    setBusyProcessId(process.id)
    const nextStatus: ProcessStatus =
      contactForm.method === 'voicemail'
        ? 'no_response'
        : contactForm.method === 'text'
          ? 'text_sent'
          : 'contacted_waiting_response'

    try {
      await insertEvent(process.id, {
        event_type: 'contact_attempt',
        status: nextStatus,
        contact_method: contactForm.method,
        note: contactForm.note,
        created_at: occurredAt.toISOString(),
      })
      const { error: updateError } = await supabase
        .from('assignment_processes')
        .update({ status: nextStatus })
        .eq('id', process.id)
      if (updateError) throw updateError

      setProcesses((current) => current.map((item) =>
        item.id === process.id ? { ...item, status: nextStatus } : item
      ))
      await ensureFollowUpTask(process, occurredAt.toISOString())
      setContactProcessId('')
      setContactForm({ occurredAt: getLocalDateTimeValue(), method: 'call', note: '' })
      setMessage('Tentative de contact enregistrée.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Enregistrement impossible.')
    } finally {
      setBusyProcessId('')
    }
  }

  const markTextAsSent = async (process: AssignmentProcess) => {
    if (!['no_response', 'voicemail_left', 'email_sent', 'text_sent', 'text_email_sent'].includes(process.status)) {
      setError('Sélectionnez d’abord le statut « Aucune réponse ».')
      return
    }
    const client = clientsById.get(process.waiting_list_client_id)
    if (
      !window.confirm(
        `Confirmer qu'un texto a été envoyé manuellement à ${client?.client_name ?? 'ce client'} ?`
      )
    ) return

    setBusyProcessId(process.id)
    setError('')

    try {
      const emailAlreadySent = events.some(
        (event) =>
          event.assignment_process_id === process.id &&
          event.event_type === 'contact_attempt' &&
          event.contact_method === 'email'
      )
      const nextStatus: ProcessStatus = emailAlreadySent
        ? 'text_email_sent'
        : 'text_sent'
      const { error: updateError } = await supabase
        .from('assignment_processes')
        .update({ status: nextStatus })
        .eq('id', process.id)
      if (updateError) throw updateError

      await insertEvent(process.id, {
        event_type: 'contact_attempt',
        status: nextStatus,
        contact_method: 'text',
        note: 'Texto envoyé manuellement depuis le numéro de la clinique.',
      })

      setProcesses((current) => current.map((item) =>
        item.id === process.id ? { ...item, status: nextStatus } : item
      ))
      await ensureFollowUpTask(process, new Date().toISOString())
      setMessage('L’envoi manuel du texto a été enregistré.')
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Impossible d’enregistrer l’envoi du texto.'
      )
    } finally {
      setBusyProcessId('')
    }
  }

  const sendClientContactEmail = async (process: AssignmentProcess) => {
    const client = clientsById.get(process.waiting_list_client_id)
    if (!window.confirm(`Envoyer le courriel de tentative de contact à ${client?.client_name ?? 'ce client'} ?`)) return

    setBusyProcessId(process.id)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Session expirée. Veuillez vous reconnecter.')
      const response = await fetch('/api/direction/assignment-process-client-email', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ assignmentProcessId: process.id }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; recipient?: string; status?: ProcessStatus; sentAt?: string }
        | null
      if (!response.ok) throw new Error(payload?.error ?? 'Envoi du courriel impossible.')

      await ensureFollowUpTask(process, payload?.sentAt ?? new Date().toISOString())
      await loadData()
      setMessage(`Courriel envoyé à ${payload?.recipient ?? 'l’adresse du client'}.`)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Envoi impossible.')
    } finally {
      setBusyProcessId('')
    }
  }

  const assignClient = async (process: AssignmentProcess) => {
    const client = clientsById.get(process.waiting_list_client_id)
    if (!client || !process.prospective_professional_id) {
      setError('Sélectionnez un professionnel avant de créer l’assignation.')
      return
    }

    if (!window.confirm(`Confirmer que ${client.client_name ?? 'ce client'} prendra le service avec le professionnel sélectionné ? L’assignation sera créée directement comme service pris.`)) return
    setBusyProcessId(process.id)
    setError('')

    try {
      const result = await createAssignmentFromWaitingListClient({
        supabase,
        client,
        professionalId: process.prospective_professional_id,
        outcome: 'service_taken',
      })
      const assignedAt = new Date().toISOString()
      const { error: processError } = await supabase
        .from('assignment_processes')
        .update({ status: 'assigned', assigned_at: assignedAt })
        .eq('id', process.id)
      if (processError) throw processError

      await insertEvent(process.id, {
        event_type: 'assigned',
        status: 'assigned',
        note: `Client assigné à ${profilesById.get(process.prospective_professional_id)?.full_name ?? 'un professionnel'}.`,
      })
      await closeFollowUpTask(process.id)
      setProcesses((current) => current.map((item) =>
        item.id === process.id
          ? { ...item, status: 'assigned', assigned_at: assignedAt }
          : item
      ))
      setMessage('Service pris confirmé. La demande du professionnel a été recalculée.')

      if (actor) void logAudit({
        supabase,
        actor,
        action: 'assignment_created',
        entityType: 'assigned_client',
        entityId: result.assignedClientId,
        description: `Service pris confirmé pour ${client.client_name ?? 'un client'} depuis les assignations en cours.`,
        metadata: {
          assignment_process_id: process.id,
          waiting_list_client_id: client.id,
          professional_id: process.prospective_professional_id,
          assignment_request_id: result.assignmentRequest.id,
          client_name: client.client_name,
          professional_name: profilesById.get(process.prospective_professional_id)?.full_name ?? null,
          contacted: true,
          is_active: true,
        },
      })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Assignation impossible.')
    } finally {
      setBusyProcessId('')
    }
  }

  const reopenRefusedProcess = async (process: AssignmentProcess) => {
    const client = clientsById.get(process.waiting_list_client_id)
    if (
      !window.confirm(
        `Reprendre la démarche active pour ${client?.client_name ?? 'ce client'} ? L’historique actuel sera conservé.`
      )
    ) return

    setBusyProcessId(process.id)
    setError('')
    try {
      const { data: clientProcesses, error: processListError } = await supabase
        .from('assignment_processes')
        .select('id, status')
        .eq('waiting_list_client_id', process.waiting_list_client_id)
      if (processListError) throw processListError

      const otherActiveProcess = (clientProcesses ?? []).find(
        (item) => item.id !== process.id && activeStatuses.includes(item.status as ProcessStatus)
      )
      if (otherActiveProcess) {
        throw new Error('Une autre démarche active existe déjà pour ce client.')
      }

      const { error: reopenError } = await supabase
        .from('assignment_processes')
        .update({
          status: 'to_contact',
          classified_at: null,
          classification_reason: null,
          classification_details: null,
        })
        .eq('id', process.id)
      if (reopenError) throw reopenError

      const { error: waitingListError } = await supabase
        .from('waiting_list_clients')
        .update({ status: 'assignment_in_progress' })
        .eq('id', process.waiting_list_client_id)
      if (waitingListError) {
        await supabase
          .from('assignment_processes')
          .update({
            status: 'classified',
            classified_at: process.classified_at,
            classification_reason: process.classification_reason,
            classification_details: process.classification_details,
          })
          .eq('id', process.id)
        throw waitingListError
      }

      await supabase
        .from('administrative_tasks')
        .update({ status: 'canceled', completed_at: null })
        .eq('source_type', 'assignment_process_follow_up')
        .eq('source_id', process.id)
        .neq('status', 'canceled')

      await insertEvent(process.id, {
        event_type: 'status_changed',
        status: 'to_contact',
        note: 'Démarche reprise après un refus du client. Historique conservé.',
      })
      setProcesses((current) => current.map((item) =>
        item.id === process.id
          ? {
              ...item,
              status: 'to_contact',
              classified_at: null,
              classification_reason: null,
              classification_details: null,
            }
          : item
      ))
      setView('active')
      setMessage('La démarche est de nouveau active.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Réactivation impossible.')
    } finally {
      setBusyProcessId('')
    }
  }

  const returnToWaitingList = async (process: AssignmentProcess) => {
    const client = clientsById.get(process.waiting_list_client_id)
    if (!window.confirm(`Retourner ${client?.client_name ?? 'ce client'} dans la liste d’attente ?`)) return

    setBusyProcessId(process.id)
    const returnedAt = new Date().toISOString()
    const { error: clientError } = await supabase
      .from('waiting_list_clients')
      .update({ status: 'waiting', assigned_professional_id: null, assigned_at: null })
      .eq('id', process.waiting_list_client_id)
    if (clientError) {
      setError(clientError.message)
      setBusyProcessId('')
      return
    }

    const { error: processError } = await supabase
      .from('assignment_processes')
      .update({ status: 'returned', returned_at: returnedAt })
      .eq('id', process.id)
    if (processError) {
      setError(processError.message)
      setBusyProcessId('')
      return
    }

    await insertEvent(process.id, {
      event_type: 'returned_to_waiting_list',
      status: 'returned',
      note: 'Client retourné dans la liste d’attente; ancienneté initiale conservée.',
    })
    await closeFollowUpTask(process.id, 'canceled')
    setProcesses((current) => current.map((item) =>
      item.id === process.id ? { ...item, status: 'returned', returned_at: returnedAt } : item
    ))
    setBusyProcessId('')
    setMessage('Client retourné dans la liste d’attente.')
  }

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl space-y-6">
          <header>
            <p className="text-xs font-semibold uppercase text-[#9b6a3d]">Direction</p>
            <h1 className="mt-2 text-3xl font-semibold text-[#2d211a]">Assignations en cours</h1>
            <p className="mt-2 text-sm text-[#7a6859]">
              Suivi des clients contactés afin de finaliser une assignation.
            </p>
          </header>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {message && <div className="rounded-xl border border-[#d8e2c7] bg-[#f6faef] p-4 text-sm text-[#3f4f2d]">{message}</div>}

          <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setView('active')} className={buttonClass(view === 'active' ? 'primary' : 'secondary')}>
                Démarches actives
              </button>
              <button type="button" onClick={() => setView('history')} className={buttonClass(view === 'history' ? 'primary' : 'secondary')}>
                Historique
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="text-sm font-medium text-[#5d4a3d]">Recherche par nom
                <input value={search} onChange={(event) => setSearch(event.target.value)} className={`${inputClass} mt-2`} placeholder="Nom du client" />
              </label>
              <label className="text-sm font-medium text-[#5d4a3d]">Statut
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${inputClass} mt-2`}>
                  <option value="all">Tous les statuts</option>
                  {(view === 'active' ? activeStatuses : ['assigned', 'classified', 'returned'] as ProcessStatus[]).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[#5d4a3d]">Professionnel envisagé
                <select value={professionalFilter} onChange={(event) => setProfessionalFilter(event.target.value)} className={`${inputClass} mt-2`}>
                  <option value="all">Tous</option>
                  {professionals.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name ?? profile.email}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[#5d4a3d]">Responsable
                <select value={responsibleFilter} onChange={(event) => setResponsibleFilter(event.target.value)} className={`${inputClass} mt-2`}>
                  <option value="all">Tous</option>
                  {directionMembers.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name ?? profile.email}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[#5d4a3d]">Début de la démarche
                <input type="date" value={startedDateFilter} onChange={(event) => setStartedDateFilter(event.target.value)} className={`${inputClass} mt-2`} />
              </label>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm text-[#5d4a3d]">
              <input type="checkbox" checked={followUpOnly} onChange={(event) => setFollowUpOnly(event.target.checked)} className="h-4 w-4 accent-[#8a5633]" />
              Afficher seulement les clients sans réponse ou nécessitant une relance
            </label>
          </section>

          {loading ? (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">Chargement...</div>
          ) : filteredProcesses.length === 0 ? (
            <EmptyState title={view === 'active' ? 'Aucune démarche active.' : 'Aucun dossier dans l’historique.'} />
          ) : (
            <section className="space-y-4">
              {filteredProcesses.map((process) => {
                const client = clientsById.get(process.waiting_list_client_id)
                const processEvents = events.filter((event) => event.assignment_process_id === process.id)
                const emails = client ? normalizeList([client.contact_email, ...(client.contact_emails ?? [])]) : []
                const phones = client ? normalizeList([client.contact_phone, ...(client.contact_phones ?? [])]) : []
                const isActive = activeStatuses.includes(process.status)
                const textEvent = processEvents.find(
                  (event) => event.event_type === 'contact_attempt' && event.contact_method === 'text'
                )
                const emailEvent = processEvents.find(
                  (event) => event.event_type === 'contact_attempt' && event.contact_method === 'email'
                )
                const firstContactEvent = [...processEvents]
                  .filter((event) => event.event_type === 'contact_attempt')
                  .sort(
                    (left, right) =>
                      new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
                  )[0]
                const followUpAt = firstContactEvent
                  ? new Date(
                      new Date(firstContactEvent.created_at).getTime() +
                        48 * 60 * 60 * 1000
                    )
                  : null
                const followUpDue = Boolean(
                  followUpAt && followUpAt.getTime() <= Date.now() && isActive
                )
                const isRefusedHistory =
                  !isActive &&
                  process.status === 'classified' &&
                  process.classification_reason === 'Refus du client'
                const canSendFollowUpMessages = [
                  'no_response',
                  'voicemail_left',
                  'text_sent',
                  'email_sent',
                  'text_email_sent',
                ].includes(process.status)

                return (
                  <article key={process.id} className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold text-[#332820]">{client?.client_name ?? 'Client introuvable'}</h2>
                          <Badge tone={statusTones[process.status]}>{statusLabels[process.status]}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-[#7a6859]">
                          Début de la démarche : {formatDateTime(process.started_at)}
                        </p>
                      </div>
                      <p className="text-sm text-[#7a6859]">Responsable : {profilesById.get(process.responsible_profile_id ?? '')?.full_name ?? 'Non défini'}</p>
                    </div>

                    <dl className="mt-5 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-5">
                      <div><dt className="font-semibold text-[#8a6f5d]">Date de naissance</dt><dd className="mt-1 text-[#332820]">{formatBirthDate(client?.birth_date ?? null)}</dd></div>
                      <div><dt className="font-semibold text-[#8a6f5d]">Coordonnées</dt><dd className="mt-1 text-[#332820]">{emails.join(', ') || '-'}<br />{phones.join(', ') || '-'}</dd></div>
                      <div><dt className="font-semibold text-[#8a6f5d]">Disponibilités</dt><dd className="mt-1 whitespace-pre-wrap text-[#332820]">{client?.availability || '-'}</dd></div>
                      <div><dt className="font-semibold text-[#8a6f5d]">Modalités / contraintes</dt><dd className="mt-1 text-[#332820]">{Array.isArray(client?.meeting_modality) ? client.meeting_modality.join(', ') : client?.meeting_modality || '-'}<br />{client?.city || '-'}</dd></div>
                      <div><dt className="font-semibold text-[#8a6f5d]">Requérant</dt><dd className="mt-1 text-[#332820]">{normalizeList([client?.first_requester_name, client?.second_requester_name]).join(' / ') || '-'}</dd></div>
                    </dl>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div><p className="text-sm font-semibold text-[#8a6f5d]">Motif de consultation</p><p className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">{client?.consultation_reason || '-'}</p></div>
                      <div><p className="text-sm font-semibold text-[#8a6f5d]">Notes internes</p><p className="mt-1 whitespace-pre-wrap text-sm text-[#332820]">{client?.internal_notes || '-'}</p></div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      <div className="flex flex-col gap-3 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-[#5d4a3d]">Texto au client</p>
                          <p className="mt-1 text-sm text-[#7a6859]">
                            {textEvent
                              ? `Oui, envoyé le ${formatDateTime(textEvent.created_at)} par ${textEvent.actor_name ?? 'la direction'}.`
                              : 'Non, aucun texto envoyé pour le moment.'}
                          </p>
                        </div>
                        {isActive && !textEvent && (
                          <button type="button" disabled={busyProcessId === process.id || !canSendFollowUpMessages} onClick={() => void markTextAsSent(process)} className={buttonClass('secondary')}>
                            Marquer envoyé
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col gap-3 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-[#5d4a3d]">Courriel au client</p>
                          <p className="mt-1 text-sm text-[#7a6859]">
                            {emailEvent
                              ? `Envoyé le ${formatDateTime(emailEvent.created_at)} à ${emails[0] ?? 'l’adresse du client'}.`
                              : emails.length
                                ? 'Pas encore envoyé.'
                                : 'Aucune adresse courriel disponible.'}
                          </p>
                        </div>
                        {isActive && !emailEvent && emails.length > 0 && (
                          <button type="button" disabled={busyProcessId === process.id || !canSendFollowUpMessages} onClick={() => void sendClientContactEmail(process)} className={buttonClass('secondary')}>
                            Envoyer
                          </button>
                        )}
                      </div>
                    </div>

                    {isActive && !canSendFollowUpMessages && (!textEvent || !emailEvent) && (
                      <p className="mt-2 text-xs text-[#8a6f5d]">
                        Les actions texto et courriel seront disponibles lorsque le statut sera « Aucune réponse ».
                      </p>
                    )}

                    {firstContactEvent && isActive && (
                      <div className={`mt-3 rounded-xl border p-3 text-sm ${followUpDue ? 'border-amber-300 bg-amber-50 font-semibold text-amber-900' : 'border-[#eadfd2] bg-white text-[#7a6859]'}`}>
                        {followUpDue
                          ? 'Relance à effectuer maintenant. Une tâche est visible dans Tâches administratives.'
                          : `Relance prévue le ${formatDateTime(followUpAt?.toISOString())}. Aucun message ne sera envoyé automatiquement.`}
                      </div>
                    )}

                    {isActive && (
                      <div className="mt-5 border-t border-[#eadfd2] pt-5">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] xl:items-end">
                          <label className="text-sm font-medium text-[#5d4a3d]">Statut
                            <select
                              value={process.status === 'voicemail_left' ? 'no_response' : process.status}
                              disabled={busyProcessId === process.id}
                              onChange={(event) => {
                                const nextStatus = event.target.value as ProcessStatus
                                if (nextStatus === 'contacted_waiting_response') {
                                  setOtherStatusProcessId(process.id)
                                  setOtherStatusDetails('')
                                  return
                                }
                                void updateProcessStatus(process, nextStatus)
                              }}
                              className={`${inputClass} mt-2`}
                            >
                              {!editableStatuses.includes(process.status) && process.status !== 'voicemail_left' && <option value={process.status}>{statusLabels[process.status]}</option>}
                              {editableStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
                            </select>
                          </label>
                          <label className="text-sm font-medium text-[#5d4a3d]">Professionnel envisagé
                            <select value={process.prospective_professional_id ?? ''} disabled={busyProcessId === process.id} onChange={(event) => void updateProspectiveProfessional(process, event.target.value)} className={`${inputClass} mt-2`}>
                              <option value="">À déterminer</option>
                              {professionals.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name ?? profile.email}</option>)}
                            </select>
                          </label>
                          <button type="button" disabled={busyProcessId === process.id || !process.prospective_professional_id} onClick={() => void assignClient(process)} className={buttonClass('primary')}>Confirmer le service pris</button>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" onClick={() => { setContactProcessId(process.id); setContactForm({ occurredAt: getLocalDateTimeValue(), method: 'call', note: '' }) }} className={buttonClass('secondary')}>Consigner un contact</button>
                          <button type="button" onClick={() => void returnToWaitingList(process)} className={buttonClass('secondary')}>Retourner en liste d’attente</button>
                        </div>
                        {otherStatusProcessId === process.id && (
                          <div className="mt-4 rounded-xl border border-[#dfd0bf] bg-[#fbf6ef] p-4">
                            <label className="text-sm font-medium text-[#5d4a3d]">
                              Précision obligatoire
                              <textarea
                                value={otherStatusDetails}
                                onChange={(event) => setOtherStatusDetails(event.target.value)}
                                rows={3}
                                placeholder="Ex. : Le client doit vérifier son horaire et nous rappellera."
                                className={`${inputClass} mt-2`}
                              />
                            </label>
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                disabled={!otherStatusDetails.trim() || busyProcessId === process.id}
                                onClick={() => void updateProcessStatus(process, 'contacted_waiting_response', otherStatusDetails)}
                                className={buttonClass('primary')}
                              >
                                Enregistrer
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setOtherStatusProcessId('')
                                  setOtherStatusDetails('')
                                }}
                                className={buttonClass('secondary')}
                              >
                                Annuler
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {isRefusedHistory && (
                      <div className="mt-5 rounded-xl border border-[#e9cfc5] bg-[#fff6f2] p-4">
                        <p className="text-sm font-semibold text-[#6f3f32]">
                          Dossier classé : refus du client
                        </p>
                        <p className="mt-1 text-sm text-[#7a6859]">
                          Vous pouvez reprendre la même démarche ou replacer le client dans la liste d’attente. Tout l’historique sera conservé.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busyProcessId === process.id}
                            onClick={() => void reopenRefusedProcess(process)}
                            className={buttonClass('primary')}
                          >
                            Reprendre la démarche
                          </button>
                          <button
                            type="button"
                            disabled={busyProcessId === process.id}
                            onClick={() => void returnToWaitingList(process)}
                            className={buttonClass('secondary')}
                          >
                            Retourner en liste d’attente
                          </button>
                        </div>
                      </div>
                    )}

                    {contactProcessId === process.id && (
                      <div className="mt-4 rounded-xl border border-[#dfd0bf] bg-[#fbf6ef] p-4">
                        <h3 className="font-semibold text-[#332820]">Nouvelle tentative de contact</h3>
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <label className="text-sm">Date et heure<input type="datetime-local" value={contactForm.occurredAt} onChange={(event) => setContactForm((current) => ({ ...current, occurredAt: event.target.value }))} className={`${inputClass} mt-2`} /></label>
                          <label className="text-sm">Moyen<select value={contactForm.method} onChange={(event) => setContactForm((current) => ({ ...current, method: event.target.value as ContactForm['method'] }))} className={`${inputClass} mt-2`}><option value="call">Appel</option><option value="voicemail">Message vocal</option></select></label>
                          <label className="text-sm">Note<input value={contactForm.note} onChange={(event) => setContactForm((current) => ({ ...current, note: event.target.value }))} className={`${inputClass} mt-2`} placeholder="Résultat de la démarche" /></label>
                        </div>
                        <div className="mt-3 flex gap-2"><button type="button" onClick={() => void saveContactAttempt(process)} className={buttonClass('primary')}>Enregistrer</button><button type="button" onClick={() => setContactProcessId('')} className={buttonClass('secondary')}>Annuler</button></div>
                      </div>
                    )}

                    <details className="mt-5 border-t border-[#eadfd2] pt-4">
                      <summary className="cursor-pointer text-sm font-semibold text-[#8a5633]">Historique des démarches ({processEvents.length})</summary>
                      <div className="mt-3 space-y-2">
                        {processEvents.length === 0 ? <p className="text-sm text-[#7a6859]">Aucun événement.</p> : processEvents.map((event) => (
                          <div key={event.id} className="border-l-2 border-[#d9b591] pl-3 text-sm">
                            <p className="font-medium text-[#332820]">{event.contact_method ? contactMethodLabels[event.contact_method] : event.note || 'Mise à jour'}</p>
                            {event.contact_method && event.note && <p className="mt-1 text-[#6c5a4d]">{event.note}</p>}
                            <p className="mt-1 text-xs text-[#8a6f5d]">{formatDateTime(event.created_at)} · {event.actor_name ?? 'Direction'}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  </article>
                )
              })}
            </section>
          )}
        </div>
      </main>
    </>
  )
}
