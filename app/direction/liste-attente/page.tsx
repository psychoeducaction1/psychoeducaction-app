'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
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
}

type WaitingListForm = {
  priority_level: string
  service_requested: string
  client_name: string
  first_requester_name: string
  second_requester_name: string
  birth_date: string
  city: string
  meeting_modality: string
  availability: string
  meeting_type: string
  contact_email: string
  contact_phone: string
  consultation_reason: string
  internal_notes: string
}

const waitingListSelect =
  'id, created_at, status, priority_level, service_requested, client_name, first_requester_name, second_requester_name, birth_date, city, meeting_modality, meeting_type, availability, contact_email, contact_phone, consultation_reason, internal_notes'

const emptyWaitingListForm: WaitingListForm = {
  priority_level: '',
  service_requested: '',
  client_name: '',
  first_requester_name: '',
  second_requester_name: '',
  birth_date: '',
  city: '',
  meeting_modality: '',
  availability: '',
  meeting_type: '',
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

export default function DirectionListeAttentePage() {
  const router = useRouter()
  const [clients, setClients] = useState<WaitingListClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<WaitingListForm>(emptyWaitingListForm)
  const [savingClient, setSavingClient] = useState(false)
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
        .order('created_at', { ascending: false })

      if (waitingListError) {
        setError(waitingListError.message)
        setLoading(false)
        return
      }

      setClients((data ?? []) as WaitingListClient[])
      setLoading(false)
    }

    loadWaitingList()
  }, [router])

  const updateFormField = (field: keyof WaitingListForm, value: string) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
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
      .insert({
        status: 'waiting',
        priority_level: nullableText(form.priority_level),
        service_requested: nullableText(form.service_requested),
        client_name: nullableText(form.client_name),
        first_requester_name: nullableText(form.first_requester_name),
        second_requester_name: nullableText(form.second_requester_name),
        birth_date: nullableText(form.birth_date),
        city: nullableText(form.city),
        meeting_modality: nullableText(form.meeting_modality),
        meeting_type: nullableText(form.meeting_type),
        availability: nullableText(form.availability),
        contact_email: nullableText(form.contact_email),
        contact_phone: nullableText(form.contact_phone),
        consultation_reason: nullableText(form.consultation_reason),
        internal_notes: nullableText(form.internal_notes),
      })
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
        data as WaitingListClient,
        ...currentClients,
      ])
    }

    setForm(emptyWaitingListForm)
    setShowForm(false)
    setFormMessage('Client ajouté à la liste d’attente.')
  }

  const inputClass =
    'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition duration-200 placeholder:text-[#b09c8a] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

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

                {showForm && (
                  <form onSubmit={handleCreateClient} className="mt-5 space-y-5">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        Priorité
                        <input
                          value={form.priority_level}
                          onChange={(event) =>
                            updateFormField('priority_level', event.target.value)
                          }
                          className={`${inputClass} mt-1`}
                          placeholder="Ex. normale, urgente"
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        Service demandé
                        <input
                          value={form.service_requested}
                          onChange={(event) =>
                            updateFormField('service_requested', event.target.value)
                          }
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        Nom du client
                        <input
                          value={form.client_name}
                          onChange={(event) =>
                            updateFormField('client_name', event.target.value)
                          }
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        1er requérant
                        <input
                          value={form.first_requester_name}
                          onChange={(event) =>
                            updateFormField(
                              'first_requester_name',
                              event.target.value
                            )
                          }
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        2e requérant
                        <input
                          value={form.second_requester_name}
                          onChange={(event) =>
                            updateFormField(
                              'second_requester_name',
                              event.target.value
                            )
                          }
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        Date de naissance
                        <input
                          type="date"
                          value={form.birth_date}
                          onChange={(event) =>
                            updateFormField('birth_date', event.target.value)
                          }
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        Ville
                        <input
                          value={form.city}
                          onChange={(event) =>
                            updateFormField('city', event.target.value)
                          }
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        Modalité de rencontre
                        <input
                          value={form.meeting_modality}
                          onChange={(event) =>
                            updateFormField('meeting_modality', event.target.value)
                          }
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        Type de rencontre
                        <input
                          value={form.meeting_type}
                          onChange={(event) =>
                            updateFormField('meeting_type', event.target.value)
                          }
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        Courriel
                        <input
                          type="email"
                          value={form.contact_email}
                          onChange={(event) =>
                            updateFormField('contact_email', event.target.value)
                          }
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        Téléphone
                        <input
                          value={form.contact_phone}
                          onChange={(event) =>
                            updateFormField('contact_phone', event.target.value)
                          }
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d] md:col-span-2 xl:col-span-1">
                        Préférence horaire
                        <input
                          value={form.availability}
                          onChange={(event) =>
                            updateFormField('availability', event.target.value)
                          }
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        Motif de consultation
                        <textarea
                          value={form.consultation_reason}
                          onChange={(event) =>
                            updateFormField(
                              'consultation_reason',
                              event.target.value
                            )
                          }
                          className={`${inputClass} mt-1 min-h-28 resize-y`}
                        />
                      </label>
                      <label className="text-sm font-medium text-[#5d4a3d]">
                        Notes internes
                        <textarea
                          value={form.internal_notes}
                          onChange={(event) =>
                            updateFormField('internal_notes', event.target.value)
                          }
                          className={`${inputClass} mt-1 min-h-28 resize-y`}
                        />
                      </label>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        className={buttonClass('secondary')}
                        onClick={() => {
                          setShowForm(false)
                          setForm(emptyWaitingListForm)
                          setFormError('')
                        }}
                        disabled={savingClient}
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        className={buttonClass('primary')}
                        disabled={savingClient}
                      >
                        {savingClient ? 'Ajout...' : 'Ajouter à la liste'}
                      </button>
                    </div>
                  </form>
                )}
              </section>

              <div className={tableShellClass}>
                <table className={`${tableClass} w-full`}>
                  <thead className={tableHeaderClass}>
                    <tr>
                      <th className={tableHeadCellClass}>Priorité</th>
                      <th className={tableHeadCellClass}>Statut</th>
                      <th className={tableHeadCellClass}>Service demandé</th>
                      <th className={tableHeadCellClass}>Client</th>
                      <th className={tableHeadCellClass}>Requérant</th>
                      <th className={tableHeadCellClass}>Date de naissance</th>
                      <th className={tableHeadCellClass}>Ville</th>
                      <th className={tableHeadCellClass}>Modalité</th>
                      <th className={tableHeadCellClass}>Préférence horaire</th>
                      <th className={tableHeadCellClass}>Type de rencontre</th>
                      <th className={tableHeadCellClass}>Contact</th>
                      <th className={tableHeadCellClass}>Motif</th>
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
                      clients.map((client) => (
                        <tr key={client.id} className={tableRowClass}>
                          <td className={tableCellClass}>
                            <Badge tone="warning">
                              {formatText(client.priority_level)}
                            </Badge>
                          </td>
                          <td className={tableCellClass}>
                            <Badge tone="muted">{formatText(client.status)}</Badge>
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
                          <td className={tableCellClass}>
                            {formatText(client.meeting_type)}
                          </td>
                          <td className={tableCellClass}>{formatContact(client)}</td>
                          <td className="max-w-xs whitespace-pre-wrap break-words px-4 py-3 align-top text-[#6c5a4d]">
                            {formatText(client.consultation_reason)}
                          </td>
                        </tr>
                      ))
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
