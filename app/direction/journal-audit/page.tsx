'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
  EmptyState,
  PageHeader,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeaderClass,
  tableRowClass,
  tableShellClass,
} from '@/components/ui/index'
import { buttonClass } from '@/components/Ui'
import { supabase } from '@/lib/supabaseClient'

type AuditLogRow = {
  id: string
  created_at: string | null
  actor_profile_id: string | null
  actor_name: string | null
  actor_role: string | null
  action: string | null
  entity_type: string | null
  entity_id: string | null
  description: string | null
}

const AUDIT_PAGE_SIZE = 20

function formatDateTime(value: string | null): string {
  if (!value) return '-'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('fr-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatText(value: string | null | undefined): string {
  return value?.trim() || '-'
}

function formatRole(value: string | null): string {
  if (value === 'direction') return 'Direction'
  if (value === 'professionnel') return 'Professionnel'
  return formatText(value)
}

function formatAction(value: string | null): string {
  const labels: Record<string, string> = {
    assignment_created: 'Assignation créée',
    professional_notification_sent: 'Courriel professionnel envoyé',
    professional_notification_failed: 'Courriel professionnel échoué',
    professional_notification_not_sent: 'Courriel professionnel non envoyé',
    client_notification_sent: 'Courriel client envoyé',
    client_notification_failed: 'Courriel client échoué',
    client_notification_not_sent: 'Courriel client non envoyé',
    assignment_status_changed: 'Statut modifié',
    professional_created: 'Professionnel créé',
    platform_access_enabled: 'Accès plateforme activé',
    platform_access_disabled: 'Accès plateforme désactivé',
    professional_access_resent: 'Invitation renvoyée',
    waiting_list_client_created: 'Client créé',
    waiting_list_client_deleted: 'Client supprimé',
  }

  return value ? labels[value] ?? value : '-'
}

export default function DirectionJournalAuditPage() {
  const router = useRouter()
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [actorFilter, setActorFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(0)

  useEffect(() => {
    const loadAuditLogs = async () => {
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

      const { data, error: auditError } = await supabase
        .from('audit_logs')
        .select(
          'id, created_at, actor_profile_id, actor_name, actor_role, action, entity_type, entity_id, description'
        )
        .order('created_at', { ascending: false })
        .limit(500)

      if (auditError) {
        setError(auditError.message)
        setLoading(false)
        return
      }

      setLogs((data ?? []) as AuditLogRow[])
      setLoading(false)
    }

    loadAuditLogs()
  }, [router])

  const actorOptions = useMemo(() => {
    const options = new Map<string, string>()

    logs.forEach((log) => {
      if (!log.actor_profile_id) return
      options.set(log.actor_profile_id, formatText(log.actor_name))
    })

    return [...options.entries()].sort((firstOption, secondOption) =>
      firstOption[1].localeCompare(secondOption[1], 'fr')
    )
  }, [logs])

  const actionOptions = useMemo(() => {
    const actions = new Set<string>()

    logs.forEach((log) => {
      if (log.action) actions.add(log.action)
    })

    return [...actions].sort((firstAction, secondAction) =>
      formatAction(firstAction).localeCompare(formatAction(secondAction), 'fr')
    )
  }, [logs])

  const filteredLogs = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()

    return logs.filter((log) => {
      const matchesActor =
        actorFilter === 'all' || log.actor_profile_id === actorFilter
      const matchesAction = actionFilter === 'all' || log.action === actionFilter
      const matchesSearch =
        !normalizedSearch ||
        [
          log.actor_name,
          log.actor_role,
          log.action,
          log.entity_type,
          log.description,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch)

      return matchesActor && matchesAction && matchesSearch
    })
  }, [actionFilter, actorFilter, logs, searchQuery])

  const pageCount = Math.max(Math.ceil(filteredLogs.length / AUDIT_PAGE_SIZE), 1)
  const paginatedLogs = filteredLogs.slice(
    currentPage * AUDIT_PAGE_SIZE,
    currentPage * AUDIT_PAGE_SIZE + AUDIT_PAGE_SIZE
  )

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Direction"
            title="Journal d'audit"
            description="Historique chronologique des actions importantes de la plateforme."
          />

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement du journal...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              Erreur: {error}
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-5">
              <section className="grid gap-3 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.06)] lg:grid-cols-[1fr_0.35fr_0.35fr]">
                <label className="block text-sm font-medium text-[#5d4a3d]">
                  Recherche
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value)
                      setCurrentPage(0)
                    }}
                    placeholder="Rechercher une action, un utilisateur ou une description..."
                    className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition placeholder:text-[#a89686] focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  />
                </label>
                <label className="block text-sm font-medium text-[#5d4a3d]">
                  Utilisateur
                  <select
                    value={actorFilter}
                    onChange={(event) => {
                      setActorFilter(event.target.value)
                      setCurrentPage(0)
                    }}
                    className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  >
                    <option value="all">Tous</option>
                    {actorOptions.map(([actorId, actorName]) => (
                      <option key={actorId} value={actorId}>
                        {actorName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-[#5d4a3d]">
                  Action
                  <select
                    value={actionFilter}
                    onChange={(event) => {
                      setActionFilter(event.target.value)
                      setCurrentPage(0)
                    }}
                    className="mt-1 w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] outline-none transition focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]"
                  >
                    <option value="all">Toutes</option>
                    {actionOptions.map((action) => (
                      <option key={action} value={action}>
                        {formatAction(action)}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <div className={tableShellClass}>
                <table className={tableClass}>
                  <thead className={tableHeaderClass}>
                    <tr>
                      <th className={tableHeadCellClass}>Date</th>
                      <th className={tableHeadCellClass}>Utilisateur</th>
                      <th className={tableHeadCellClass}>Rôle</th>
                      <th className={tableHeadCellClass}>Action</th>
                      <th className={tableHeadCellClass}>Description</th>
                    </tr>
                  </thead>
                  <tbody className={tableBodyClass}>
                    {paginatedLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8">
                          <EmptyState title="Aucune action trouvée." />
                        </td>
                      </tr>
                    ) : (
                      paginatedLogs.map((log) => (
                        <tr key={log.id} className={tableRowClass}>
                          <td className={tableCellClass}>
                            {formatDateTime(log.created_at)}
                          </td>
                          <td className={tableCellClass}>
                            {formatText(log.actor_name)}
                          </td>
                          <td className={tableCellClass}>
                            <Badge
                              tone={
                                log.actor_role === 'direction'
                                  ? 'success'
                                  : 'neutral'
                              }
                            >
                              {formatRole(log.actor_role)}
                            </Badge>
                          </td>
                          <td className={tableCellClass}>
                            {formatAction(log.action)}
                          </td>
                          <td className={tableCellClass}>
                            {formatText(log.description)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {filteredLogs.length > AUDIT_PAGE_SIZE && (
                <div className="flex flex-col gap-3 rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    className={buttonClass('secondary')}
                    disabled={currentPage === 0}
                    onClick={() =>
                      setCurrentPage((pageIndex) => Math.max(pageIndex - 1, 0))
                    }
                  >
                    Précédent
                  </button>
                  <p className="text-center text-sm font-medium text-[#7a6859]">
                    Page {currentPage + 1} sur {pageCount}
                  </p>
                  <button
                    type="button"
                    className={buttonClass('secondary')}
                    disabled={currentPage >= pageCount - 1}
                    onClick={() =>
                      setCurrentPage((pageIndex) =>
                        Math.min(pageIndex + 1, pageCount - 1)
                      )
                    }
                  >
                    Suivant
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
