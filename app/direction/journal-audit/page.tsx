'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
  type BadgeTone,
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
import { isSuperAdmin } from '@/lib/superAdmin'

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
  metadata: AuditMetadata | null
}

type AuditMetadata = Record<string, unknown>

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
    waiting_list_client_permanently_deleted: 'Client supprimé définitivement',
    assigned_client_deleted: 'Assignation supprimée',
    assignment_request_deleted: 'Demande supprimée',
    professional_deleted: 'Professionnel supprimé',
  }

  return value ? labels[value] ?? value : '-'
}

function getActionTone(value: string | null): BadgeTone {
  if (!value) return 'muted'
  if (value.includes('failed') || value.includes('deleted')) return 'danger'
  if (value.includes('not_sent') || value.includes('disabled')) return 'warning'
  if (value.includes('sent') || value.includes('created') || value.includes('enabled')) {
    return 'success'
  }
  return 'neutral'
}

function getMetadataString(metadata: AuditMetadata | null, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function formatStatusValue(value: unknown) {
  if (value === true) return 'Service pris'
  if (value === false) return 'Service non pris'
  if (value === null) return 'En attente'
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

function getAuditDetails(log: AuditLogRow) {
  const metadata = log.metadata ?? null
  const details: Array<{ label: string; value: string }> = []
  const clientName = getMetadataString(metadata, [
    'client_name',
    'waiting_list_client_name',
    'assigned_client_name',
  ])
  const professionalName = getMetadataString(metadata, ['professional_name'])
  const requesterName = getMetadataString(metadata, ['requester_name'])
  const email = getMetadataString(metadata, [
    'client_email',
    'contact_email',
    'professional_email',
    'email',
  ])
  const previousStatus = formatStatusValue(metadata?.previous_status)
  const newStatus = formatStatusValue(metadata?.new_status)

  if (clientName) details.push({ label: 'Client', value: clientName })
  if (professionalName) {
    details.push({ label: 'Professionnel', value: professionalName })
  }
  if (requesterName) details.push({ label: 'Requérant', value: requesterName })
  if (email) details.push({ label: 'Courriel', value: email })
  if (previousStatus) details.push({ label: 'Ancien statut', value: previousStatus })
  if (newStatus) details.push({ label: 'Nouveau statut', value: newStatus })

  return details
}

export default function DirectionJournalAuditPage() {
  const router = useRouter()
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [actorFilter, setActorFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(0)
  const [canDeleteAuditLog, setCanDeleteAuditLog] = useState(false)
  const [logToDelete, setLogToDelete] = useState<AuditLogRow | null>(null)
  const [deletingLogId, setDeletingLogId] = useState('')

  useEffect(() => {
    const loadAuditLogs = async () => {
      setLoading(true)
      setError('')
      setDeleteError('')

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
        .select('role, email')
        .eq('id', user.id)
        .limit(1)
        .maybeSingle()

      if (currentProfileError || currentProfile?.role !== 'direction') {
        router.push('/')
        return
      }

      setCanDeleteAuditLog(isSuperAdmin(user, currentProfile))

      const { data, error: auditError } = await supabase
        .from('audit_logs')
        .select(
          'id, created_at, actor_profile_id, actor_name, actor_role, action, entity_type, entity_id, description, metadata'
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
          JSON.stringify(log.metadata ?? {}),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch)

      return matchesActor && matchesAction && matchesSearch
    })
  }, [actionFilter, actorFilter, logs, searchQuery])

  const pageCount = Math.max(Math.ceil(filteredLogs.length / AUDIT_PAGE_SIZE), 1)
  const safeCurrentPage = Math.min(currentPage, pageCount - 1)
  const paginatedLogs = filteredLogs.slice(
    safeCurrentPage * AUDIT_PAGE_SIZE,
    safeCurrentPage * AUDIT_PAGE_SIZE + AUDIT_PAGE_SIZE
  )

  const handleDeleteLog = async () => {
    if (!logToDelete) return

    setDeletingLogId(logToDelete.id)
    setDeleteError('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      setDeleteError('Session introuvable.')
      setDeletingLogId('')
      return
    }

    const response = await fetch(`/api/direction/audit-logs/${logToDelete.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null
      setDeleteError(body?.error ?? "La suppression de l'entrée a échoué.")
      setDeletingLogId('')
      return
    }

    setLogs((currentLogs) =>
      currentLogs.filter((currentLog) => currentLog.id !== logToDelete.id)
    )
    setLogToDelete(null)
    setDeletingLogId('')
  }

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

              {deleteError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {deleteError}
                </div>
              )}

              <div className={tableShellClass}>
                <table className={`${tableClass} w-full min-w-[1120px] table-fixed`}>
                  <colgroup>
                    <col className="w-[15rem]" />
                    <col className="w-[14rem]" />
                    <col className="w-[9rem]" />
                    <col className="w-[15rem]" />
                    <col />
                    {canDeleteAuditLog && <col className="w-[9rem]" />}
                  </colgroup>
                  <thead className={tableHeaderClass}>
                    <tr>
                      <th className={tableHeadCellClass}>Date</th>
                      <th className={tableHeadCellClass}>Utilisateur</th>
                      <th className={tableHeadCellClass}>Rôle</th>
                      <th className={tableHeadCellClass}>Action</th>
                      <th className={tableHeadCellClass}>Description</th>
                      {canDeleteAuditLog && (
                        <th className={`${tableHeadCellClass} text-right`}>
                          Actions
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className={tableBodyClass}>
                    {paginatedLogs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={canDeleteAuditLog ? 6 : 5}
                          className="px-4 py-8"
                        >
                          <EmptyState title="Aucune action trouvée." />
                        </td>
                      </tr>
                    ) : (
                      paginatedLogs.map((log) => (
                        <tr key={log.id} className={tableRowClass}>
                          <td className={`${tableCellClass} align-top`}>
                            <span className="font-medium text-[#332820]">
                              {formatDateTime(log.created_at)}
                            </span>
                          </td>
                          <td className={`${tableCellClass} align-top`}>
                            <span className="font-medium text-[#332820]">
                              {formatText(log.actor_name)}
                            </span>
                          </td>
                          <td className={`${tableCellClass} align-top`}>
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
                          <td className={`${tableCellClass} align-top`}>
                            <Badge tone={getActionTone(log.action)}>
                              {formatAction(log.action)}
                            </Badge>
                          </td>
                          <td className={`${tableCellClass} align-top`}>
                            <p className="break-words leading-6 text-[#6c5a4d]">
                              {formatText(log.description)}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#8a6f5d]">
                              {getAuditDetails(log).length > 0 ? (
                                getAuditDetails(log).map((detail) => (
                                  <span key={`${detail.label}-${detail.value}`}>
                                    <span className="font-semibold">
                                      {detail.label} :
                                    </span>{' '}
                                    {detail.value}
                                  </span>
                                ))
                              ) : (
                                <span>Détail non disponible</span>
                              )}
                            </div>
                          </td>
                          {canDeleteAuditLog && (
                            <td className={`${tableCellClass} align-top text-right`}>
                              <button
                                type="button"
                                className={`${buttonClass('secondary')} !w-auto justify-center text-sm text-red-700 hover:border-red-200 hover:bg-red-50`}
                                onClick={() => setLogToDelete(log)}
                              >
                                Supprimer
                              </button>
                            </td>
                          )}
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
                    disabled={safeCurrentPage === 0}
                    onClick={() =>
                      setCurrentPage((pageIndex) => Math.max(pageIndex - 1, 0))
                    }
                  >
                    Précédent
                  </button>
                  <p className="text-center text-sm font-medium text-[#7a6859]">
                    Page {safeCurrentPage + 1} sur {pageCount}
                  </p>
                  <button
                    type="button"
                    className={buttonClass('secondary')}
                    disabled={safeCurrentPage >= pageCount - 1}
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

      {logToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-6 shadow-[0_18px_50px_rgba(72,49,30,0.22)]">
            <h2 className="text-lg font-semibold text-[#332820]">
              Supprimer cette entrée
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#6c5a4d]">
              Voulez-vous vraiment supprimer cette entrée du journal d&apos;audit ?
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                className={buttonClass('secondary')}
                onClick={() => setLogToDelete(null)}
                disabled={Boolean(deletingLogId)}
              >
                Annuler
              </button>
              <button
                type="button"
                className={buttonClass('danger')}
                onClick={handleDeleteLog}
                disabled={deletingLogId === logToDelete.id}
              >
                {deletingLogId === logToDelete.id ? 'Suppression...' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
