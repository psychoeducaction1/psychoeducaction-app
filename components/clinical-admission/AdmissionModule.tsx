'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useClinicalFormGuard } from '@/components/clinical-workspace/NavigationGuard'
import { clinicalCard } from '@/components/clinical-workspace/styles'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import { fetchAdmission, commandAdmission } from '@/lib/clinical-admission/client'
import { confirmedAssignmentAfterTimeout, hasAvailableAssignmentCapacity } from '@/lib/clinical-admission/timeoutRecovery'
import type { AdmissionAction, AdmissionWorkspace } from '@/lib/clinical-admission/types'
import { ClinicalApiError, isClinicalAccessDenied } from '@/lib/clinical-workspace/api'
import type { WorkspaceSection } from '@/lib/clinical-workspace/navigation'
import { CallsPanel } from './CallsPanel'
import { WaitingPanel } from './WaitingPanel'
import { ProcessesPanel } from './ProcessesPanel'
import { TasksPanel } from './TasksPanel'
import { ProfessionalPanel } from './ProfessionalPanel'
import type { AdmissionUi } from './shared'

export function AdmissionModule({ workspace, section, onNavigate, onUpdated, professionalId, embedded = false, retainOnSectionChange = false }: {
  workspace: WorkspaceView; section: WorkspaceSection
  onNavigate: (section: WorkspaceSection, query?: Record<string, string | null>) => Promise<void>
  onUpdated: () => Promise<void>
  embedded?: boolean
  professionalId?: string
  retainOnSectionChange?: boolean
}) {
  const params = useSearchParams(), query = useMemo(() => new URLSearchParams(params.toString()), [params])
  const actor = useMemo(() => ({ actorId: workspace.actor.id, context: workspace.context }), [workspace.actor.id, workspace.context])
  const [data, setData] = useState<AdmissionWorkspace | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false)
  const operation = useRef(false), generation = useRef(0)
  const [readTiming, setReadTiming] = useState('')
  const guard = useClinicalFormGuard(false, busy)
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!workspace.durable) return
    const request = ++generation.current
    setLoading(true)
    const started = performance.now()
    try { const current = await fetchAdmission(actor, signal); if (!signal?.aborted && generation.current === request) { setReadTiming(JSON.stringify({ requestMs: Math.round(performance.now() - started), readyMs: Math.round(performance.now()) })); setData(current); setError('') } }
    catch (cause) { if (!signal?.aborted && generation.current === request) { if (isClinicalAccessDenied(cause)) { setData(null); void onUpdated() } setError(cause instanceof Error ? cause.message : 'Chargement impossible.') } }
    finally { if (!signal?.aborted && generation.current === request) setLoading(false) }
  }, [actor, workspace.durable, onUpdated])
  useEffect(() => { setData(null); const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])
  const previousSection = useRef(section)
  useEffect(() => {
    const changed = previousSection.current !== section
    previousSection.current = section
    if (!retainOnSectionChange || !changed) return
    // Keep the already-authorized projection visible during tab revalidation.
    // All commands still verify current server permissions and record versions.
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [section, retainOnSectionChange, load])
  const run = useCallback<AdmissionUi['run']>(async (action: AdmissionAction, id, values) => {
    if (operation.current) throw new Error('Une opération est déjà en cours. Attendez sa confirmation.')
    if (action === 'processes.assign' && id) {
      const process = data?.processes.find(item => item.id === id)
      if (process?.prospectiveProfessionalId && data && !hasAvailableAssignmentCapacity(data, process.prospectiveProfessionalId))
        throw new Error('Ce professionnel n’a plus de place disponible. Actualisez ses demandes avant de confirmer le rendez-vous.')
    }
    operation.current = true; guard.markPending(); setBusy(true); setError('')
    try {
      const result = await commandAdmission(actor, action, id, values)
      setData(result.workspace); await onUpdated()
      return result
    } catch (cause) {
      if (isClinicalAccessDenied(cause)) { setData(null); void onUpdated() }
      if (cause instanceof ClinicalApiError && cause.code === 'RESULT_UNCONFIRMED') {
        try {
          const current = await fetchAdmission(actor)
          setData(current)
          void onUpdated().catch(() => undefined)
          const confirmed = confirmedAssignmentAfterTimeout(current, action, id, values)
          if (confirmed) { setError(''); return confirmed }
          setError('La réponse a expiré et la liste vient d’être actualisée. Vérifiez si l’opération y figure. Si elle est absente, reprenez la même saisie : sa clé de reprise évite un doublon.')
        } catch (refreshError) {
          if (isClinicalAccessDenied(refreshError)) { setData(null); void onUpdated() }
          setError('La réponse a expiré et la vérification a échoué. Actualisez la page avant de reprendre la même saisie ; sa clé de reprise évite un doublon.')
        }
      } else setError(cause instanceof Error ? cause.message : 'L’opération n’a pas pu être confirmée.')
      throw cause
    } finally { operation.current = false; guard.markSettled(); setBusy(false) }
  }, [actor, onUpdated, guard, data])
  const navigate: AdmissionUi['navigate'] = async (next, patch = {}) => {
    await onNavigate(next, next === section ? { ...Object.fromEntries(query), ...patch } : patch)
  }
  if (!workspace.durable) return <section className={clinicalCard}><h2 className="font-semibold">Admission durable uniquement</h2><p className="mt-3 text-sm">Les anciens parcours ne sont pas simulés par un second store mémoire. Connectez-vous au laboratoire local configuré pour les utiliser.</p></section>
  const administrative = workspace.context === 'administration'
  if (!administrative && ['calls', 'waiting', 'processes', 'tasks'].includes(section)) return <section role="alert" className={clinicalCard}>Ce parcours est administratif ; changer l’URL ne donne aucun accès.</section>
  const ui: AdmissionUi | null = data ? { data, busy, query, run, navigate, refresh: async () => { await load(); await onUpdated() }, select: patch => navigate(section, patch), openClient: id => onNavigate('clients', { client: id }), invalidate: cause => { if (isClinicalAccessDenied(cause)) { setData(null); void onUpdated() } } } : null
  return <div data-admission-load-timing={data ? readTiming || undefined : undefined} className="grid gap-4">
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error} Les saisies non confirmées restent dans leur formulaire.</p>}
    {loading && !data && <p role="status">Chargement de la projection autorisée…</p>}
    {data && (section === 'calls' ? <CallsPanel ui={ui!} /> : section === 'waiting' ? <WaitingPanel ui={ui!} clients={workspace.clients} /> : section === 'processes' ? <ProcessesPanel ui={ui!} actors={workspace.actors} /> : section === 'tasks' ? <TasksPanel ui={ui!} /> : <ProfessionalPanel workspace={workspace} ui={ui!} section={section} professionalId={professionalId} embedded={embedded} accessibleClientIds={workspace.clients.map(client => client.id)} />)}
  </div>
}
