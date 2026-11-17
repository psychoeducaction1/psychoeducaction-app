'use client'
import { isActorEventVisibleInJournal } from '@/lib/auditJournal'

import { useEffect, useMemo, useState } from 'react'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import { isCalendarJournal, type CalendarJournal, type CalendarJournalEvent } from '@/lib/clinical-calendar/journal'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { legacyAuditActions, legacyAuditRole, legacyAuditStatus } from '@/lib/clinical-workspace/legacyPresentation'
import { clinicalCard, clinicalInput } from './styles'

const labels: Record<string, string> = {
  appointment_created: 'Rencontre créée',
  appointment_cancelled: 'Rencontre annulée',
  appointment_rescheduled: 'Rencontre déplacée',
  assignment_created: 'Assignation créée',
  assignment_returned: 'Assignation retournée',
  assignment_result_recorded: 'Résultat du service enregistré',
  assignment_result_not_contacted: 'Service non contacté',
  assignment_result_pending: 'Service en attente',
  assignment_result_taken: 'Service pris',
  assignment_result_not_taken: 'Service non pris',
  assignment_status_changed: 'Statut de l’assignation modifié',
  assigned_client_deleted: 'Assignation supprimée',
  assignment_request_deleted: 'Demande professionnelle supprimée',
  admission_created: 'Client ajouté à l’attente',
  admission_updated: 'Dossier d’attente modifié',
  admission_restored: 'Dossier d’attente rétabli',
  admission_classified: 'Dossier d’attente classé',
  prospect_created: 'Prospect créé',
  prospect_transferred: 'Prospect transféré à l’attente',
  prospect_followup_created: 'Suivi du prospect ajouté',
  prospect_outcome_recorded: 'Résultat du prospect enregistré',
  process_started: 'Démarche commencée',
  process_updated: 'Démarche modifiée',
  process_reopened: 'Démarche rouverte',
  process_classified: 'Démarche classée',
  process_returned: 'Démarche retournée',
  contact_voicemail: 'Message vocal déclaré',
  contact_text: 'Texto déclaré',
  contact_email: 'Courriel déclaré',
  contact_text_email: 'Texto et courriel déclarés',
  capacity_created: 'Demande professionnelle créée',
  capacity_updated: 'Demande professionnelle modifiée',
  preferences_updated: 'Préférences de jumelage modifiées',
  notification_simulated: 'Notification simulée',
  professional_notification_sent: 'Courriel professionnel envoyé',
  professional_notification_failed: 'Courriel professionnel échoué',
  professional_notification_not_sent: 'Courriel professionnel non envoyé',
  client_notification_sent: 'Courriel client envoyé',
  client_notification_failed: 'Courriel client échoué',
  client_notification_not_sent: 'Courriel client non envoyé',
  professional_created: 'Professionnel créé',
  platform_access_enabled: 'Accès plateforme activé',
  platform_access_disabled: 'Accès plateforme désactivé',
  professional_access_resent: 'Invitation renvoyée',
  waiting_list_client_created: 'Client créé',
  waiting_list_client_deleted: 'Client supprimé',
  waiting_list_client_permanently_deleted: 'Client supprimé définitivement',
  professional_deleted: 'Professionnel supprimé',
  pending_contact_reminder_sent: 'Rappel automatique envoyé',
}
const actionLabel = (value: string) => labels[value] ?? legacyAuditActions[value] ?? 'Action non répertoriée'
const format = (value: string | null) => value ? new Date(value).toLocaleString('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'short', timeStyle: 'short' }) : '—'

export function ClinicalAuditJournal({ workspace }: { workspace: WorkspaceView }) {
  const [journal, setJournal] = useState<CalendarJournal | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [action, setAction] = useState<CalendarJournalEvent['action'] | ''>('')
  const [actorFilter, setActorFilter] = useState('')
  const [page, setPage] = useState(0)
  useEffect(() => {
    if (!workspace.durable || workspace.context !== 'administration') return
    const abort = new AbortController()
    void clinicalRequest<CalendarJournal>({ actorId: workspace.actor.id, context: 'administration' }, '/calendar/journal', undefined, 'GET', abort.signal, undefined, isCalendarJournal)
      .then(value => { if (!abort.signal.aborted) setJournal({ ...value, events: value.events.filter(event => isActorEventVisibleInJournal(event.actorId, event.at)) }) })
      .catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Le journal d’audit est indisponible.') })
    return () => abort.abort()
  }, [workspace.actor.id, workspace.context, workspace.durable])
  const filtered = useMemo(() => (journal?.events ?? []).filter(event => {
    if (action && event.action !== action) return false
    if (actorFilter && (event.actorId ?? event.actorName) !== actorFilter) return false
    const needle = search.trim().toLocaleLowerCase('fr-CA')
    return !needle || [event.actorName, event.professionalName ?? '', event.clientName ?? '', event.description ?? '', event.details?.requesterName ?? '', event.details?.email ?? '', actionLabel(event.action)].some(value => value.toLocaleLowerCase('fr-CA').includes(needle))
  }), [journal, action, actorFilter, search])
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25))
  const current = Math.min(page, pageCount - 1)
  const actions = [...new Set(journal?.events.map(event => event.action) ?? [])].sort((a,b) => actionLabel(a).localeCompare(actionLabel(b), 'fr'))
  const actors = [...new Map(journal?.events.map(event => [event.actorId ?? event.actorName, { key: event.actorId ?? event.actorName, name: event.actorName }] as const) ?? []).values()].sort((a,b) => a.name.localeCompare(b.name, 'fr'))
  return <section className={clinicalCard} aria-label="Journal d’audit">
    <p className="text-sm text-[#8a6f5d]">Assignations, services pris et mouvements de rencontres, par ordre chronologique.</p>
    {!workspace.durable && <p className="mt-4 text-sm">Le journal est disponible dans le laboratoire local persistant.</p>}
    {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
    {workspace.durable && <>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-sm">Rechercher<input type="search" className={clinicalInput} value={search} maxLength={120} onChange={event => { setSearch(event.target.value); setPage(0) }} placeholder="Client, professionnel ou auteur" /></label><label className="grid gap-1 text-sm">Auteur<select className={clinicalInput} value={actorFilter} onChange={event => { setActorFilter(event.target.value); setPage(0) }}><option value="">Tous</option>{actors.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label><label className="grid gap-1 text-sm">Action<select className={clinicalInput} value={action} onChange={event => { setAction(event.target.value as typeof action); setPage(0) }}><option value="">Toutes</option>{actions.map(value => <option key={value} value={value}>{actionLabel(value)}</option>)}</select></label></div>
      {!journal && !error && <p role="status" className="mt-4">Chargement du journal…</p>}
      {journal && <><p role="status" className="my-4 text-sm text-[#8a6f5d]">{filtered.length} événement(s)</p><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-[#eadfd2] text-[#6c5140]"><tr><th className="p-3">Date</th><th className="p-3">Auteur</th><th className="p-3">Action</th><th className="p-3">Détail</th></tr></thead><tbody>{filtered.slice(current * 25, (current + 1) * 25).map(event => <tr key={event.id} className="border-b border-[#f0e7dd] align-top"><td className="whitespace-nowrap p-3">{format(event.at)}</td><td className="p-3">{event.actorName}{event.details?.actorRole && <span className="block text-xs text-[#806b5c]">{legacyAuditRole(event.details.actorRole)}</span>}</td><td className="p-3 font-medium">{actionLabel(event.action)}</td><td className="p-3">{[event.clientName, event.professionalName].filter(Boolean).join(' · ') || event.description || '—'}{event.category === 'calendar' && <span className="block text-[#806b5c]">{event.action === 'appointment_rescheduled' ? `${format(event.previousStartAt)} → ${format(event.startAt)}` : format(event.startAt)}</span>}{event.description && (event.clientName || event.professionalName) && <span className="block text-[#806b5c]">{event.description}</span>}{event.details && <span className="block text-[#806b5c]">{[event.details.requesterName && `Requérant : ${event.details.requesterName}`, event.details.email && `Courriel : ${event.details.email}`, event.details.previousStatus && `Ancien statut : ${legacyAuditStatus(event.details.previousStatus)}`, event.details.newStatus && `Nouveau statut : ${legacyAuditStatus(event.details.newStatus)}`].filter(Boolean).join(' · ')}</span>}</td></tr>)}</tbody></table></div>{!filtered.length && <p className="py-4 text-sm text-[#8a6f5d]">Aucun événement pour ces filtres.</p>}{pageCount > 1 && <div className="mt-4 flex items-center justify-between gap-3 text-sm"><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Précédent</button><span>{current + 1} / {pageCount}</span><button type="button" disabled={current === pageCount - 1} onClick={() => setPage(current + 1)}>Suivant</button></div>}</>}
    </>}
  </section>
}
