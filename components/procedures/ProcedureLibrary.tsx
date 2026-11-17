'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search } from 'lucide-react'
import { AppNav } from '@/components/AppNav'
import { Badge, buttonClass } from '@/components/Ui'
import { EmptyState, PageHeader } from '@/components/ui/index'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { ClinicalNavigationGuard, useClinicalFormGuard, useClinicalHistory, useClinicalNavigation } from '@/components/clinical-workspace/NavigationGuard'
import { clinicalCard, clinicalInput, clinicalLabel } from '@/components/clinical-workspace/styles'
import { filterProcedures, procedureStatuses, type ProcedureArticleInput, type ProcedureLibrary as Library, type ProcedureSection, type ProcedureStatus } from '@/lib/procedures/model'
import { ProcedureError, procedureRequest } from '@/lib/procedures/client'
import { supabase } from '@/lib/supabaseClient'

export function ProcedureLibrary() { return <ClinicalNavigationGuard><LibraryPage /></ClinicalNavigationGuard> }
function LibraryPage() {
  const router = useRouter(), navigation = useClinicalNavigation()
  useClinicalHistory()
  const [library, setLibrary] = useState<Library | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [query, setQuery] = useState(''), [sectionId, setSectionId] = useState(''), [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<ProcedureArticleInput | null>(null), [sectionEditing, setSectionEditing] = useState<ProcedureSection | null>(null), [homeHref, setHomeHref] = useState('/clinique')
  const sequence = useRef(0)
  const load = useCallback(async () => {
    const request = ++sequence.current
    setLoading(true); setLibrary(null)
    try {
      const access = await procedureRequest<{ homeHref: string }>(undefined, undefined, true)
      const next = await procedureRequest<Library>()
      if (request !== sequence.current) return false
      setLibrary(next); setHomeHref(access.homeHref === '/administration' ? '/administration' : '/clinique'); setError('')
      if (!next.canEdit) { setEditing(null); setSectionEditing(null) }
      return true
    } catch (cause) {
      if (request === sequence.current) {
        setError(cause instanceof Error ? cause.message : 'Les procédures sont indisponibles.')
        if (cause instanceof ProcedureError && [401, 403].includes(cause.status)) { setEditing(null); setSectionEditing(null); setMessage('') }
      }
      return false
    } finally { if (request === sequence.current) setLoading(false) }
  }, [])
  const invalidateRequests = useCallback(() => { ++sequence.current }, [])
  const editorOpen = useRef(false), sessionActor = useRef<string | null>(null)
  useEffect(() => { editorOpen.current = Boolean(editing || sectionEditing) }, [editing, sectionEditing])
  useEffect(() => {
    let current = true
    void load()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextActor = session?.user.id ?? null, changed = nextActor !== sessionActor.current
      sessionActor.current = nextActor
      if (event === 'SIGNED_OUT' || changed && event !== 'INITIAL_SESSION' || event === 'USER_UPDATED') { ++sequence.current; setLibrary(null); setEditing(null); setSectionEditing(null); queueMicrotask(() => { if (current) void load() }) }
    })
    const revalidate = () => { if (!editorOpen.current) void load() }
    window.addEventListener('focus', revalidate)
    return () => { current = false; invalidateRequests(); subscription.unsubscribe(); window.removeEventListener('focus', revalidate) }
  }, [load, invalidateRequests])
  const selected = library?.articles.find(article => article.id === selectedId)
  const results = library ? filterProcedures(library.articles, library.sections, query, sectionId) : []
  const closeEditor = async () => { if (await navigation.canLeave()) { setEditing(null); setSectionEditing(null) } }
  const saved = async (id?: string) => {
    setEditing(null); setSectionEditing(null); if (id) { setSelectedId(id); setQuery(''); setSectionId('') }
    const refreshed = await load()
    setMessage(refreshed ? 'Enregistrement confirmé.' : 'Enregistrement confirmé. La relecture est indisponible ; actualisez la liste sans rejouer la commande.')
  }
  return <div className="min-h-screen bg-[#f8f3ec] text-[#332820]"><AppNav /><main className="min-w-0 p-4 sm:p-6 lg:ml-72 lg:p-8"><div className="mx-auto grid max-w-6xl gap-5">
    <PageHeader title="Procédures de la clinique" description="Un point de référence commun pour la gestion et la coordination." />
    <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className={buttonClass('secondary')} onClick={async () => { if (await navigation.canLeave()) router.push(homeHref) }}>Retour à mon espace</button>{library?.canEdit && <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass('secondary')} onClick={() => setSectionEditing({ id: crypto.randomUUID(), title: '', position: 0, version: 0 })}>Ajouter une section</button><button type="button" className={buttonClass('primary')} disabled={!library.sections.length} onClick={() => setEditing({ id: crypto.randomUUID(), sectionId: sectionId || library.sections[0].id, title: '', body: '', keywords: [], status: 'draft', expectedVersion: 0 })}><Plus size={16} />Ajouter une procédure</button></div>}</div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}<button type="button" className={buttonClass('ghost') + ' ml-2'} onClick={() => void load()}>Réessayer</button></div>}
    {message && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">{message}</p>}
    {loading && <p role="status">Chargement des procédures autorisées…</p>}
    {library && <><section className={clinicalCard}><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_260px]"><label className={clinicalLabel}><span className="flex items-center gap-2"><Search size={16} />Rechercher dans les procédures</span><input type="search" className={clinicalInput} placeholder="Ex. ouverture, IVAC, absence, facture…" value={query} onChange={event => setQuery(event.target.value)} /></label><label className={clinicalLabel}>Section<select className={clinicalInput} value={sectionId} onChange={event => setSectionId(event.target.value)}><option value="">Toutes les sections</option>{library.sections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label></div><p className="mt-3 text-xs text-[#8a6f5d]">{results.length} procédure{results.length > 1 ? 's' : ''} · recherche dans les titres, contenus et mots-clés.{library.canEdit && sectionId && <button type="button" className="ml-2 underline" onClick={() => setSectionEditing(library.sections.find(section => section.id === sectionId)!)}>Renommer cette section</button>}</p></section>
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]"><section className={clinicalCard} aria-label="Résultats de recherche"><div className="grid gap-2">{results.map(article => <button key={article.id} type="button" aria-pressed={selectedId === article.id} className={'rounded-xl border p-3 text-left ' + (selectedId === article.id ? 'border-[#8a5633] bg-[#f3e3cd]' : 'border-[#eadfd2] hover:bg-[#f5ebe0]')} onClick={() => setSelectedId(article.id)}><p className="font-semibold">{article.title}</p><p className="mt-1 text-xs text-[#8a6f5d]">{library.sections.find(section => section.id === article.sectionId)?.title}</p><span className="mt-2 inline-block text-xs">{procedureStatuses[article.status]}</span></button>)}</div>{!results.length && <EmptyState title="Aucune procédure trouvée" description="Essayez un autre mot-clé ou une autre section." />}</section>
    <section className={clinicalCard} aria-label="Procédure sélectionnée">{selected ? <><div className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-semibold">{selected.title}</h2>{library.canEdit && <button type="button" className={buttonClass('secondary')} onClick={() => setEditing({ id: selected.id, sectionId: selected.sectionId, title: selected.title, body: selected.body, keywords: selected.keywords, status: selected.status, expectedVersion: selected.version })}>Modifier</button>}</div><div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><Badge tone={selected.status === 'current' ? 'success' : 'neutral'}>{procedureStatuses[selected.status]}</Badge><span>Version {selected.version} · mise à jour {new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium' }).format(new Date(selected.updatedAt))}</span></div>{selected.sourceTitle && <p className="mt-3 text-xs text-[#8a6f5d]">Source : Gestion Administrative / {selected.sourceTitle}</p>}{selected.status !== 'current' && <p className="mt-4 rounded-xl bg-[#f7eddb] p-3 text-sm">{selected.status === 'draft' ? 'Cette rubrique est à compléter.' : 'Contenu à relire. Les points signalés « à valider » doivent être confirmés avant application.'}</p>}<div className="mt-5 whitespace-pre-wrap break-words text-sm leading-7">{selected.body || 'Aucun contenu pour le moment.'}</div>{selected.keywords.length > 0 && <p className="mt-5 text-xs text-[#8a6f5d]">Mots-clés : {selected.keywords.join(', ')}</p>}</> : <EmptyState title="Choisissez une procédure" description="Consultez une fiche à gauche ou recherchez une réponse par mot-clé." />}</section></div>
    {editing && library.canEdit && <ProspectDialog title={editing.expectedVersion ? 'Modifier la procédure' : 'Nouvelle procédure'} onClose={() => void closeEditor()}><ArticleEditor key={editing.id} value={editing} sections={library.sections} onCancel={() => void closeEditor()} onSaved={saved} onDenied={() => { setLibrary(null); setEditing(null); void load() }} /></ProspectDialog>}
    {sectionEditing && library.canEdit && <ProspectDialog title={sectionEditing.version ? 'Renommer la section' : 'Nouvelle section'} onClose={() => void closeEditor()}><SectionEditor key={sectionEditing.id} value={sectionEditing} onCancel={() => void closeEditor()} onSaved={() => saved()} onDenied={() => { setLibrary(null); setSectionEditing(null); void load() }} /></ProspectDialog>}
    </>}
  </div></main></div>
}

function ArticleEditor({ value, sections, onCancel, onSaved, onDenied }: { value: ProcedureArticleInput; sections: ProcedureSection[]; onCancel: () => void; onSaved: (id: string) => Promise<void>; onDenied: () => void }) {
  const [draft, setDraft] = useState(value), [keywords, setKeywords] = useState(value.keywords.join(', ')), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const guard = useClinicalFormGuard(dirty, busy), pending = useRef(false)
  const update = <K extends keyof ProcedureArticleInput>(key: K, next: ProcedureArticleInput[K]) => { setDraft(current => ({ ...current, [key]: next })); setDirty(true) }
  return <form className="grid gap-4" onSubmit={async event => {
    event.preventDefault(); if (pending.current) return
    pending.current = true; setBusy(true); guard.markPending(); setError('')
    try {
      const ack = await procedureRequest<{ id: string; version: number }>({ action: 'article.save', data: { ...draft, keywords: [...new Set(keywords.split(',').map(word => word.trim()).filter(Boolean))] } })
      guard.markSaved(); setDirty(false); await onSaved(ack.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Enregistrement non confirmé.'); if (cause instanceof ProcedureError && [401, 403].includes(cause.status)) onDenied() }
    finally { pending.current = false; guard.markSettled(); setBusy(false) }
  }}><p className="text-xs text-[#8a6f5d]">Réservez cette bibliothèque aux consignes générales et modèles vierges. Les renseignements propres à un client restent dans son dossier ou le registre approprié.</p><label className={clinicalLabel}>Titre<input required maxLength={160} className={clinicalInput} value={draft.title} disabled={busy} onChange={event => update('title', event.target.value)} /></label><label className={clinicalLabel}>Section<select className={clinicalInput} value={draft.sectionId} disabled={busy} onChange={event => update('sectionId', event.target.value)}>{sections.map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label><label className={clinicalLabel}>Contenu<textarea required={draft.status === 'current'} rows={15} maxLength={40000} className={clinicalInput} value={draft.body} disabled={busy} onChange={event => update('body', event.target.value)} /></label><div className="grid gap-3 sm:grid-cols-2"><label className={clinicalLabel}>Mots-clés, séparés par des virgules<input className={clinicalInput} value={keywords} disabled={busy} onChange={event => { setKeywords(event.target.value); setDirty(true) }} /></label><label className={clinicalLabel}>Statut<select className={clinicalInput} value={draft.status} disabled={busy} onChange={event => update('status', event.target.value as ProcedureStatus)}>{Object.entries(procedureStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}<div className="flex gap-2"><button className={buttonClass('primary')} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" className={buttonClass('secondary')} disabled={busy} onClick={onCancel}>Annuler</button></div></form>
}
function SectionEditor({ value, onCancel, onSaved, onDenied }: { value: ProcedureSection; onCancel: () => void; onSaved: () => Promise<void>; onDenied: () => void }) {
  const [title, setTitle] = useState(value.title), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const guard = useClinicalFormGuard(title !== value.title, busy), pending = useRef(false)
  return <form className="grid gap-4" onSubmit={async event => {
    event.preventDefault(); if (pending.current) return
    pending.current = true; setBusy(true); guard.markPending(); setError('')
    try { await procedureRequest({ action: 'section.save', data: { id: value.id, title, expectedVersion: value.version } }); guard.markSaved(); await onSaved() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Enregistrement non confirmé.'); if (cause instanceof ProcedureError && [401, 403].includes(cause.status)) onDenied() }
    finally { pending.current = false; guard.markSettled(); setBusy(false) }
  }}><label className={clinicalLabel}>Nom de la section<input required maxLength={120} className={clinicalInput} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}<div className="flex gap-2"><button className={buttonClass('primary')} disabled={busy}>Enregistrer</button><button type="button" className={buttonClass('secondary')} disabled={busy} onClick={onCancel}>Annuler</button></div></form>
}
