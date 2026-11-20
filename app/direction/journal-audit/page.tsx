'use client'

import { hasDirectionAccess } from '@/lib/administrativeAccess'


import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
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
import { excludeSatisfactionAuditEvents, excludeTemporaryActorAuditEvents, isActorEventVisibleInJournal, isVisibleInAuditJournal } from '@/lib/auditJournal'
import { auditActionLabel, auditDescription, isBusinessAuditEvent } from '@/lib/auditJournalPresentation'
import { clinicalAuditRow, type ClinicalAuditEvent } from '@/lib/clinical-real/auditJournal'
import {
  getAssignedClientStatusMeta,
  type AssignedClientStatus,
} from '@/app/professionnel/shared'

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
  if (value === 'professionnel' || value === 'professional') return 'Professionnel'
  if (value === 'admin') return 'Administration'
  if (value === 'assistant') return 'Adjointe administrative'
  if (value === 'supervisor') return 'Superviseur'
  return formatText(value)
}

function formatAction(value: string | null): string { return auditActionLabel(value) }

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

const ASSIGNED_CLIENT_STATUS_TOKENS: readonly AssignedClientStatus[] = [
  'not_contacted',
  'pending',
  'taken',
  'not_taken',
]

function formatStatusValue(value: unknown) {
  if (
    typeof value === 'string' &&
    (ASSIGNED_CLIENT_STATUS_TOKENS as readonly string[]).includes(value)
  ) {
    return getAssignedClientStatusMeta(value as AssignedClientStatus).label
  }
  // Rétro-compatibilité : anciennes entrées d'audit qui stockaient un booléen brut.
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
  const [clinicalNotice, setClinicalNotice] = useState('')
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
        .select('role, platform_access_enabled, administrative_access')
        .eq('id', user.id)
        .limit(1)
        .maybeSingle()

      if (currentProfileError || !hasDirectionAccess(currentProfile) || currentProfile.platform_access_enabled === false) {
        router.push('/')
        return
      }


      const auditQuery = supabase
        .from('audit_logs')
        .select(
          'id, created_at, actor_profile_id, actor_name, actor_role, action, entity_type, entity_id, description, metadata'
        )
      const { data, error: auditError } = await excludeTemporaryActorAuditEvents(excludeSatisfactionAuditEvents(auditQuery))
        .order('created_at', { ascending: false })
        .limit(500)

      if (auditError) {
        setError(auditError.message)
        setLoading(false)
        return
      }

      const historical = ((data ?? []) as AuditLogRow[]).filter(isVisibleInAuditJournal)
      let clinical: AuditLogRow[] = []
      if (process.env.NEXT_PUBLIC_PEA_CLINICAL_REAL === 'true') {
        const { data: clinicalData, error: clinicalError } = await supabase.rpc('clinical_audit_journal', { p_limit: 200 })
        if (clinicalError) {
          setClinicalNotice('Le journal clinique n’est pas disponible sur cette instance ou pour ce compte.')
        } else {
          const events = (clinicalData as { events?: ClinicalAuditEvent[] } | null)?.events
          if (Array.isArray(events)) clinical = events.map(event => clinicalAuditRow(event))
          else setClinicalNotice('Le journal clinique a renvoyé une réponse inattendue.')
        }
      }
      setLogs([...historical, ...clinical].filter(log => isActorEventVisibleInJournal(log.actor_profile_id, log.created_at) && isBusinessAuditEvent(log)).sort((left, right) =>
        (right.created_at ?? '').localeCompare(left.created_at ?? '')))
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
              {clinicalNotice && <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{clinicalNotice}</p>}
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
                <table className={`${tableClass} w-full min-w-[1120px] table-fixed`}>
                  <colgroup>
                    <col className="w-[15rem]" />
                    <col className="w-[14rem]" />
                    <col className="w-[9rem]" />
                    <col className="w-[15rem]" />
                    <col />
                  </colgroup>
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
                        <td
                          colSpan={5}
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
                            {log.actor_profile_id && ['professionnel', 'professional', 'supervisor'].includes(log.actor_role ?? '') ? <Link href={'/professionnel/' + encodeURIComponent(log.actor_profile_id)} className="rounded px-1 -ml-1 font-medium text-[#332820] underline decoration-[#cfb89e] underline-offset-4 hover:bg-[#f0e2d2] hover:text-[#8a5633] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8a5633]" title="Ouvrir la fiche du professionnel">{formatText(log.actor_name)}</Link> : <span className="font-medium text-[#332820]">{formatText(log.actor_name)}</span>}
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
                              {auditDescription(log)}
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

    </>
  )
}
