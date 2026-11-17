'use client'
import { useState } from 'react'
import { buttonClass } from '@/components/Ui'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import { CLINICAL_NOTE_TEMPLATES, type ClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { commonNoteTemplates, isPersonalNoteTemplate, type PersonalNoteTemplate } from '@/lib/clinical-workspace/noteTemplates'
import { CalendarForm, Field, inputClass } from '@/components/clinical-calendar/primitives'
import { clinicalCard } from './styles'
import { useNoteTemplates } from './useNoteTemplates'

type Draft = Omit<PersonalNoteTemplate, 'id'> & { id: string | null }
export function NoteTemplatesPanel({ workspace }: { workspace: WorkspaceView }) {
  const library = useNoteTemplates(workspace.actor.id, workspace.durable)
  const [draft, setDraft] = useState<Draft | null>(null)
  return <section className={clinicalCard}>
    <h3 className="text-lg font-semibold">Gabarits de notes</h3>
    <p className="mt-2 text-sm">Les gabarits communs sont disponibles pour tous les professionnels. Vos gabarits personnels sont privés. Utilisez des rubriques générales, sans renseignements sur un client.</p>
    {library.loading && <p role="status" className="mt-3">Chargement des gabarits personnels…</p>}
    {library.error && <p role="alert" className="mt-3 text-sm text-red-700">{library.error} <button className="underline" onClick={() => void library.reload()}>Réessayer</button></p>}
    {!draft && <>
      <h4 className="mt-5 font-semibold">Gabarits communs</h4>
      <div className="mt-3 grid gap-3">{commonNoteTemplates.map(item => <details key={item.id} className="rounded-xl border p-3"><summary className="cursor-pointer font-medium">{item.title}</summary><pre className="my-3 whitespace-pre-wrap break-words font-sans text-sm">{item.document}</pre><button className={buttonClass('secondary')} disabled={!workspace.durable || library.loading || Boolean(library.error)} onClick={() => setDraft({ ...item, id: null, version: 0, archived: false })}>Créer ma copie</button></details>)}</div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Mes gabarits personnels</h4><button className={buttonClass('primary')} disabled={!workspace.durable || library.loading || Boolean(library.error)} onClick={() => setDraft({ id: null, title: '', document: '', noteType: 'evolution', version: 0, archived: false })}>Ajouter un gabarit</button></div>
      {!workspace.durable && <p className="mt-2 text-sm">La création de gabarits personnels nécessite le laboratoire avec stockage persistant.</p>}
      {!library.loading && !library.error && !library.templates.length && <p className="mt-3 text-sm">Aucun gabarit personnel. Créez un modèle ou adaptez une copie d’un gabarit commun.</p>}
      <ul className="mt-3 grid gap-2">{library.templates.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"><span>{item.title} · {CLINICAL_NOTE_TEMPLATES.find(type => type.id === item.noteType)?.label}{item.archived ? ' · Archivé' : ''}</span><button className={buttonClass('secondary')} onClick={() => setDraft(item)}>Modifier</button></li>)}</ul>
    </>}
    {draft && <TemplateForm key={draft.id ?? 'new'} initial={draft} actorId={workspace.actor.id} onCancel={() => setDraft(null)} onSaved={async () => { setDraft(null); await library.reload() }} />}
  </section>
}
function TemplateForm({ initial, actorId, onCancel, onSaved }: { initial: Draft; actorId: string; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(initial), [changed, setChanged] = useState(false)
  const update = (values: Partial<Draft>) => { setDraft(previous => ({ ...previous, ...values })); setChanged(true) }
  return <div className="mt-5"><CalendarForm submitLabel="Enregistrer le gabarit" changed={changed} onCancel={onCancel} onSave={async () => {
    await clinicalRequest({ actorId, context: 'clinical' }, '/note-templates', { id: draft.id, expectedVersion: draft.version, title: draft.title.trim(), noteType: draft.noteType, document: draft.document, archived: draft.archived }, 'POST', undefined, undefined,
      value => Boolean(value && typeof value === 'object' && isPersonalNoteTemplate((value as { template?: unknown }).template)))
    return onSaved
  }}>
    <Field label="Nom du gabarit"><input className={inputClass} required maxLength={120} value={draft.title} onChange={event => update({ title: event.target.value })} /></Field>
    <Field label="Type de note"><select className={inputClass} value={draft.noteType} onChange={event => update({ noteType: event.target.value as ClinicalNoteType })}>{CLINICAL_NOTE_TEMPLATES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
    <Field label="Texte du gabarit"><textarea className={inputClass + ' min-h-80'} required maxLength={24000} value={draft.document} onChange={event => update({ document: event.target.value })} /></Field>
    {draft.id && <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.archived} onChange={event => update({ archived: event.target.checked })} />Archiver ce gabarit (ne plus le proposer pour une nouvelle note)</label>}
    <p className="text-xs">Ce modèle ne modifie aucune note déjà enregistrée. Le type choisi conserve les règles de la note et de son assistance à la rédaction.</p>
  </CalendarForm></div>
}
