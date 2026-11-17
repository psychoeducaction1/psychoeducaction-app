'use client'

import { clinicalUiText } from '@/lib/clinical-workspace/presentationText'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { CalendarDays, ClipboardList, FileSignature, FlaskConical, History, LayoutDashboard, LogOut, RotateCw, ShieldCheck, UserCheck, Users, WalletCards } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import { hasCapability } from '@/lib/clinical-core/capabilities'
import type { ClientAdminProjection, ClinicalAccessContext, FixtureActor, WorkspaceView } from '@/lib/clinical-core/types'
import { ClinicalApiError, clinicalRequest } from '@/lib/clinical-workspace/api'
import { canonicalWorkspaceDestination, isAdmissionSection, refreshWorkspaceWhenSafe, safeWorkspaceReturn, workspaceHref, workspaceNavigationGroups, workspaceRoute, type WorkspaceSection } from '@/lib/clinical-workspace/navigation'
import { ClinicalNavigationGuard, useClinicalHistory, useClinicalNavigation } from './NavigationGuard'
import { ClientList } from './ClientList'
import { ConsentReminders } from '@/components/clinical-mandates/ConsentReminders'
import { ClientAdministrativePanel } from './ClientAdministrativePanel'
import { ClientManagementPanel } from './ClientManagementPanel'
import { clientDirectoryReturn, type ClientDirectoryStatus } from './clientFileModel'
import { ClinicalRecordPanel } from './ClinicalRecordPanel'
import { ClinicalAuditJournal } from './ClinicalAuditJournal'
import { clinicalCard, clinicalInput } from './styles'
import { PendingProfessionalAgreement, ProfessionalWorkspace } from './ProfessionalWorkspace'

import { ClinicSettingsPanel } from './ClinicSettingsPanel'
import { AdministrationDashboard } from './AdministrationDashboard'
import { isDurableIdentity, workspaceMatchesIdentity } from '@/lib/clinical-workspace/workspaceIdentity'
import { isUnifiedClinicalClient, loadUnifiedIdentity, signOutUnifiedSession, UnifiedSessionError } from '@/lib/clinical-unification/authClient'
import { unifiedOperationalDestination } from '@/lib/clinical-unification/routes'

const MigrationCentre = dynamic(() => import('@/components/clinical-migration/MigrationCentre'), { loading: () => <p role="status">Ouverture de la migration…</p> })
const DurableBilling = dynamic(() => import('@/components/clinical-billing/ClinicalBillingWorkspace').then(value => value.ClinicalBillingWorkspace), { loading: () => <p role="status">Ouverture de la facturation…</p> })
const MandatesModule = dynamic(() => import('@/components/clinical-mandates/MandatesWorkspace').then(value => value.MandatesWorkspace), { loading: () => <p role="status">Ouverture du dossier client…</p> })
const AdmissionModule = dynamic(() => import('@/components/clinical-admission/AdmissionModule').then(value => value.AdmissionModule), { loading: () => <p role="status">Ouverture de l’admission…</p> })
const DurableCalendar = dynamic(() => import('@/components/clinical-calendar/CalendarWorkspace').then(value => value.CalendarWorkspace), { loading: () => <p role="status">Ouverture du calendrier…</p> })
const OfficeCalendar = dynamic(() => import('@/components/clinical-calendar/CalendarWorkspace').then(value => value.OfficeCalendarWorkspace), { loading: () => <p role="status">Ouverture des bureaux…</p> })
const CalendarPanel = dynamic(() => import('./CalendarPanel'), { loading: () => <p role="status">Ouverture du prototype d’agenda…</p> })
const BillingPanel = dynamic(() => import('./BillingPanel'), { loading: () => <p role="status">Ouverture du prototype financier…</p> })
const tabs = [{ id: 'home', label: 'Tableau de bord', icon: LayoutDashboard }, { id: 'clients', label: 'Dossiers clients', icon: ClipboardList }, { id: 'professionals', label: 'Préférences des professionnels', icon: Users }, { id: 'my-profile', label: 'Mon profil', icon: UserCheck },
  { id: 'mandates', label: 'Mandats et consentements', icon: FileSignature }, { id: 'calendar', label: 'Calendriers des professionnels', icon: CalendarDays },
  { id: 'offices', label: 'Disponibilité des bureaux', icon: CalendarDays }, { id: 'billing', label: 'Facturation et paiements', icon: WalletCards }, { id: 'timeline', label: 'Journal d’audit', icon: History }, { id: 'migration', label: 'Migration des données', icon: ClipboardList }, { id: 'clinic-settings', label: 'Paramètres de la clinique', icon: ShieldCheck },
  { id: 'calls', label: 'Prospects et appels', icon: CalendarDays }, { id: 'waiting', label: 'Liste d’attente', icon: ClipboardList },
  { id: 'processes', label: 'Assignations en cours', icon: ClipboardList }, { id: 'tasks', label: 'Tâches administratives', icon: ClipboardList }, { id: 'requests', label: 'Demandes professionnelles', icon: ClipboardList },
  { id: 'preferences', label: 'Préférences de jumelage', icon: UserCheck }, { id: 'assignments', label: 'Clients assignés', icon: ClipboardList },
  { id: 'admission-history', label: 'Historique des assignations', icon: History }] as const
const allowed = (actor: FixtureActor, context: ClinicalAccessContext) => context === 'administration' ? hasCapability(actor, 'administration') : hasCapability(actor, 'practice') || hasCapability(actor, 'supervision')
type Identity = { mode: 'isolated_fixture'; actors: FixtureActor[] } | { mode: 'isolated_local' | 'isolated_stage' | 'isolated_unified'; actor: FixtureActor }

export function ClinicalWorkspace({ realApplication = false }: { realApplication?: boolean }) { return <Suspense fallback={<p role="status" className="p-8">Ouverture de votre espace…</p>}><ClinicalNavigationGuard><WorkspaceShell realApplication={realApplication} /></ClinicalNavigationGuard></Suspense> }

function WorkspaceShell({ realApplication }: { realApplication: boolean }) {
  const navigation = useClinicalNavigation()
  const writeHistory = useClinicalHistory()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const route = useMemo(() => workspaceRoute(pathname, new URLSearchParams(params.toString())), [pathname, params])
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null)
  const [refreshSequence, setRefreshSequence] = useState(0)
  const [error, setError] = useState('')
  const [bootError, setBootError] = useState('')
  const [loading, setLoading] = useState(true)
  const requestSequence = useRef(0)
  const actor = identity?.mode === 'isolated_fixture' ? identity.actors.find(item => item.id === route.actorId) ?? identity.actors.find(item => allowed(item, route.context)) : identity?.actor
  const actorId = actor?.id
  const permitted = Boolean(actor && allowed(actor, route.context))
  const active = workspace && workspace.actor.id === actorId && workspace.context === route.context && permitted ? workspace : null
  const section = route.section
  const selected = active?.clients.find(client => client.id === route.clientId) ?? (!active?.durable && !route.clientId ? active?.clients[0] : undefined)
  const record = route.recordId ? active?.records.find(item => item.id === route.recordId && (!selected || item.clientId === selected.id)) : undefined

  useEffect(() => {
    if (route.context !== 'clinical' || route.section !== 'clients' || route.clientId || params.get('view') !== 'assignments') return
    const legacyQuery = new URLSearchParams(params.toString())
    legacyQuery.delete('view')
    if (legacyQuery.has('assignmentView')) {
      if (!legacyQuery.has('tab')) legacyQuery.set('tab', legacyQuery.get('assignmentView') ?? 'active')
      legacyQuery.delete('assignmentView')
    }
    router.replace(workspaceHref('clinical', 'assignments', Object.fromEntries(legacyQuery)))
  }, [params, route.clientId, route.context, route.section, router])

  useEffect(() => {
    const controller = new AbortController()
    const options = { cache: 'no-store' as const, credentials: 'same-origin' as const, redirect: 'error' as const, signal: controller.signal }
    void (async () => {
      try {
        if (isUnifiedClinicalClient()) {
          const resolved = await loadUnifiedIdentity(route.context, controller.signal)
          if (!controller.signal.aborted) setIdentity(resolved)
          return
        }
        const fixtureResponse = await fetch('/api/clinical-workspace/actors', options)
        const fixture = await fixtureResponse.json().catch(() => null)
        if (fixtureResponse.ok && fixture?.mode === 'isolated_fixture' && Array.isArray(fixture.actors)) {
          if (!controller.signal.aborted) setIdentity({ mode: 'isolated_fixture', actors: fixture.actors })
          return
        }
        const response = await fetch('/api/lab-auth/session', options)
        if (response.status === 401) { router.replace(`/connexion?retour=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`); return }
        const payload = await response.json().catch(() => null)
        if (!response.ok || !['isolated_local', 'isolated_stage'].includes(payload?.mode) || payload?.durable !== true || !payload.actor) throw new Error('Connexion indisponible. Réessayez ou reconnectez-vous.')
        if (!controller.signal.aborted) setIdentity({ mode: payload.mode, actor: payload.actor })
      } catch (cause) { if (!controller.signal.aborted) {
        if (cause instanceof UnifiedSessionError && cause.status === 401) {
          router.replace(`/connexion?retour=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`)
          return
        }
        setBootError(cause instanceof Error ? cause.message : 'Ouverture impossible.'); setLoading(false)
      } }
    })()
    return () => controller.abort()
  }, [router, route.context])

  const reload = useCallback(async (signal?: AbortSignal, onSuccess?: () => void) => {
    if (!actorId || !permitted) return
    const sequence = ++requestSequence.current
    setLoading(true)
    try {
      const payload = await clinicalRequest<{ workspace: WorkspaceView }>({ actorId, context: route.context }, '', undefined, 'GET', signal)
      if (!signal?.aborted && sequence === requestSequence.current) {
        if (!workspaceMatchesIdentity(identity?.mode, payload.workspace) || payload.workspace.actor.id !== actorId || payload.workspace.context !== route.context) {
          setWorkspace(null)
          throw new Error(clinicalUiText("Votre session a changé. Reconnectez-vous.","Votre accès a changé. Reconnectez-vous à l’application."))
        }
        setWorkspace(payload.workspace); setError(''); onSuccess?.()
      }
    } catch (cause) {
      if (signal?.aborted || sequence !== requestSequence.current) return
      if (cause instanceof ClinicalApiError && cause.status === 403) setWorkspace(null)
      if (cause instanceof ClinicalApiError && cause.status === 401) { setWorkspace(null); router.replace(`/connexion?raison=session-expiree-app&retour=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`); return }
      setError(cause instanceof Error ? cause.message : 'Les données n’ont pas pu être actualisées. Les écritures confirmées restent enregistrées.')
    } finally { if (!signal?.aborted && sequence === requestSequence.current) setLoading(false) }
  }, [actorId, permitted, route.context, router, identity])
  useEffect(() => { const controller = new AbortController(); void reload(controller.signal); return () => controller.abort() }, [reload])

  const navigate = async (next: WorkspaceSection, query: Record<string, string | null | undefined> = {}, context = route.context, ignoreForms = false) => {
    if (!await navigation.canLeave({ ignoreForms })) return
    const target = canonicalWorkspaceDestination(context, next, query)
    const href = workspaceHref(context, target.section, { ...(identity?.mode === 'isolated_fixture' ? { actor: actorId } : {}), recherche: route.search || null, page: route.page ? String(route.page + 1) : null, ...(target.section === 'clients' ? { directoryStatus: params.get('directoryStatus') } : {}), ...target.query })
    const targetUrl = new URL(href, window.location.origin)
    const operational = isUnifiedClinicalClient() ? unifiedOperationalDestination(context, targetUrl.pathname.split('/').filter(Boolean).slice(1), targetUrl.searchParams) : null
    // These aliases stay inside the existing workspace, like its profile tabs.
    if (operational?.startsWith('/clinique/mon-profil?')) writeHistory(operational)
    else if (operational) router.push(operational)
    else if (target.section === 'note-page') router.push(href)
    else writeHistory(href)
    if ((operational ?? href) === window.location.pathname + window.location.search
      && window.location.pathname === '/clinique/mon-profil' && new URLSearchParams(window.location.search).has('tab')) {
      document.getElementById('professional-profile-sections')?.scrollIntoView({ block: 'start' })
    }
  }
  const filter = (search: string, page: number) => {
    const url = new URL(window.location.href)
    if (search) url.searchParams.set('recherche', search); else url.searchParams.delete('recherche')
    if (page) url.searchParams.set('page', String(page + 1)); else url.searchParams.delete('page')
    writeHistory(`${url.pathname}${url.search}`, true)
  }
  const changeActor = async (id: string) => {
    if (identity?.mode !== 'isolated_fixture') return
    const target = identity.actors.find(item => item.id === id)
    if (!target || !await navigation.canLeave()) return
    const context = allowed(target, route.context) ? route.context : hasCapability(target, 'administration') ? 'administration' : 'clinical'
    writeHistory(workspaceHref(context, 'clients', { actor: id }))
  }
  const created = async (client: ClientAdminProjection) => { await reload(); await navigate('clients', { client: client.id, clientTab: 'activities', clientMode: null, record: null, note: null, appointment: null }, route.context, true) }
  const clientDirectory = (view: WorkspaceView) => <ClientList workspace={view} selectedId={null} onSelect={id => void navigate('clients', { client: id, view: null, clientTab: 'activities', record: null, note: null, appointment: null, clientMode: null })} onCreated={created} onUpdated={reload} search={route.search} page={route.page} status={(['active', 'archived', 'all'].includes(params.get('directoryStatus') ?? '') ? params.get('directoryStatus') : 'active') as ClientDirectoryStatus} onStatusChange={value => void navigate('clients', { directoryStatus: value, page: null })} onSearchChange={value => filter(value, 0)} onPageChange={value => filter(route.search, value)} />
  const logout = async () => {
    if (!await navigation.canLeave()) return
    try {
      if (isUnifiedClinicalClient()) await signOutUnifiedSession()
      else { const response = await fetch('/api/lab-auth/session', { method: 'DELETE', credentials: 'same-origin', redirect: 'error' }); if (!response.ok) throw new Error('La déconnexion locale n’a pas pu être confirmée.') }
      setWorkspace(null); setIdentity(null); router.replace('/connexion')
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Déconnexion impossible.') }
  }
  const menu = tabs.filter(item => !['mandates', 'admission-history'].includes(item.id) && (route.context !== 'administration' || !['requests', 'preferences', 'assignments'].includes(item.id)) && (!['professionals', 'clinic-settings', 'migration'].includes(item.id) || route.context === 'administration') && (item.id !== 'my-profile' || route.context === 'clinical')
    && (item.id !== 'migration' || process.env.NEXT_PUBLIC_PEA_CONTROLLED_MERGE !== 'true' || process.env.NEXT_PUBLIC_PEA_CLINICAL_IMPORT_ENABLED === 'true' || process.env.NEXT_PUBLIC_PEA_MIGRATION_PREVIEW === 'true')
    && (route.context !== 'clinical' || !['home', 'calendar', 'timeline', 'preferences'].includes(item.id))
    && (!isAdmissionSection(item.id) || isDurableIdentity(identity?.mode))
    && (route.context === 'administration' || !['calls', 'waiting', 'processes', 'tasks'].includes(item.id)))
  const menuGroups = workspaceNavigationGroups(route.context, menu.map(item => item.id))
  const menuSection = route.context === 'clinical' && section === 'my-profile'
    ? route.tab === 'clients' || route.tab === 'assignments' ? 'assignments' : route.tab === 'requests' ? 'requests' : section
    : section
  const unavailable = false

  return <div className="min-h-screen bg-[#f8f3ec] text-[#332820]">
    {!realApplication && <div className="border-b border-[#ddc7a8] bg-[#f3e3cd] px-4 py-2.5 text-center text-xs font-medium text-[#6d472b]"><FlaskConical size={15} className="mr-2 inline" />{identity?.mode === 'isolated_local' ? 'Laboratoire isolé · essais fictifs avec archives réelles en lecture seule pour l’administration · aucun envoi ni paiement réel' : 'Version test isolée · dossiers entièrement fictifs · aucun envoi ni paiement réel'}</div>}
    <aside aria-label={route.context === 'administration' ? 'Espace Administration' : 'Espace Clinique'} className={`border-b border-[#eadfd2] bg-[#fffdf9] lg:fixed lg:inset-y-0 ${realApplication ? 'lg:top-0' : 'lg:top-[37px]'} lg:flex lg:w-64 lg:flex-col lg:overflow-hidden lg:border-r`}>
      <div className="flex items-center gap-3 px-4 py-3 lg:shrink-0 lg:flex-col lg:items-start lg:px-5 lg:py-4"><Image src="/psychoeducaction-logo.svg" alt="PsychoÉducAction" width={205} height={76} priority className="h-auto w-28 lg:w-32" /><p className="min-w-0 break-words font-semibold text-[#8a5633]">{route.context === 'administration' ? 'Administration' : actor?.displayName ?? 'Mon profil'}</p></div>
      <nav aria-label="Navigation clinique" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-4 lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-contain">{menuGroups.map(group => <div key={group.id} role="group" aria-label={group.label} className="flex shrink-0 gap-1 lg:grid"><p className="hidden px-3 text-[11px] font-semibold uppercase tracking-wide text-[#8a6f5d] lg:block">{group.label}</p>{group.sections.map(id => {
        const item = menu.find(value => value.id === id)!
        return <button key={item.id} onClick={() => void navigate(item.id)} aria-current={menuSection === item.id ? 'page' : undefined} className={'flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8a5633] ' + (menuSection === item.id ? 'bg-[#8a5633] text-white' : 'text-[#6c5a4d] hover:bg-[#f5ebe0]')}><item.icon size={18} className="shrink-0" />{item.id === 'calendar' ? route.context === 'clinical' ? 'Mon calendrier' : 'Calendriers des professionnels' : item.id === 'billing' && route.context === 'clinical' ? 'Mes honoraires' : item.id === 'clients' && route.context === 'clinical' ? 'Mes clients' : item.id === 'assignments' && route.context === 'clinical' ? 'Mes assignations' : item.label}</button>
      })}</div>)}</nav>
      <div className="shrink-0 border-t border-[#eadfd2] px-4 py-3 text-[11px] leading-5 text-[#8a6f5d]"><span className="hidden lg:inline"><ShieldCheck size={16} className="mr-1 inline" />Les accès administratifs et cliniques sont indépendants.</span>{isDurableIdentity(identity?.mode) && <button className="mt-2 flex items-center gap-1 text-sm" onClick={() => void logout()}><LogOut size={14} />Déconnexion</button>}</div>
    </aside>
    <main className="min-w-0 p-4 sm:p-6 lg:ml-64 lg:p-8"><div className="mx-auto max-w-[1500px]">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">{!(section === 'clients' && route.clientId) && <h1 className="text-2xl font-semibold">{section === 'note-page' ? 'Note d’évolution' : section === 'mandates' ? 'Dossiers clients' : section === 'professionals' && route.professionalFileId ? 'Profil professionnel' : section === 'clients' && route.context === 'clinical' ? 'Mes clients' : section === 'assignments' && route.context === 'clinical' ? 'Mes assignations' : section === 'billing' && route.context === 'clinical' ? 'Mes honoraires' : tabs.find(item => item.id === section)?.label ?? 'Page indisponible'}</h1>}
        <div className="flex flex-wrap items-end gap-2">{identity?.mode === 'isolated_fixture' && <label className="grid gap-1 text-xs">Identité fictive pour les essais<select aria-label="Identité fictive pour les essais" value={actorId ?? ''} onChange={event => void changeActor(event.target.value)} className={clinicalInput}>{identity.actors.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>}
          {actor && allowed(actor, 'administration') && allowed(actor, 'clinical') && <div className="flex gap-1" aria-label="Choisir un espace"><button className={buttonClass(route.context === 'administration' ? 'primary' : 'secondary')} onClick={() => void navigate('home', {}, 'administration')}>Administration</button><button className={buttonClass(route.context === 'clinical' ? 'primary' : 'secondary')} onClick={() => void navigate('my-profile', {}, 'clinical')}>Mon profil</button></div>}
          {!(section === 'clients' && route.clientId) && <button className={`${buttonClass('secondary')} !px-3`} aria-label="Actualiser" disabled={loading || !permitted} onClick={() => void refreshWorkspaceWhenSafe(() => navigation.canLeave(), () => reload(undefined, () => setRefreshSequence(value => value + 1)))}><RotateCw size={18} /></button>}
        </div>
      </header>
      {(error || bootError) && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{bootError || error}</p>}
      {identity && !permitted && <section className={clinicalCard}><h2 className="font-semibold">Cet espace n’est pas autorisé pour ce compte.</h2><p className="mt-2 text-sm">La navigation ne modifie jamais vos habilitations.</p><button className={`${buttonClass('secondary')} mt-4`} onClick={() => void navigate('home', {}, allowed(actor!, 'administration') ? 'administration' : 'clinical')}>Ouvrir mon espace autorisé</button></section>}
      {loading && !active && !bootError && permitted && <p role="status">Chargement des données autorisées…</p>}
      {!identity && !bootError && <p role="status">Vérification du mode et de la session locale…</p>}
      {active && <div key={`${active.actor.id}:${active.context}:${refreshSequence}`}>
        {!section && <section className={clinicalCard}>{clinicalUiText("Cette route du laboratoire n’est pas disponible.","Cette page n’est pas disponible.")}</section>}
        {section === 'home' && route.context === 'administration' && <AdministrationDashboard actorId={active.actor.id} onNavigate={(next, query) => void navigate(next, query)} />}
        {section === 'home' && route.context === 'clinical' && <><ConsentReminders workspace={active} onNavigate={navigate} /><PendingProfessionalAgreement workspace={active} onNavigate={(next, query) => navigate(next, query)} /></>}
        {unavailable && <section className={clinicalCard}><h2 className="font-semibold">Cette section est indisponible.</h2><p className="mt-3 text-sm">Actualisez la page ou réessayez plus tard.</p></section>}
        {section === 'clients' && (active.durable ? route.clientId ? selected ? <ClientAdministrativePanel key={selected.id} client={selected} workspace={active} onUpdated={reload} onNavigate={(next, query) => navigate(next, query)} onBack={() => void navigate('clients', clientDirectoryReturn(new URLSearchParams(params.toString())))} />
          : <section role="alert" className={clinicalCard}>Client introuvable ou non autorisé.<button type="button" className={buttonClass('ghost')} onClick={() => void navigate('clients', clientDirectoryReturn(new URLSearchParams(params.toString())))}>Retour au répertoire</button></section>
          : route.context === 'clinical' ? params.get('view') === 'assignments' ? <p role="status">Ouverture de mes assignations…</p> : <AdmissionModule workspace={active} section="clients" professionalId={active.actor.id} embedded onNavigate={(next, query) => navigate(next, query)} onUpdated={reload} />
          : <div className="grid gap-4"><div role="tablist" aria-label="Dossiers clients" className="flex flex-wrap gap-2"><button role="tab" aria-selected={params.get('view') === 'assignments'} className={buttonClass(params.get('view') === 'assignments' ? 'primary' : 'secondary')} onClick={() => void navigate('clients', { view: 'assignments', tab: 'active', assignment: null, page: null })}>Clients assignés</button><button role="tab" aria-selected={params.get('view') !== 'assignments'} className={buttonClass(params.get('view') === 'assignments' ? 'secondary' : 'primary')} onClick={() => void navigate('clients', { view: null, tab: null, assignment: null, page: null })}>Dossiers clients</button></div>{params.get('view') === 'assignments' ? <AdmissionModule workspace={active} section="assignments" onNavigate={(next, query) => navigate(next, query)} onUpdated={reload} /> : clientDirectory(active)}</div>
          : <div className="grid items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]"><ClientList workspace={active} selectedId={selected?.id ?? null} onSelect={id => void navigate('clients', { client: id })} onCreated={created} search={route.search} page={route.page} status="all" onSearchChange={value => filter(value, 0)} onPageChange={value => filter(route.search, value)} /><div className="min-w-0">{route.recordId ? record ? <ClinicalRecordPanel key={record.id + ':' + (params.get('note') ?? '') + ':' + (params.get('appointment') ?? '')} record={record} workspace={active} initialNoteId={params.get('note')} initialAppointmentId={params.get('appointment')} onBack={() => { const destination = safeWorkspaceReturn(params.get('returnTo')); if (destination) writeHistory(destination); else void navigate('clients', { client: record.clientId }) }} onUpdated={reload} /> : <section role="alert" className={clinicalCard}>Ce dossier est introuvable ou ne vous est plus autorisé.</section> : selected ? <ClientManagementPanel key={selected.id} client={selected} workspace={active} onUpdated={reload} onOpenAdmission={() => void navigate('waiting', { client: selected.id })} onOpenMandates={episodeId => void navigate('clients', { client: selected.id, episode: episodeId ?? null, clientMode: null })} onOpenCalendar={() => void navigate('calendar', { client: selected.id })} onOpenRecord={item => void navigate('clients', { client: item.clientId, record: item.id })} /> : <section className={clinicalCard}>Sélectionnez une identité fictive dans le prototype mémoire.</section>}</div></div>)}
        {(section === 'professionals' && route.context === 'administration' || section === 'my-profile' && route.context === 'clinical') && active.durable && <ProfessionalWorkspace workspace={active} onCanonicalLink={slug => { const url=new URL(window.location.href); url.pathname='/administration/professionnels/'+slug; writeHistory(url.pathname+url.search,true) }} professionalId={route.professionalFileId} search={route.search} page={route.page} status={params.get('professionalStatus') ?? 'active'} tab={route.tab} onNavigate={(next, query) => navigate(next, query)} onSearchChange={value => filter(value, 0)} onPageChange={value => filter(route.search, value)} onStatusChange={value => void navigate('professionals', { professionalStatus: value, tab: route.tab, page: null })} onUpdated={reload} />}
        {section === 'migration' && route.context === 'administration' && <MigrationCentre />}
        {section === 'clinic-settings' && route.context === 'administration' && <ClinicSettingsPanel workspace={active} onNavigate={(next, query) => navigate(next, query)} />}
        {section === 'calendar' && !unavailable && (active.durable ? <DurableCalendar key={active.actor.id + ':' + active.context} workspace={active} onNavigate={(next, query) => navigate(next, query)} onUpdated={reload} /> : <CalendarPanel actorId={active.actor.id} context={active.context} />)}
        {section === 'offices' && (active.durable ? <OfficeCalendar workspace={active} onNavigate={(next, query) => navigate(next, query)} onUpdated={reload} /> : <section className={clinicalCard}>Les bureaux ne sont pas disponibles dans cette session.</section>)}
        {section === 'billing' && (active.durable ? <DurableBilling actorId={active.actor.id} context={active.context} /> : <BillingPanel actorId={active.actor.id} context={active.context} />)}
        {section === 'timeline' && route.context === 'administration' && <ClinicalAuditJournal workspace={active} />}
        {section === 'timeline' && route.context !== 'administration' && <section role="alert" className={clinicalCard}>Le journal d’audit est réservé à la direction et à l’administration.</section>}
        {section === 'mandates' && <MandatesModule key={active.actor.id + ':' + active.context} workspace={active} onNavigate={(next, query) => navigate(next, query)} onUpdated={reload} />}
        {isAdmissionSection(section) && <AdmissionModule key={active.actor.id + ':' + active.context + ':' + section} workspace={active} section={section} onNavigate={(next, query) => navigate(next, query)} onUpdated={reload} />}
      </div>}
    </div></main>
  </div>
}
