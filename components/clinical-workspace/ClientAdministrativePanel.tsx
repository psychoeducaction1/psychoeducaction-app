'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import { canAdmin } from '@/lib/clinical-core/capabilities'
import { ClientAdministrationSections, ClientBillingResponsibles } from './ClientAdministrationSections'
import { ClinicalApiError, clinicalRequest, isClinicalAccessDenied } from '@/lib/clinical-workspace/api'
import type { ClientAdminProjection, WorkspaceView } from '@/lib/clinical-core/types'
import type { ClientOverview, ClientPerson } from '@/lib/clinical-workspace/clientDetails'
import { safeWorkspaceReturn, workspaceRoute, type WorkspaceSection } from '@/lib/clinical-workspace/navigation'
import { useClinicalNavigation } from './NavigationGuard'
import { clinicalCard } from './styles'
import { ClientDataSection, ClientFileSection, ClientPeopleSection, ClientPersonEditor, ClientProfileEditor } from './ClientFileIdentity'
import { ClientFileCommunications, ClientFileDocuments } from './ClientFileAttachments'
import { ClientLifecycleSection, ClientNotesSection } from './ClientFileNotes'
import { clientFileTab, clientFileTabs, clientIsArchived, clientModuleNavigation, clientResponsibleNames, clientServiceLabel } from './clientFileModel'
import { clientFileMutation } from './clientFileApi'

const ClientCalendar = dynamic(() => import('@/components/clinical-calendar/CalendarWorkspace').then(module => module.CalendarWorkspace), { loading: () => <p role="status">Ouverture des activités du client…</p> })
const ClientMandates = dynamic(() => import('@/components/clinical-mandates/ClientMandatesPanel').then(module => module.ClientMandatesPanel), { loading: () => <p role="status">Ouverture des consentements autorisés…</p> })

export function ClientAdministrativePanel({ client, workspace, onUpdated, onNavigate, onBack }: {
  client: ClientAdminProjection; workspace: WorkspaceView; onUpdated: () => Promise<void>;
  onNavigate: (section: WorkspaceSection, query?: Record<string, string | null>) => Promise<void>; onBack: () => void
}) {
  const params = useSearchParams(), query = useMemo(() => new URLSearchParams(params.toString()), [params]), navigation = useClinicalNavigation()
  const actor = useMemo(() => ({ actorId: workspace.actor.id, context: workspace.context }), [workspace.actor.id, workspace.context])
  const [overview, setOverview] = useState<ClientOverview | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [contentRevision, setContentRevision] = useState(0)
  const [editing, setEditing] = useState<'profile' | 'person' | null>(null), [person, setPerson] = useState<ClientPerson | undefined>()
  const [requestersOpen, setRequestersOpen] = useState(query.get('payerCard') === '1'), requestersRef = useRef<HTMLDivElement>(null), mandateRef = useRef<HTMLDivElement>(null)
  const sequence = useRef(0), tab = clientFileTab(workspace.context, query.get('clientTab') ?? (query.get('record') ? 'notes' : null))
  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++sequence.current; setLoading(true)
    try {
      const payload = await clinicalRequest<{ overview: ClientOverview }>(actor, `/clients/${client.id}/overview`, undefined, 'GET', signal, undefined, value => {
        const result = (value as { overview?: ClientOverview } | null)?.overview
        return result?.clientId === client.id && typeof result.profile?.version === 'number' && Array.isArray(result.contacts) && Array.isArray(result.lifecycle) && Array.isArray(result.documents) && Array.isArray(result.communications)
      })
      if (!signal?.aborted && request === sequence.current) { setOverview(payload.overview); setContentRevision(value => value + 1); setError('') }
    } catch (cause) {
      if (!signal?.aborted && request === sequence.current) {
        if (isClinicalAccessDenied(cause) || cause instanceof ClinicalApiError && cause.status === 404) { setOverview(null); setEditing(null); void onUpdated() }
        setError(cause instanceof Error ? cause.message : 'La fiche n’a pas pu être actualisée.')
      }
    } finally { if (!signal?.aborted && request === sequence.current) setLoading(false) }
  }, [actor, client.id, onUpdated])
  useEffect(() => { setOverview(null); setEditing(null); const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])
  const accessDenied = (cause: unknown) => { sequence.current++; setOverview(null); setEditing(null); setError(cause instanceof Error ? cause.message : 'Accès à la fiche retiré.'); void onUpdated() }
  const backFromNotes = async () => {
    const destination = safeWorkspaceReturn(query.get('returnTo'))
    if (destination) {
      const url = new URL(destination, 'http://127.0.0.1:3100'), target = workspaceRoute(url.pathname, url.searchParams)
      if (target.context === workspace.context && target.section === 'calendar') { await onNavigate('calendar', Object.fromEntries(url.searchParams)); return }
      if (target.context === workspace.context && target.section === 'clients' && target.clientId === client.id) { await onNavigate('clients', { ...Object.fromEntries(url.searchParams), client: client.id, clientTab: 'activities', record: null, note: null, returnTo: null }); return }
    }
    await select('notes', { record: null, note: null, appointment: null, returnTo: null })
  }
  const committed = useCallback(async () => { await Promise.all([load(), onUpdated()]) }, [load, onUpdated])
  const removePerson = async (target: ClientPerson) => {
    if (!target.canEdit || !window.confirm(`Retirer ${target.fullName} des requérants actifs ? Les mandats et signatures déjà conservés ne seront pas modifiés.`)) return
    try { await clientFileMutation(actor, `/clients/${client.id}/people/${target.id}`, { expectedVersion: target.version }, 'DELETE', accessDenied); await committed() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Le retrait du requérant n’a pas été confirmé.') }
  }
  const select = async (nextTab: typeof tab, patch: Record<string, string | null> = {}) => onNavigate('clients', { ...Object.fromEntries(query), ...clientModuleNavigation(client.id, nextTab, patch) })
  const moduleNavigate = async (section: WorkspaceSection, patch: Record<string, string | null> = {}) => {
    if (section === 'clients' || section === 'calendar' || section === 'mandates') await select(patch.clientTab === 'notes' || patch.record ? 'notes' : tab, patch)
    else await onNavigate(section, patch)
  }
  const administrative = canAdmin(workspace.actor)
  const archived = clientIsArchived(workspace, client), name = overview ? `${overview.profile.firstName} ${overview.profile.lastName}` : `${client.firstName} ${client.lastName}`
  return <article className="grid min-w-0 gap-4" aria-label="Fiche individuelle du client">
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><button type="button" className={buttonClass('ghost') + ' mb-2 !px-0'} onClick={onBack}><ArrowLeft size={16} />Retour au répertoire</button><h2 className="break-words text-2xl font-semibold">{name}</h2><p className="mt-1 text-sm text-[#7a6859]">{clientServiceLabel(client)}<span className={'ml-2 inline-flex rounded-full px-2 py-0.5 text-xs ' + (archived ? 'bg-[#eee4d9]' : 'bg-emerald-50 text-emerald-900')}>{archived ? 'Archives' : 'Suivi actif'}</span></p></div><div className="flex flex-wrap items-center gap-2">{administrative && <button type="button" className={buttonClass('secondary')} onClick={() => void onNavigate('billing', { client: client.id })}>Facturation de ce client</button>}<button type="button" aria-label="Actualiser la fiche" className={buttonClass('ghost')} disabled={loading} onClick={() => void navigation.canLeave().then(allowed => { if (allowed) void Promise.all([load(), onUpdated()]) })}><RefreshCw size={17} /></button></div></header>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}{loading && !overview && <p role="status">Ouverture de la fiche autorisée…</p>}
    {overview && <>
      <div className="grid items-start gap-4 xl:grid-cols-2"><ClientDataSection overview={overview} professionals={clientResponsibleNames(workspace, client)} status={archived ? 'Fermé · archives' : 'Suivi actif'} onEdit={() => setEditing('profile')} /><div ref={requestersRef}><ClientPeopleSection overview={overview} administration={workspace.context === 'administration'} open={requestersOpen} onEdit={next => { setPerson(next); setEditing('person') }} onRemove={target => void removePerson(target)} onEditMandatePayer={target => { const panel = mandateRef.current; panel?.scrollIntoView({ behavior: 'smooth', block: 'start' }); const detail = panel?.querySelector<HTMLElement>('[data-mandate-person-ids]'); const personIds = detail?.dataset.mandatePersonIds?.split(',') ?? []; const button = detail?.querySelector<HTMLButtonElement>('[data-edit-mandate]'); if (personIds.includes(target.id) && button) button.click(); else setError('Choisissez le mandat correspondant à ce payeur, puis cliquez sur « Modifier le mandat ».') }}><ClientBillingResponsibles client={client} overview={overview} workspace={workspace} onUpdated={committed} onAccessDenied={accessDenied} /></ClientPeopleSection></div></div>
      <div ref={mandateRef}><ClientFileSection title="Mandat et consentement"><ClientMandates key={'consent:' + contentRevision} workspace={workspace} clientId={client.id} requesterFile={overview} mode="consent" onNavigate={moduleNavigate} onUpdated={committed} onEditProfile={overview.canEditProfile?()=>setEditing('profile'):undefined} onEditRequesters={() => { setRequestersOpen(true); requestAnimationFrame(() => requestersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }} /><ClientLifecycleSection overview={overview} workspace={workspace} onCommitted={committed} onAccessDenied={accessDenied} embedded /></ClientFileSection></div>
      <section className={clinicalCard + ' min-w-0 !p-3 sm:!p-5'}><div role="tablist" aria-label="Contenu du dossier client" className="mb-5 flex flex-wrap gap-1 border-b border-[#eadfd2] pb-3">{clientFileTabs(workspace.context).map(item => <button type="button" role="tab" key={item.id} id={'client-tab-' + item.id} aria-selected={tab === item.id} aria-controls={'client-panel-' + item.id} className={buttonClass(tab === item.id ? 'primary' : 'ghost')} onClick={() => void select(item.id, { record: null, note: null, appointment: null, returnTo: null })}>{item.label}</button>)}</div>
        <div role="tabpanel" id={'client-panel-' + tab} aria-labelledby={'client-tab-' + tab} className="min-w-0">
          {tab === 'activities' && (workspace.durable ? <ClientCalendar key={contentRevision} workspace={workspace} embeddedClientId={client.id} onNavigate={moduleNavigate} onUpdated={onUpdated} /> : <p className="text-sm text-[#8a6f5d]">Le calendrier intégré nécessite la base locale persistante. Les données de démonstration ne sont pas transformées en rendez-vous durables.</p>)}
          {tab === 'notes' && workspace.context === 'clinical' && <ClientNotesSection clientId={client.id} workspace={workspace} recordId={query.get('record')} noteId={query.get('note')} appointmentId={query.get('appointment')} onBackToFile={() => void backFromNotes()} onUpdated={onUpdated} />}
          {tab === 'documents' && <div className="grid gap-5"><ClientMandates key={'documents:' + contentRevision} workspace={workspace} clientId={client.id} mode="documents" onNavigate={moduleNavigate} onUpdated={onUpdated} /><ClientFileDocuments overview={overview} workspace={workspace} onCommitted={committed} onAccessDenied={accessDenied} /></div>}
          {tab === 'communications' && <div className="grid gap-5"><ClientMandates key={'communications:' + contentRevision} workspace={workspace} clientId={client.id} mode="communications" onNavigate={moduleNavigate} onUpdated={onUpdated} /><ClientFileCommunications overview={overview} /></div>}
        </div>
      </section>
      <ClientAdministrationSections client={client} workspace={workspace} onUpdated={committed} onAccessDenied={accessDenied} />
      {editing === 'profile' && overview.canEditProfile && <ClientProfileEditor clientId={client.id} profile={overview.profile} workspace={workspace} onCancel={() => setEditing(null)} onCommitted={committed} onAccessDenied={accessDenied} />}
      {editing === 'person' && (person ? person.canEdit : overview.canAddPerson) && <ClientPersonEditor key={person?.id ?? 'new'} clientId={client.id} person={person} clientProfile={overview.profile} existingPeople={overview.contacts} workspace={workspace} onCancel={() => setEditing(null)} onCommitted={committed} onAccessDenied={accessDenied} />}
    </>}
  </article>
}
