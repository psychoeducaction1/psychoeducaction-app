'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
  EmptyState,
  buttonClass,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeaderClass,
  tableRowClass,
  tableShellClass,
} from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'
import {
  closureReasonOptions,
  nullableText,
  type AssignedClient,
  type EditableClientField,
} from '../shared'

export default function ProfessionnelClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<AssignedClient[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingClientIds, setSavingClientIds] = useState<Record<string, boolean>>({})
  const [clientMessages, setClientMessages] = useState<Record<string, string>>({})
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})

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
        .single()

      if (profileError) {
        setError(profileError.message)
        setLoading(false)
        return
      }

      if (profile?.role !== 'professionnel' && profile?.role !== 'direction') {
        router.push('/')
        return
      }

      const { data, error: clientsError } = await supabase
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

  const activeClients = clients.filter((client) => client.is_active)
  const noResponseClients = clients.filter((client) => !client.is_active)

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
                <td className="px-4 py-4 align-top font-medium text-[#332820]">
                  {client.first_name}
                </td>
                <td className="px-4 py-4 align-top font-medium text-[#332820]">
                  {client.last_name}
                </td>
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
                            updateClientField(
                              client.id,
                              'short_comment',
                              event.target.value
                            )
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
              Mes clients
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a6859]">
              Suivez les contacts et la prise de service de vos clients assignés.
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
