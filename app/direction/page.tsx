'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'

type Profile = {
  id: string
  full_name: string | null
  email: string | null
}

type AssignedClient = {
  professional_id: string | null
  is_active: boolean | null
}

type AssignmentRequest = {
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  request_comment: string | null
}

type ClientStats = {
  total: number
  active: number
  noResponse: number
}

type DirectionRow = {
  id: string
  fullName: string
  email: string
  totalAssignedClients: number
  activeClients: number
  noResponseClients: number
  requestActive: boolean
  requestedCount: number
  assignedCount: number
  remainingCount: number
  requestComment: string
}

export default function DirectionPage() {
  const [rows, setRows] = useState<DirectionRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError(null)

      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, email')
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
        setLoading(false)
        return
      }

      const [assignedClientsResponse, assignmentRequestsResponse] = await Promise.all([
        supabase
          .from('assigned_clients')
          .select('professional_id, is_active')
          .in('professional_id', professionalIds),
        supabase
          .from('assignment_requests')
          .select(
            'professional_id, is_active, requested_count, assigned_count, remaining_count, request_comment'
          )
          .in('professional_id', professionalIds),
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

      const clientStatsByProfessionalId = new Map<string, ClientStats>()

      assignedClients.forEach((client) => {
        if (!client.professional_id) return

        const currentStats = clientStatsByProfessionalId.get(client.professional_id) ?? {
          total: 0,
          active: 0,
          noResponse: 0,
        }

        currentStats.total += 1

        if (client.is_active) {
          currentStats.active += 1
        } else {
          currentStats.noResponse += 1
        }

        clientStatsByProfessionalId.set(client.professional_id, currentStats)
      })

      const requestByProfessionalId = new Map<string, AssignmentRequest>()
      assignmentRequests.forEach((request) => {
        if (!requestByProfessionalId.has(request.professional_id)) {
          requestByProfessionalId.set(request.professional_id, request)
        }
      })

      const nextRows: DirectionRow[] = professionals.map((profile) => {
        const request = requestByProfessionalId.get(profile.id)
        const clientStats = clientStatsByProfessionalId.get(profile.id)

        return {
          id: profile.id,
          fullName: profile.full_name ?? '-',
          email: profile.email ?? '-',
          totalAssignedClients: clientStats?.total ?? 0,
          activeClients: clientStats?.active ?? 0,
          noResponseClients: clientStats?.noResponse ?? 0,
          requestActive: request?.is_active ?? false,
          requestedCount: request?.requested_count ?? 0,
          assignedCount: request?.assigned_count ?? 0,
          remainingCount: request?.remaining_count ?? 0,
          requestComment: request?.request_comment?.trim() || '-',
        }
      })

      setRows(nextRows)
      setLoading(false)
    }

    loadData()
  }, [])

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-slate-900">Dashboard Direction</h1>
      <p className="mt-1 text-sm text-slate-600">
        Vue simple des professionnels et de leurs demandes d&apos;assignation.
      </p>

      {loading && (
        <div className="mt-6 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Chargement des données...
        </div>
      )}

      {!loading && error && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Erreur: {error}
        </div>
      )}

      {!loading && !error && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Nom</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Email</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Clients assignés total
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Clients actifs
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Sans réponse / service non pris
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Demande active
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Clients demandés
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Clients assignés via demande
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Clients restants
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Commentaire
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-slate-500">
                    Aucun professionnel trouvé.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-900">
                      <Link
                        href={`/professionnel/${row.id}`}
                        className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
                      >
                        {row.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.email}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.totalAssignedClients}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.activeClients}</td>
                    <td className="px-4 py-3 text-slate-700">{row.noResponseClients}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {row.requestActive ? 'Oui' : 'Non'}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.requestedCount}</td>
                    <td className="px-4 py-3 text-slate-700">{row.assignedCount}</td>
                    <td className="px-4 py-3 text-slate-700">{row.remainingCount}</td>
                    <td className="px-4 py-3 text-slate-700">{row.requestComment}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
