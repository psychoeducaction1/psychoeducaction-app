'use client'

import { clinicalUiText } from '@/lib/clinical-workspace/presentationText'
import { uniqueProfessionalSlug, professionalRequestTarget, professionalTargetMatches, professionalCanonicalTarget, retainsProfessionalTabProjection, type ProfessionalRouteAlias } from '@/lib/clinical-workspace/professionalLinks'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowLeft, FileText, Plus, Search, X } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import { SignatureCapture } from '@/components/clinical-mandates/SignatureCapture'
import { loadCalendar, runCalendarCommand } from '@/lib/clinical-calendar/durableClient'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import { clinicalRequest, isClinicalAccessDenied } from '@/lib/clinical-workspace/api'
import type { WorkspaceSection } from '@/lib/clinical-workspace/navigation'
import { clinicalCard, clinicalInput, clinicalLabel } from './styles'
import { ProfessionalSignaturePad, ProfessionalSignaturePreview } from './ProfessionalSignaturePad'
import { useClinicalFormGuard } from './NavigationGuard'
import { commandAdmission, fetchAdmission } from '@/lib/clinical-admission/client'
import type { AdmissionProfessional } from '@/lib/clinical-admission/types'
import { clientGroupOptions, formatAgeRanges, getOptionLabels, meetingModeOptions, motifOptions, officeLocationOptions, serviceTypeOptions, type ProfessionalStructuredPreferences } from '@/lib/professionalPreferences'
import { legacyPreferenceLabel, legacyPreferenceValue } from '@/lib/clinical-workspace/legacyPresentation'
import { isUnifiedClinicalClient } from '@/lib/clinical-unification/authClient'

const CalendarWorkspace = dynamic(() => import('@/components/clinical-calendar/CalendarWorkspace').then(m => m.CalendarWorkspace))
const NoteTemplatesPanel = dynamic(() => import('./NoteTemplatesPanel').then(m => m.NoteTemplatesPanel))
const ProfessionalServicesPanel = dynamic(() => import('./ProfessionalServicesPanel').then(m => m.ProfessionalServicesPanel))
const AdmissionModule = dynamic(() => import('@/components/clinical-admission/AdmissionModule').then(m => m.AdmissionModule))
const ProfessionalPreferencesEditor = dynamic(() => import('@/components/ProfessionalPreferencesEditor').then(m => m.ProfessionalPreferencesEditor))

type DirectoryEntry = { id: string; fullName: string; title: string; email: string; active: boolean; platformAccess: boolean; imported?: boolean; preferences?: ProfessionalStructuredPreferences; preferencesVersion?: number }
type InvitationPreview = { simulated: true; from: string; to: string; subject: string; body: string; actionLink: string }
type Document = { id: string; kind: string; label: string; fileName: string; sha256: string; createdAt: string; previousId: string | null }
type Agreement = { id: string; version: number; title: string; status: 'pending' | 'signed'; createdAt: string; signedAt: string | null; sha256: string; signedSha256: string | null }
type Office = { id: string; name: string; color: string; active: boolean; officeNumber: string; address: string; city: string; province: string; postalCode: string; version: number }
type Grant = { officeId: string; validFrom: string; validTo: string | null }
type Professional = DirectoryEntry & { version: number; prefix: string; phone: string; address: string; licenseNumber: string; correspondenceEmail: string; ivacProviderNumber: string; cnesstProviderNumber: string; registeredAt: string; preferences: Record<string, unknown>; legacyFields?: Record<string, unknown>; legacyAssignments?: { id: string; firstName: string; lastName: string; assignedDate: string | null; active: string | null; closed: string | null }[]; legacyRequests?: { id: string; createdAt: string | null; requestedCount: string | null; remainingCount: string | null; active: string | null; comment: string | null }[]; signature: { id: string; version: number; strokes: unknown; imageMediaType: string | null; imageBase64: string | null; createdAt: string } | null; documents: Document[]; agreements: Agreement[]; offices: Office[]; grants: Grant[]; availability: { weekday: number; startMinute: number; endMinute: number }[]; history: { id: string; action: string; at: string }[]; communications: { id: string; subject: string; status: string; at: string }[] }
type Data = { professional: Professional | null; professionals: DirectoryEntry[] }
type Tab = 'note-templates' | 'activities' | 'agreements' | 'services' | 'documents' | 'emails' | 'preferences' | 'requests' | 'assignments' | 'clients'
const adminTabs: { id: Tab; label: string }[] = [{ id: 'activities', label: 'Activités' }, { id: 'requests', label: 'Demande et disponibilités' }, { id: 'clients', label: 'Clients' }, { id: 'preferences', label: 'Préférences' }, { id: 'agreements', label: 'Ententes' }, { id: 'services', label: 'Paramètres des services individuels' }, { id: 'documents', label: 'Documents professionnels' }, { id: 'emails', label: 'Historique des courriels' }]
const clinicalTabs: { id: Tab; label: string }[] = [{ id: 'requests', label: 'Demande et disponibilités' }, { id: 'clients', label: 'Clients' }, { id: 'activities', label: 'Calendrier' }, { id: 'note-templates', label: 'Gabarits de notes' }, { id: 'preferences', label: 'Préférences de jumelage' }, { id: 'documents', label: 'Documents professionnels' }, { id: 'emails', label: 'Historique des courriels' }]
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' }).format(new Date(value)) : '—'
const fileUrl = (id: string, documentId: string, context: 'administration' | 'clinical') => `/api/clinical-workspace/professionals/${id}/documents/${documentId}/${context}/download`
const signedFileUrl = (id: string, documentId: string, context: 'administration' | 'clinical') => `/api/clinical-workspace/professionals/${id}/documents/${documentId}/${context}/signed/download`
const preferenceText = (values: string[], options: { value: string; label: string }[]) => getOptionLabels(values, options).join(', ') || '—'

function PreferenceSummary({ preferences }: { preferences: ProfessionalStructuredPreferences }) {
  const fields = [
    ['Services', preferenceText(preferences.pref_service_types, serviceTypeOptions)],
    ['Âges', formatAgeRanges(preferences.pref_age_ranges)],
    ['Clientèles', preferenceText(preferences.pref_client_groups, clientGroupOptions)],
    ['Modalités', preferenceText(preferences.pref_meeting_modes, meetingModeOptions)],
    ['Bureaux', preferenceText(preferences.pref_office_locations, officeLocationOptions)],
    ['Langues', preferences.pref_languages.join(', ') || '—'],
    ['Motifs', preferenceText(preferences.pref_motifs, motifOptions)],
    ['Exclusions', preferences.pref_exclusions || '—'],
    ['Précisions', preferences.pref_matching_notes || '—'],
  ]
  return <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">{fields.map(([label, value]) => <div key={label}><dt className="font-semibold text-[#795f4d]">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>
}

function PreferenceCardEditor({ initial, onSave, onCancel }: { initial: ProfessionalStructuredPreferences; onSave: (value: ProfessionalStructuredPreferences) => Promise<void>; onCancel: () => void }) {
  const formRef = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState<ProfessionalStructuredPreferences>(() => structuredClone(initial))
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useClinicalFormGuard(dirty, busy)
  useEffect(() => { formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [])
  const close = () => { if (!busy && (!dirty || window.confirm('Abandonner les modifications des préférences ?'))) onCancel() }
  return <div ref={formRef} className="mt-4 scroll-mt-24 border-t border-[#eadfd2] pt-4"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-semibold">Modifier les préférences</h3><button type="button" className={buttonClass('secondary')} disabled={busy} aria-label="Fermer la modification" onClick={close}><X size={17} /></button></div><ProfessionalPreferencesEditor value={value} onChange={next => { setValue(next); setDirty(true) }} />
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={buttonClass('primary')} disabled={busy || !dirty} onClick={async () => { setBusy(true); setError(''); try { await onSave(value) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Préférences non enregistrées.') } finally { setBusy(false) } }}>Enregistrer les préférences</button><button type="button" className={buttonClass('secondary')} disabled={busy} onClick={close}>Annuler</button></div>
  </div>
}

export function ProfessionalWorkspace({ workspace, professionalId, search, page, status, tab, onNavigate, onSearchChange, onPageChange, onStatusChange, onUpdated, onCanonicalLink }: {
  workspace: WorkspaceView; professionalId: string | null; search: string; page: number; status: string; tab: string | null;
  onNavigate: (section: WorkspaceSection, query?: Record<string, string | null>) => Promise<void>; onSearchChange: (value: string) => void; onPageChange: (value: number) => void;
  onStatusChange: (value: string) => void; onUpdated: () => Promise<void>; onCanonicalLink?: (slug: string, expectedTarget: string) => void
}) {
  const administrative = workspace.context === 'administration', target = administrative ? professionalId : 'self'
  const [routeAlias, setRouteAlias] = useState<ProfessionalRouteAlias | null>(null)
  const requestTarget = professionalRequestTarget(target, routeAlias)
  const requestGeneration = useRef(0)
  const [readTiming, setReadTiming] = useState('')
  useEffect(() => {
    // Download code for the selected tab while the protected profile read runs;
    // this performs no data request and grants no access.
    if (tab === 'requests' || tab === 'clients' || tab === 'assignments') void import('@/components/clinical-admission/AdmissionModule').catch(() => {})
    else if (tab === 'activities' || !tab) void import('@/components/clinical-calendar/CalendarWorkspace').catch(() => {})
  }, [tab])
  const actor = useMemo(() => ({ actorId: workspace.actor.id, context: workspace.context }), [workspace.actor.id, workspace.context])
  const [data, setData] = useState<Data | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [dataTarget, setDataTarget] = useState<string | null | undefined>(undefined)
  const [preferenceProfiles, setPreferenceProfiles] = useState<Pick<AdmissionProfessional, 'id' | 'preferences' | 'preferencesVersion'>[] | null>(null), [preferenceError, setPreferenceError] = useState('')
  const [serviceFilter, setServiceFilter] = useState(''), [modeFilter, setModeFilter] = useState(''), [officeFilter, setOfficeFilter] = useState('')
  const [editingPreferenceId, setEditingPreferenceId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false), [creating, setCreating] = useState(false), [newAccount, setNewAccount] = useState<{ id: string; password: string } | null>(null)
  const [changingSignature, setChangingSignature] = useState(false)
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null)
  const [agreementDraft, setAgreementDraft] = useState(false), [documentOpen, setDocumentOpen] = useState<string | null>(null)
  const sectionsRef = useRef<HTMLElement>(null)
  const displayedProfessionalId = data?.professional?.id
  useEffect(() => {
    if (tab && displayedProfessionalId) sectionsRef.current?.scrollIntoView({ block: 'start' })
  }, [tab, displayedProfessionalId])
  const reload = useCallback(async (signal?: AbortSignal) => {
    const generation = ++requestGeneration.current
    setLoading(true)
    const started = performance.now()
    try { const result = await clinicalRequest<Data>(actor, `/professionals${requestTarget ? '/' + requestTarget : ''}`, undefined, 'GET', signal)
      if (signal?.aborted || generation !== requestGeneration.current) return
      setReadTiming(JSON.stringify({ requestMs: Math.round(performance.now() - started), readyMs: Math.round(performance.now()) }))
      setRouteAlias(isUnifiedClinicalClient() && result.professional ? { id: result.professional.id, slug: uniqueProfessionalSlug(result.professional.id, result.professionals), requestTarget: requestTarget ?? result.professional.id } : null)
      setData(result); setDataTarget(requestTarget); setError('')
      if (administrative && !requestTarget) {
        try {
          const profiles = isUnifiedClinicalClient()
            ? result.professionals.flatMap(item => item.preferences && item.preferencesVersion ? [{ id: item.id, preferences: item.preferences, preferencesVersion: item.preferencesVersion }] : [])
            : (await fetchAdmission(actor, signal)).professionals
          if (!signal?.aborted && generation === requestGeneration.current) { setPreferenceProfiles(profiles); setPreferenceError('') }
        }
        catch (cause) { if (!signal?.aborted && generation === requestGeneration.current) { setPreferenceProfiles(null); setPreferenceError(cause instanceof Error ? cause.message : 'Préférences indisponibles.') } }
      } }
    catch (cause) { if (!signal?.aborted && generation === requestGeneration.current) { if (isClinicalAccessDenied(cause)) setData(null); setError(cause instanceof Error ? cause.message : 'Fiche indisponible.') } }
    finally { if (!signal?.aborted && generation === requestGeneration.current) setLoading(false) }
  }, [actor, requestTarget, administrative])
  useEffect(() => { const controller = new AbortController(); setData(null); setPreferenceProfiles(null); setInvitation(null); void reload(controller.signal); return () => controller.abort() }, [reload])
  useEffect(() => {
    const slug=isUnifiedClinicalClient() && administrative && data?.professional ? professionalCanonicalTarget(target,data.professional.id,data.professionals) : null
    if(slug && target) onCanonicalLink?.(slug,target)
  },[administrative,data,target,onCanonicalLink])
  const command = async (action: string, values: Record<string, unknown>) => {
    if (!target || !data?.professional || busy) return false
    setBusy(true); setError(''); setNotice('')
    try { await clinicalRequest(actor, `/professionals/${administrative ? data?.professional?.id : 'self'}/commands`, { action, data: values }, 'POST'); setNotice(clinicalUiText("Enregistré dans le laboratoire fictif.","Enregistré.")); await reload(); await onUpdated(); return true }
    catch (cause) { if (isClinicalAccessDenied(cause)) setData(null); setError(cause instanceof Error ? cause.message : 'Enregistrement non confirmé.'); return false }
    finally { setBusy(false) }
  }
  const prepareInvitation = async () => {
    if (!administrative || !pro || busy) return
    setBusy(true); setError(''); setInvitation(null)
    try {
      const prepared = await clinicalRequest<InvitationPreview>(actor, `/professionals/${pro.id}/invitation`, {}, 'POST')
      if (!prepared?.simulated || !prepared.actionLink) throw new Error('Invitation fictive non confirmée.')
      setInvitation(prepared)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invitation fictive indisponible.') }
    finally { setBusy(false) }
  }
  const pro = data?.professional
  if (administrative && data && (dataTarget !== requestTarget || (target ? !!pro && !professionalTargetMatches(target,pro.id,data.professionals) : !!pro))) return <p role="status">Ouverture du répertoire professionnel…</p>
  if (loading && !data) return <p role="status">Ouverture du répertoire professionnel…</p>
  if (error && !data) return <section role="alert" className={clinicalCard}>{error}</section>
  if (administrative && !professionalId) {
    // The supervisor and dual-role fixture accounts remain available for test
    // scenarios, but the migration directory shows one fictional professional.
    const hiddenLabFixtures = new Set(['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '8010ae3a-111d-4a08-ad03-4780e5171c8a'])
    const preferencesById = new Map((data?.professionals ?? []).filter(item => item.preferences).map(item => [item.id, item.preferences!]))
    for (const item of preferenceProfiles ?? []) preferencesById.set(item.id, item.preferences)
    const filtered = (data?.professionals ?? []).filter(item => {
      if (hiddenLabFixtures.has(item.id) || (status !== 'all' && (status === 'archived') !== !item.active)) return false
      const preferences = preferencesById.get(item.id)
      const searchable = `${item.fullName} ${item.title} ${item.email} ${preferences ? Object.values(preferences).flatMap(value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.map(String) : []).join(' ') : ''}`.toLocaleLowerCase('fr')
      return searchable.includes(search.toLocaleLowerCase('fr')) && (!serviceFilter || preferences?.pref_service_types.includes(serviceFilter)) && (!modeFilter || preferences?.pref_meeting_modes.includes(modeFilter)) && (!officeFilter || preferences?.pref_office_locations.includes(officeFilter))
    })
    const pages = Math.max(1, Math.ceil(filtered.length / 15)), current = Math.min(page, pages - 1)
    return <section className={clinicalCard}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Profils et préférences</h2><p className="mt-1 text-sm text-[#7a6859]">Consulter les préférences, ouvrir la fiche ou les modifier.</p></div><button className={buttonClass('primary')} onClick={() => setCreating(true)}><Plus size={17} />Ajouter</button></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]"><label className="relative"><span className="sr-only">Rechercher un professionnel</span><Search size={17} className="absolute left-3 top-3 text-[#8a6f5d]" /><input type="search" className={clinicalInput + ' !pl-9'} placeholder="Rechercher un professionnel…" value={search} onChange={event => onSearchChange(event.target.value)} /></label><select aria-label="Statut des professionnels" className={clinicalInput} value={status} onChange={event => onStatusChange(event.target.value)}><option value="active">Actifs</option><option value="archived">Archivés</option><option value="all">Tous</option></select></div>
      <div className="mt-3 grid gap-3 md:grid-cols-3"><label className={clinicalLabel}>Service<select className={clinicalInput} value={serviceFilter} onChange={event => { setServiceFilter(event.target.value); onPageChange(0) }}><option value="">Tous les services</option>{serviceTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className={clinicalLabel}>Modalité<select className={clinicalInput} value={modeFilter} onChange={event => { setModeFilter(event.target.value); onPageChange(0) }}><option value="">Toutes les modalités</option>{meetingModeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className={clinicalLabel}>Bureau<select className={clinicalInput} value={officeFilter} onChange={event => { setOfficeFilter(event.target.value); onPageChange(0) }}><option value="">Tous les bureaux</option>{officeLocationOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
      {preferenceError && <p role="alert" className="mt-4 text-sm text-red-700">Préférences indisponibles : {preferenceError}</p>}
      <div className="mt-5 grid gap-4">{filtered.slice(current * 15, (current + 1) * 15).map(item => {
        const admissionProfile = preferenceProfiles?.find(professional => professional.id === item.id)
        const preferences = preferencesById.get(item.id)
        return <article key={item.id} className="rounded-xl border border-[#eadfd2] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><button type="button" className="text-lg font-semibold text-[#8a5633] underline-offset-4 hover:underline focus-visible:underline" onClick={() => void onNavigate('professionals', { professional: item.id, professionalStatus: status, tab: tab === 'requests' ? 'requests' : 'activities' })}>{item.fullName}</button><p className="text-sm text-[#795f4d]">{item.title || 'Titre non renseigné'} · {item.imported ? 'Archive importée · original préservé' : item.active ? 'Actif' : 'Archivé'}</p></div><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass('secondary')} onClick={() => void onNavigate('professionals', { professional: item.id, professionalStatus: status, tab: 'activities' })}>Ouvrir le profil</button>{preferences && (item.imported || admissionProfile) && <button type="button" className={buttonClass('primary')} disabled={editingPreferenceId !== null} onClick={() => setEditingPreferenceId(item.id)}>{editingPreferenceId === item.id ? 'Modification en cours' : 'Modifier les préférences'}</button>}</div></div>{preferences ? <PreferenceSummary preferences={preferences} /> : <p className="mt-3 text-sm text-[#795f4d]">Préférences non renseignées.</p>}{editingPreferenceId === item.id && preferences && <PreferenceCardEditor initial={preferences} onSave={async value => {
          if (item.imported || isUnifiedClinicalClient()) await clinicalRequest(actor, `/professionals/${item.id}/commands`, { action: 'preferences.update', data: { expectedVersion: item.preferencesVersion ?? 0, preferences: value } }, 'POST')
          else if (admissionProfile) await commandAdmission(actor, 'preferences.update', item.id, { expectedVersion: admissionProfile.preferencesVersion, preferences: value })
          await reload(); setEditingPreferenceId(null)
        }} onCancel={() => setEditingPreferenceId(null)} />}</article>
      })}{!filtered.length && <p className="p-4 text-sm">Aucun professionnel pour ces critères.</p>}</div>
      {pages > 1 && <div className="mt-4 flex items-center justify-between text-sm"><button className={buttonClass('ghost')} disabled={!current} onClick={() => onPageChange(current - 1)}>Précédent</button><span>{current + 1} / {pages}</span><button className={buttonClass('ghost')} disabled={current >= pages - 1} onClick={() => onPageChange(current + 1)}>Suivant</button></div>}
      {creating && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><form className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onSubmit={async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>; setBusy(true); setError(''); try { const result = await clinicalRequest<{ id: string; temporaryPassword: string }>(actor, '/professionals/create', { fullName: values.fullName, email: values.email, title: values.title }, 'POST'); setNewAccount({ id: result.id, password: result.temporaryPassword }); setCreating(false); await reload() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Création impossible.') } finally { setBusy(false) } }}><h3 className="text-lg font-semibold">Ajouter un professionnel fictif</h3><p className="mt-1 text-xs">Adresse .invalid uniquement. Aucun courriel n’est envoyé.</p><label className={clinicalLabel + ' mt-4'}>Nom complet<input name="fullName" required maxLength={200} className={clinicalInput} /></label><label className={clinicalLabel + ' mt-3'}>Titre<input name="title" maxLength={160} className={clinicalInput} /></label><label className={clinicalLabel + ' mt-3'}>Courriel fictif<input name="email" required type="email" pattern=".+\.invalid" className={clinicalInput} /></label>{error && <p role="alert" className="mt-3 text-red-700">{error}</p>}<div className="mt-5 flex gap-2"><button className={buttonClass('primary')} disabled={busy}>Créer</button><button type="button" className={buttonClass('secondary')} onClick={() => setCreating(false)}>Annuler</button></div></form></div>}
      {newAccount && <div role="status" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"><strong>Compte fictif créé.</strong> Mot de passe temporaire affiché une seule fois : <code className="break-all">{newAccount.password}</code><button className={buttonClass('secondary') + ' mt-3'} onClick={() => { const id = newAccount.id; setNewAccount(null); void onNavigate('professionals', { professional: id }) }}>Ouvrir sa fiche</button></div>}
    </section>
  }
  if (!pro) return <section className={clinicalCard}>Ce profil est introuvable ou non autorisé.</section>
  if (pro.imported) return <div className="grid gap-5">
    <button className={buttonClass('ghost') + ' justify-self-start'} onClick={() => void onNavigate('professionals', { professionalStatus: status, tab: null })}><ArrowLeft size={16} />Retour au répertoire</button>
    <section className={clinicalCard}><h2 className="text-2xl font-semibold">{pro.fullName}</h2><p className="mt-2 text-sm text-[#806b5d]">Copie locale de l’ancienne fiche · consultation uniquement. Aucun accès clinique ni compte fictif n’est créé à partir de ces données.</p>
      <h3 className="mt-5 font-semibold">Données du professionnel</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{[['Nom', pro.fullName], ['Titre', pro.title], ['Courriel', pro.email], ['Téléphone', pro.phone], ['Adresse', pro.address], ['Permis / ordre', pro.licenseNumber], ['Inscription', dateLabel(pro.registeredAt)]].map(([label, value]) => <div key={label}><dt className="text-[#806b5d]">{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
      <h3 className="mt-6 font-semibold">Préférences de jumelage</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{Object.entries(pro.preferences).map(([key, value]) => <div key={key}><dt className="text-[#806b5d]">{legacyPreferenceLabel(key)}</dt><dd className="whitespace-pre-wrap break-words">{legacyPreferenceValue(value)}</dd></div>)}</dl>
      <h3 className="mt-6 font-semibold">Autres informations de l’ancienne fiche</h3><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{Object.entries(pro.legacyFields ?? {}).map(([label, value]) => <div key={label}><dt className="text-[#806b5d]">{label}</dt><dd className="whitespace-pre-wrap break-words">{legacyPreferenceValue(value)}</dd></div>)}</dl>
    </section>
    <section className={clinicalCard}><h3 className="font-semibold">Historique des assignations ({pro.legacyAssignments?.length ?? 0})</h3><p className="mt-1 text-xs text-[#806b5d]">{clinicalUiText("Historique copié pour consultation ; ces clients ne deviennent pas des dossiers cliniques du laboratoire.","Historique conservé en lecture seule. Les dossiers cliniques sont accessibles dans la section Clients.")}</p><div className="mt-3 grid gap-2">{pro.legacyAssignments?.map(item => <div key={item.id} className="rounded-xl border p-3 text-sm">{item.firstName} {item.lastName} · {item.assignedDate || 'Date inconnue'} · {item.closed === 'true' ? 'Dossier fermé' : item.active === 'false' ? 'Assignation inactive' : 'Active'}</div>)}</div>{!pro.legacyAssignments?.length && <p className="mt-3 text-sm">Aucune assignation historique.</p>}</section>
    <section className={clinicalCard}><h3 className="font-semibold">Demandes professionnelles historiques ({pro.legacyRequests?.length ?? 0})</h3><div className="mt-3 grid gap-2">{pro.legacyRequests?.map(item => <div key={item.id} className="rounded-xl border p-3 text-sm">{item.createdAt ? dateLabel(item.createdAt) : 'Date inconnue'} · {item.requestedCount ?? '—'} demandé(s) · {item.remainingCount ?? '—'} restant(s){item.comment && <p className="mt-1">{item.comment}</p>}</div>)}</div>{!pro.legacyRequests?.length && <p className="mt-3 text-sm">Aucune demande historique.</p>}</section>
  </div>
  const tabs = administrative ? adminTabs : clinicalTabs
  const selected: Tab = tab === 'assignments' ? 'clients' : tabs.some(item => item.id === tab) ? tab as Tab : 'activities'
  const pendingAgreement = pro.agreements.find(item => item.status === 'pending')
  const openFile = (id: string) => { setDocumentOpen(id); window.open(fileUrl(pro.id, id, workspace.context), '_blank', 'noopener,noreferrer') }
  const openSignedFile = (id: string) => window.open(signedFileUrl(pro.id, id, workspace.context), '_blank', 'noopener,noreferrer')
  return <div data-professional-load-timing={readTiming || undefined} className="grid gap-5">
    {administrative && <button className={buttonClass('ghost') + ' justify-self-start'} onClick={() => void onNavigate('professionals', { professionalStatus: status, tab: null })}><ArrowLeft size={16} />Retour au répertoire</button>}
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold">{pro.fullName}</h2><p className="text-sm text-[#7a6859]">{pro.title} · {pro.active ? 'Actif' : 'Archivé'}</p></div></div>
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <div className={'grid items-start gap-5 ' + (administrative ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : '')}><details key={pro.id} open={administrative ? true : undefined} className={clinicalCard}>
      <summary className="cursor-pointer text-lg font-semibold">Données du professionnel</summary>
      <div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" className={buttonClass('secondary')} onClick={() => setEditing(true)}>Modifier</button></div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{[['Inscription', dateLabel(pro.registeredAt)], ['Nom', pro.fullName], ['Titre', pro.title], ['Courriel professionnel', pro.email], ['Téléphone', pro.phone], ['Adresse', pro.address], ['Permis / ordre', pro.licenseNumber], ['Numéro de fournisseur IVAC', pro.ivacProviderNumber], ['Numéro de fournisseur CNESST', pro.cnesstProviderNumber], ['Accès à la plateforme', pro.platformAccess ? 'Autorisé' : 'Suspendu']].map(([label, value]) => <div key={label}><dt className="text-[#806b5d]">{label}</dt><dd className="font-medium">{value || '—'}</dd></div>)}</dl>
      <div className="mt-5 border-t border-[#eadfd2] pt-4"><h3 className="font-semibold">Signature professionnelle</h3><p className="mt-2 text-sm">{pro.signature ? `Enregistrée le ${dateLabel(pro.signature.createdAt)}` : 'Aucune signature enregistrée.'}</p>{pro.signature?.imageBase64 && pro.signature.imageMediaType ? <div role="img" aria-label="Signature professionnelle enregistrée" className="mt-2 h-20 w-full max-w-xs rounded-xl border border-[#c5a987] bg-white bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(data:${pro.signature.imageMediaType};base64,${pro.signature.imageBase64})` }} /> : pro.signature && <ProfessionalSignaturePreview strokes={pro.signature.strokes as { x: number; y: number }[][]} />}{(!administrative || pro.id === workspace.actor.id) && <><button type="button" className={buttonClass('secondary') + ' mt-3'} onClick={() => setChangingSignature(value => !value)}>{pro.signature ? 'Changer ma signature' : 'Ajouter ma signature'}</button>{changingSignature && <div className="mt-3 grid gap-3"><label className={clinicalLabel}>Importer une image de signature (PNG ou JPEG, 512 Ko maximum)<input type="file" accept="image/png,image/jpeg" className={clinicalInput} disabled={busy} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 524288) { setError('Choisissez une image PNG ou JPEG de 512 Ko maximum.'); event.target.value = ''; return } const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); const saved = await command('signature.upload', { mediaType: file.type, bytesBase64: btoa(binary) }); if (saved) setChangingSignature(false); event.target.value = '' }} /></label><span className="text-xs text-[#806b5d]">Ou dessiner au pointeur ou au doigt :</span><ProfessionalSignaturePad disabled={busy} onSave={async strokes => { const saved = await command('signature.add', { strokes }); if (saved) setChangingSignature(false); return saved }} /></div>}</>}</div>
    </details>
      {administrative && <section className={clinicalCard}><h3 className="text-lg font-semibold">Accès à la plateforme</h3><p className="mt-1 text-sm">{clinicalUiText("Préparez un lien pour choisir ou modifier le mot de passe de ce professionnel. Dans le laboratoire, aucun courriel n’est expédié.","Préparez un lien pour choisir ou modifier le mot de passe de ce professionnel.")}</p><button type="button" className={buttonClass('secondary') + ' mt-3'} disabled={busy || !pro.active || !pro.platformAccess} onClick={() => void prepareInvitation()}>Envoyer invitation par courriel</button>{invitation && <div className="mt-4 rounded-xl border border-[#eadfd2] bg-[#fbf6ef] p-4 text-sm"><p className="font-semibold">Courriel préparé · simulation</p><p className="mt-2">De : {invitation.from}<br />À : {invitation.to}<br />Objet : {invitation.subject}</p><p className="mt-3 whitespace-pre-wrap break-all">{invitation.body}</p><button type="button" className={buttonClass('secondary') + ' mt-3'} onClick={() => void navigator.clipboard.writeText(invitation.body)}>Copier le message</button></div>}</section>}
      {administrative && <details className={clinicalCard}><summary className="cursor-pointer text-lg font-semibold">Bureaux autorisés</summary><p className="mt-1 text-xs text-[#806b5d]">Les réservations passées restent dans l’historique.</p><ul className="mt-4 grid gap-2 text-sm">{pro.grants.map(grant => <li key={grant.officeId + grant.validFrom} className="flex items-center justify-between gap-2"><span>{pro.offices.find(office => office.id === grant.officeId)?.name ?? 'Bureau'}</span><button className={buttonClass('ghost')} disabled={busy} onClick={() => void changeGrant(pro, grant.officeId, 'remove', actor, setBusy, setError, reload)}>Retirer</button></li>)}{!pro.grants.length && <li>Aucun bureau attribué.</li>}</ul><form className="mt-4 grid gap-2" onSubmit={event => { event.preventDefault(); const id = String(new FormData(event.currentTarget).get('officeId') ?? ''); void changeGrant(pro, id, 'add', actor, setBusy, setError, reload) }}><select name="officeId" required className={clinicalInput} defaultValue=""><option value="">Ajouter un bureau…</option>{pro.offices.filter(office => office.active && !pro.grants.some(grant => grant.officeId === office.id && !grant.validTo)).map(office => <option key={office.id} value={office.id}>{office.name} {office.officeNumber}</option>)}</select><button className={buttonClass('secondary')} disabled={busy}>Attribuer</button></form></details>}
    </div>
    {!administrative && pendingAgreement && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5"><h3 className="font-semibold">Votre entente de collaboration est prête à être consultée et signée.</h3><p className="mt-1 text-sm">Version {pendingAgreement.version} · signature fictive seulement.</p><button className={buttonClass('primary') + ' mt-3'} onClick={() => void onNavigate('my-profile', { tab: 'documents', agreement: pendingAgreement.id })}>Consulter et signer</button></section>}
    <nav id="professional-profile-sections" ref={sectionsRef} aria-label="Sections du profil" className="scroll-mt-4 flex gap-2 overflow-x-auto border-b border-[#e4d3c1] pb-3">{tabs.map(item => <button key={item.id} className={buttonClass(selected === item.id ? 'primary' : 'secondary') + ' shrink-0'} aria-current={selected === item.id ? 'page' : undefined} onClick={() => void onNavigate(administrative ? 'professionals' : 'my-profile', { ...(administrative ? { professional: pro.id, professionalStatus: status } : {}), tab: item.id })}>{item.label}</button>)}</nav>
    {selected === 'note-templates' && !administrative && <NoteTemplatesPanel key={workspace.actor.id} workspace={workspace} />}
    {selected === 'activities' && <CalendarWorkspace key={pro.id + ':' + pro.grants.map(grant => `${grant.officeId}/${grant.validFrom}/${grant.validTo ?? ''}`).join(',')} workspace={workspace} embeddedProfessionalId={pro.id} onNavigate={onNavigate} onUpdated={onUpdated} />}
    {(selected === 'requests' || selected === 'preferences' || selected === 'clients') && <AdmissionModule key={retainsProfessionalTabProjection(administrative,pro.id) ? pro.id : pro.id + ':' + selected} retainOnSectionChange={retainsProfessionalTabProjection(administrative,pro.id)} workspace={workspace} section={selected} professionalId={pro.id} embedded onNavigate={(next, query) => next === 'requests' || next === 'preferences' || next === 'assignments' || next === 'clients' && !query?.client ? onNavigate(administrative ? 'professionals' : 'my-profile', { ...query, ...(administrative ? { professional: pro.id, professionalStatus: status } : {}), tab: next === 'assignments' ? 'clients' : next }) : onNavigate(next, query)} onUpdated={onUpdated} />}
    {selected === 'agreements' && administrative && <section className={clinicalCard}><div className="flex items-center justify-between"><h3 className="font-semibold">Ententes de collaboration</h3><button className={buttonClass('secondary')} disabled={Boolean(pendingAgreement)} onClick={() => setAgreementDraft(true)}>Nouvelle version</button></div><AgreementList agreements={pro.agreements} openFile={openFile} openSignedFile={openSignedFile} />{pendingAgreement && <p className="mt-3 text-sm">Une entente est en attente. La professionnelle la verra à sa connexion clinique.</p>}{agreementDraft && <form className="mt-5 grid gap-3 rounded-xl border p-4" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void command('agreement.create', { title: form.get('title'), text: form.get('text') }).then(saved => { if (saved) setAgreementDraft(false) }) }}><h4 className="font-semibold">Préparer une entente fictive</h4><p className="text-xs">Texte de démonstration non contractuel ; validation juridique requise avant usage réel.</p><label className={clinicalLabel}>Titre<input name="title" required maxLength={160} className={clinicalInput} /></label><label className={clinicalLabel}>Texte<textarea name="text" required maxLength={12000} rows={8} className={clinicalInput} /></label><div className="flex gap-2"><button className={buttonClass('primary')} disabled={busy}>Préparer le PDF et l’invitation locale</button><button type="button" className={buttonClass('secondary')} onClick={() => setAgreementDraft(false)}>Annuler</button></div></form>}</section>}
    {selected === 'services' && administrative && <ProfessionalServicesPanel professionalId={pro.id} actorId={workspace.actor.id} onOpenMandates={() => void onNavigate('mandates')} />}
    {selected === 'documents' && <section className={clinicalCard}><h3 className="font-semibold">Documents professionnels</h3>{!administrative && pro.agreements.length > 0 && <AgreementList agreements={pro.agreements} openFile={openFile} openSignedFile={openSignedFile} />}<ul className="mt-4 grid gap-2">{pro.documents.map(doc => <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm"><span>{doc.label} · {doc.fileName} · {dateLabel(doc.createdAt)}{doc.previousId ? ' · nouvelle version' : ''}</span><button className={buttonClass('secondary')} onClick={() => openFile(doc.id)}><FileText size={16} />Voir et télécharger</button></li>)}</ul>{pro.documents.length === 0 && (!pro.agreements.length || administrative) && <p className="mt-3 text-sm">Aucun document professionnel.</p>}{administrative && <DocumentUpload pro={pro} busy={busy} command={command} />}{!administrative && pendingAgreement && <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4"><h4 className="font-semibold">Entente à signer · version {pendingAgreement.version}</h4><button className={buttonClass('secondary') + ' mt-3'} onClick={() => openFile(pendingAgreement.id)}>Ouvrir le document exact</button>{documentOpen === pendingAgreement.id && <SignatureCapture expectedName={pro.fullName} documentHash={pendingAgreement.sha256} documentOpened disabled={busy} onSign={async evidence => { await command('agreement.sign', { agreementId: pendingAgreement.id, documentHash: pendingAgreement.sha256, evidence }) }} />}</div>}</section>}
    {selected === 'emails' && <section className={clinicalCard}><h3 className="font-semibold">Historique des courriels</h3><p className="mt-2 text-sm">Les notifications ci-dessous sont des simulations locales ; aucun vrai courriel n’est envoyé.</p><ul className="mt-4 grid gap-2 text-sm">{pro.communications.map(item => <li key={item.id} className="rounded-xl border p-3">{item.subject} · Préparé (simulation) · {dateLabel(item.at)}</li>)}{!pro.communications.length && <li>Aucune communication enregistrée.</li>}</ul></section>}
    {editing && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"><form className="my-6 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl" onSubmit={event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>; void command('profile.update', { expectedVersion: pro.version, fullName: values.fullName, title: values.title, prefix: pro.prefix, phone: values.phone, address: values.address, licenseNumber: values.licenseNumber, ivacProviderNumber: values.ivacProviderNumber, cnesstProviderNumber: values.cnesstProviderNumber, ...(administrative ? { active: values.active === 'on', platformAccess: values.platformAccess === 'on' } : {}) }).then(saved => { if (saved) setEditing(false) }) }}><h3 className="text-lg font-semibold">Modifier les données professionnelles</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{[['fullName', 'Nom complet', pro.fullName], ['title', 'Titre professionnel', pro.title], ['phone', 'Téléphone', pro.phone], ['address', 'Adresse', pro.address], ['licenseNumber', 'Numéro de permis / ordre', pro.licenseNumber], ['ivacProviderNumber', 'Numéro de fournisseur IVAC', pro.ivacProviderNumber], ['cnesstProviderNumber', 'Numéro de fournisseur CNESST', pro.cnesstProviderNumber]].map(([name, label, value]) => <label key={name} className={clinicalLabel}>{label}<input name={name} defaultValue={value} required={name === 'fullName'} maxLength={name === 'address' ? 300 : 200} className={clinicalInput} /></label>)}<label className={clinicalLabel}>Courriel professionnel<input type="email" value={pro.email} readOnly className={clinicalInput} /></label></div>{administrative && <div className="mt-4 flex flex-wrap gap-4"><label className="flex gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={pro.active} />Compte actif</label><label className="flex gap-2 text-sm"><input type="checkbox" name="platformAccess" defaultChecked={pro.platformAccess} />Accès à la plateforme</label></div>}<div className="mt-5 flex gap-2"><button className={buttonClass('primary')} disabled={busy}>Enregistrer</button><button type="button" className={buttonClass('secondary')} onClick={() => setEditing(false)}>Annuler</button></div></form></div>}
  </div>
}

function AgreementList({ agreements, openFile, openSignedFile }: { agreements: Agreement[]; openFile: (id: string) => void; openSignedFile: (id: string) => void }) {
  return <div className="mt-4 grid gap-2">{agreements.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm"><span><strong>{item.title}</strong> · version {item.version} · {item.status === 'signed' ? `Signée le ${dateLabel(item.signedAt)}` : 'En attente de signature'}</span><div className="flex flex-wrap gap-2"><button className={buttonClass('secondary')} onClick={() => openFile(item.id)}>PDF original</button>{item.signedSha256 && <button className={buttonClass('primary')} onClick={() => openSignedFile(item.id)}>PDF signé · voir et télécharger</button>}</div></div>)}{!agreements.length && <p className="text-sm">Aucune entente attribuée.</p>}</div>
}

function DocumentUpload({ pro, busy, command }: { pro: Professional; busy: boolean; command: (action: string, values: Record<string, unknown>) => Promise<boolean> }) {
  return <form className="mt-6 grid gap-3 rounded-xl border p-4" onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget), file = form.get('file'); if (!(file instanceof File) || file.size > 1048576) return; const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); await command('document.add', { kind: form.get('kind'), label: form.get('label'), fileName: file.name, mediaType: file.type, bytesBase64: btoa(binary), previousId: form.get('previousId') || null }) }}><h4 className="font-semibold">Ajouter un document</h4><div className="grid gap-3 sm:grid-cols-2"><label className={clinicalLabel}>Catégorie<select name="kind" className={clinicalInput}><option value="permit">Permis</option><option value="membership">Ordre professionnel</option><option value="insurance">Assurance</option><option value="cv">CV</option><option value="other">Autre</option></select></label><label className={clinicalLabel}>Titre<input name="label" required maxLength={160} className={clinicalInput} /></label><label className={clinicalLabel}>Version précédente<select name="previousId" className={clinicalInput}><option value="">Nouvelle pièce</option>{pro.documents.map(doc => <option key={doc.id} value={doc.id}>{doc.label} · {doc.fileName}</option>)}</select></label><label className={clinicalLabel}>PDF, PNG ou JPEG · 1 Mo maximum<input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg" className={clinicalInput} /></label></div><button className={buttonClass('secondary')} disabled={busy}>{clinicalUiText("Déposer dans le laboratoire","Ajouter le document")}</button></form>
}

async function changeGrant(pro: Professional, officeId: string, mode: 'add' | 'remove', actor: { actorId: string; context: 'administration' | 'clinical' }, setBusy: (value: boolean) => void, setError: (value: string) => void, reload: () => Promise<void>) {
  if (!officeId) return
  setBusy(true); setError('')
  try { const day = today(), calendar = await loadCalendar(day, day, actor)
    const grants = calendar.officeGrants.filter(item => item.professionalId === pro.id).map(item => ({ officeId: item.officeId, validFrom: item.validFrom, validTo: item.validTo }))
    const next = mode === 'remove' ? grants.filter(item => item.officeId !== officeId) : [...grants, { officeId, validFrom: day, validTo: null }]
    await runCalendarCommand({ action: 'office-grants.set', id: pro.id, data: { expectedRevision: calendar.officeGrantRevisions[pro.id] ?? 0, grants: next } }, actor)
    await reload()
  } catch (cause) { setError(cause instanceof Error ? cause.message : 'Attribution non confirmée.') }
  finally { setBusy(false) }
}

export function PendingProfessionalAgreement({ workspace, onNavigate }: { workspace: WorkspaceView; onNavigate: (section: WorkspaceSection, query?: Record<string, string | null>) => Promise<void> }) {
  const [pending, setPending] = useState<Agreement | null>(null)
  useEffect(() => { if (workspace.context !== 'clinical' || !workspace.durable) return; const controller = new AbortController(); void clinicalRequest<Data>({ actorId: workspace.actor.id, context: 'clinical' }, '/professionals/self', undefined, 'GET', controller.signal).then(result => setPending(result.professional?.agreements.find(item => item.status === 'pending') ?? null)).catch(() => setPending(null)); return () => controller.abort() }, [workspace.actor.id, workspace.context, workspace.durable])
  return pending && <section className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-5"><h2 className="font-semibold">Votre entente de collaboration est prête à être consultée et signée.</h2><p className="mt-1 text-sm">{pending.title} · version {pending.version} · essai fictif</p><button className={buttonClass('primary') + ' mt-3'} onClick={() => void onNavigate('my-profile', { tab: 'documents', agreement: pending.id })}>Consulter l’entente</button></section>
}
