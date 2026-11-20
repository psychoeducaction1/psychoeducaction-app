'use client'

import { clinicalUiText } from '@/lib/clinical-workspace/presentationText'
import { useState, type FormEvent, type ReactNode } from 'react'
import { admissionNotificationStatusLabel } from '@/lib/clinical-admission/notificationStatus'
import { buttonClass } from '@/components/Ui'
import { useClinicalFormGuard } from '@/components/clinical-workspace/NavigationGuard'
import { clinicalCard, clinicalInput, clinicalLabel } from '@/components/clinical-workspace/styles'
import { dateTimeInputToUtcInToronto, dateTimeInputValueInToronto } from '@/lib/publicIntakeSchedule'
import { serviceDisplayLabel } from '@/lib/professionalPreferences'
import type { AdmissionAction, AdmissionCommandResult, AdmissionDetails, AdmissionWorkspace } from '@/lib/clinical-admission/types'
import { admissionEventLabel, notificationProfessionalTarget } from './presentation'
import type { WorkspaceSection } from '@/lib/clinical-workspace/navigation'

export type AdmissionUi = {
  data: AdmissionWorkspace; busy: boolean; query: URLSearchParams
  run: (action: AdmissionAction, id: string | null, values: Record<string, unknown>) => Promise<AdmissionCommandResult>
  navigate: (section: WorkspaceSection, patch?: Record<string, string | null>) => Promise<void>
  select: (patch: Record<string, string | null>) => Promise<void>
  openClient: (clientId: string) => Promise<void>
  refresh?: () => Promise<void>
  invalidate: (cause: unknown) => void
}
export type Field = { name: string; label: string; type?: 'text' | 'email' | 'number' | 'date' | 'time' | 'datetime-local' | 'textarea' | 'select' | 'checkbox' | 'multiselect' | 'list'; required?: boolean; initial?: string | string[] | boolean; options?: { value: string; label: string }[]; addLabel?: string; itemType?: 'text' | 'email'; min?: number; max?: number; maxLength?: number }
export const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
export const lines = (value: unknown) => [...new Set(text(value).split(/\r?\n/).map(item => item.trim()).filter(Boolean))]
export const utc = (value: unknown) => dateTimeInputToUtcInToronto(text(value)).toISOString()
export const localNow = () => dateTimeInputValueInToronto(new Date())
export const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Non renseigné'
export const services = ['Psychoéducation', 'Intervention psychosociale', 'Psychothérapie', 'Évaluation psychologique']
export const serviceOptions = services.map(value => ({ value, label: serviceDisplayLabel(value) }))
export const modalities = ['Présentiel — bureau de Longueuil', 'Présentiel — bureau de Montréal', 'Visioconférence', 'À domicile']
export const options = (values: string[]) => values.map(value => ({ value, label: value }))
export const priorityOptions = [{ value: 'normal', label: 'Normale' }, { value: 'urgent', label: 'Urgente' }, { value: 'existing_or_transfer', label: 'Existant / transfert' }]
export const stageLabels: Record<string, string> = { waiting: 'En attente', assignment_in_progress: 'Démarche en cours', assigned: 'Assigné', active: 'Actif', closed: 'Fermé', blacklisted: 'Liste noire' }
export const processLabels: Record<string, string> = { to_contact: 'Non contacté', voicemail_left: 'Aucune réponse', no_response: 'Aucune réponse', text_sent: 'Texto déclaré manuellement', email_sent: 'Courriel simulé', text_email_sent: 'Texto déclaré et courriel simulé', contacted_waiting_response: 'Autre / attente de réponse', interested: 'Intéressé', client_refusal: 'Refus', assigned: 'Assigné', classified: 'Classé', returned: 'Retourné en attente' }
export const terminalProcess = (status: string) => ['assigned', 'classified', 'returned'].includes(status)

function RepeatingField({ field, busy, onModified }: { field: Field; busy: boolean; onModified: () => void }) {
  const [values, setValues] = useState<string[]>(() => Array.isArray(field.initial) && field.initial.length ? field.initial : [''])
  const update = (next: string[]) => { setValues(next); onModified() }
  return <fieldset className="grid gap-2"><legend className={clinicalLabel}>{field.label}</legend>{values.map((value, index) => <div key={index} className="flex gap-2"><input name={field.name} aria-label={`${field.label} ${index + 1}`} type={field.itemType ?? 'text'} maxLength={field.maxLength ?? 300} value={value} disabled={busy} onChange={event => update(values.map((item, position) => position === index ? event.target.value : item))} className={`${clinicalInput} min-w-0 flex-1`} />{values.length > 1 && <button type="button" className={buttonClass('secondary')} disabled={busy} onClick={() => update(values.filter((_, position) => position !== index))}>Supprimer</button>}</div>)}<button type="button" className="justify-self-start text-sm font-medium text-[#6d3f1f] underline underline-offset-2 hover:text-[#8a5633]" disabled={busy} onClick={() => update([...values, ''])}>{field.addLabel ?? 'Ajouter'}</button></fieldset>
}

export function ActionForm({ fields, submitLabel, onSubmit, reset = false, children, inline = false, layout = 'default', onCancel }: { fields: Field[]; submitLabel: string; onSubmit: (values: Record<string, unknown>) => Promise<void | (() => void | Promise<void>)>; reset?: boolean; children?: ReactNode; inline?: boolean; layout?: 'default' | 'waiting'; onCancel?: () => void }) {
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const guard = useClinicalFormGuard(dirty, busy)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget, input = new FormData(form), values: Record<string, unknown> = {}
    for (const field of fields) values[field.name] = field.type === 'checkbox' ? input.get(field.name) === 'on' : field.type === 'multiselect' || field.type === 'list' ? input.getAll(field.name).map(value => String(value).trim()).filter(Boolean) : String(input.get(field.name) ?? '').trim()
    guard.markPending(); setBusy(true); setError(''); setSaved(false)
    try { const afterSave = await onSubmit(values); guard.markSaved(); setDirty(false); setBusy(false); setSaved(true); if (reset) form.reset(); if (afterSave) await afterSave() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.') }
    finally { guard.markSettled(); setBusy(false) }
  }
  const controls = <div className={inline ? 'flex flex-wrap gap-2 sm:col-span-2' : layout === 'waiting' ? 'flex flex-wrap gap-2 md:col-span-2' : 'flex flex-wrap gap-2'}>
    <button className={buttonClass('secondary')} disabled={busy}>{busy ? 'Enregistrement…' : submitLabel}</button>
    {onCancel && <button type="button" className={buttonClass('ghost')} disabled={busy} onClick={() => { if (!dirty || window.confirm('Abandonner les modifications non enregistrées ?')) { guard.markSaved(); onCancel() } }}>Annuler</button>}
  </div>
  return <form className={inline ? 'grid gap-3 sm:grid-cols-2' : layout === 'waiting' ? 'grid gap-4 md:grid-cols-2' : 'grid gap-3'} onSubmit={submit} onChange={() => { setDirty(true); setSaved(false) }}>
    {inline && controls}
    {fields.map(field => field.type === 'list' ? <RepeatingField key={field.name} field={field} busy={busy} onModified={() => { setDirty(true); setSaved(false) }} /> : field.type === 'multiselect' ? <fieldset key={field.name} className="grid gap-2"><legend className={clinicalLabel}>{field.label}</legend><div className="grid gap-2 rounded-xl border border-[#dfd0bf] bg-white px-3 py-2.5">{field.options?.map(option => <label key={option.value} className="flex items-center gap-2 text-sm"><input name={field.name} type="checkbox" value={option.value} defaultChecked={Array.isArray(field.initial) && field.initial.includes(option.value)} disabled={busy} className="h-4 w-4 accent-[#8a5633]" />{option.label}</label>)}</div></fieldset> : field.type === 'checkbox' ? <label key={field.name} className="flex items-start gap-2 text-sm"><input name={field.name} type="checkbox" defaultChecked={field.initial === true} disabled={busy} />{field.label}</label> : <label key={field.name} className={(inline && field.type === 'textarea' ? `${clinicalLabel} sm:col-span-2` : clinicalLabel) + (layout === 'waiting' && field.type === 'textarea' ? ' md:col-span-2' : '')}>{field.label}
      {field.type === 'textarea' ? <textarea name={field.name} rows={3} required={field.required} maxLength={field.maxLength ?? 5000} defaultValue={String(field.initial ?? '')} disabled={busy} className={clinicalInput} />
        : field.type === 'select' ? <select name={field.name} required={field.required} defaultValue={String(field.initial ?? '')} disabled={busy} className={clinicalInput}><option value="">Choisir…</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : <input name={field.name} type={field.type ?? 'text'} required={field.required} min={field.min} max={field.max} step={field.type === 'number' ? 1 : undefined} maxLength={field.maxLength ?? 300} defaultValue={String(field.initial ?? '')} disabled={busy} className={clinicalInput} />}
    </label>)}
    {children}{error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}{saved && <p role="status" className="text-sm text-green-800 sm:col-span-2">{clinicalUiText("Enregistré dans le laboratoire local.","Enregistré.")}</p>}
    {!inline && controls}
  </form>
}
export function Fold({ title, children }: { title: string; children: ReactNode }) { return <details className="rounded-xl border border-[#eadfd2] p-4"><summary className="cursor-pointer font-semibold">{title}</summary><div className="mt-4">{children}</div></details> }
export function Pager({ total, size = 10, query, select }: { total: number; size?: number; query: URLSearchParams; select: AdmissionUi['select'] }) {
  const pages = Math.max(1, Math.ceil(total / size)), page = Math.min(pages, Math.max(1, Number(query.get('page')) || 1))
  return <div className="mt-4 flex items-center justify-between gap-3 text-sm"><button className={buttonClass('ghost')} disabled={page <= 1} onClick={() => void select({ page: String(page - 1) })}>Précédent</button><span>Page {page} / {pages} · {total} résultat(s)</span><button className={buttonClass('ghost')} disabled={page >= pages} onClick={() => void select({ page: String(page + 1) })}>Suivant</button></div>
}
export function pageRows<T>(rows: T[], query: URLSearchParams, size = 10): T[] {
  const page = Math.min(Math.max(1, Math.ceil(rows.length / size)), Math.max(1, Number(query.get('page')) || 1))
  return rows.slice((page - 1) * size, page * size)
}
export function Search({ ui }: { ui: AdmissionUi }) {
  return <label className={clinicalLabel}>Rechercher<input className={clinicalInput} type="search" value={ui.query.get('recherche') ?? ''} onChange={event => void ui.select({ recherche: event.target.value || null, page: null })} /></label>
}
export function Details({ value, administrative = false }: { value: AdmissionDetails; administrative?: boolean }) {
  return <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold">Service</dt><dd>{value.service ? serviceDisplayLabel(value.service) : 'Non précisé'}</dd></div><div><dt className="font-semibold">Requérants</dt><dd>{value.requesterNames.join(' / ') || 'Pour soi-même'}</dd></div><div><dt className="font-semibold">Courriels</dt><dd className="break-all">{value.emails.join(' · ') || 'Non renseignés'}</dd></div><div><dt className="font-semibold">Téléphones</dt><dd>{value.phones.join(' · ') || 'Non renseignés'}</dd></div><div><dt className="font-semibold">Modalités</dt><dd>{value.modalities.join(' · ') || 'Non précisées'}</dd></div><div><dt className="font-semibold">Adresse / disponibilité</dt><dd>{[value.address, value.availability].filter(Boolean).join(' · ') || 'Non renseignées'}</dd></div><div className="sm:col-span-2"><dt className="font-semibold">Motif de consultation partagé</dt><dd className="whitespace-pre-wrap">{value.consultationReason || 'Non précisé'}</dd></div>{administrative && <div className="sm:col-span-2"><dt className="font-semibold">Notes administratives internes</dt><dd className="whitespace-pre-wrap">{value.internalNotes || 'Non précisées'}</dd></div>}</dl>
}
export function AdmissionHistory({ ui, admissionId, processId, assignmentId, prospectId }: { ui: AdmissionUi; admissionId?: string; processId?: string; assignmentId?: string; prospectId?: string }) {
  const events = ui.data.events.filter(event => admissionId ? event.admissionId === admissionId : processId ? event.processId === processId : assignmentId ? event.assignmentId === assignmentId : event.prospectId === prospectId)
  return <Fold title={'Historique conservé (' + events.length + ')'}>{events.length ? <ol className="grid gap-3 text-sm">{[...events].reverse().map(event => <li key={event.id} className="border-l-2 border-[#d8b992] pl-3"><p className="font-semibold">{admissionEventLabel(event.action)} · {dateTime(event.createdAt)}</p>{event.note && <p className="whitespace-pre-wrap">{event.note}</p>}</li>)}</ol> : <p>Aucun événement.</p>}</Fold>
}
export function TasksAndNotifications({ ui, admissionId, processId }: { ui: AdmissionUi; admissionId: string; processId?: string }) {
  const tasks = ui.data.tasks.filter(task => task.admissionId === admissionId && (!processId || task.processId === processId))
  const professionalTarget = notificationProfessionalTarget(ui.data, admissionId, processId)
  const notifications = ui.data.notifications.filter(item => item.admissionId === admissionId && (!processId || item.processId === processId))
  return <div className="grid gap-3">
    <Fold title={'Tâches de suivi (' + tasks.length + ')'}><div className="grid gap-3">{tasks.map(task => <div key={task.id} className="rounded-lg border p-3 text-sm"><p className="font-semibold">{task.title}</p><p>{dateTime(task.dueAt)} · {{ pending: 'À faire', in_progress: 'En cours', completed: 'Terminée', cancelled: 'Annulée' }[task.status]}</p>{(task.status === 'pending' || task.status === 'in_progress') && <button className={buttonClass('ghost')} disabled={ui.busy} onClick={() => void ui.run('tasks.complete', task.id, { expectedVersion: task.version }).catch(() => undefined)}>Terminer la tâche</button>}</div>)}</div><ActionForm fields={[{ name: 'title', label: 'Nouvelle tâche', required: true, maxLength: 200 }, { name: 'dueAt', label: 'Échéance (Toronto)', type: 'datetime-local', required: true, initial: localNow() }]} submitLabel="Créer la tâche fictive" onSubmit={async values => { await ui.run('tasks.create', null, { admissionId, ...(processId ? { processId } : {}), title: text(values.title), dueAt: utc(values.dueAt) }) }} /></Fold>
    <Fold title={'Communications (' + notifications.length + ')'}><p className="mb-4 text-sm">{clinicalUiText("Aucun courriel ou texto réel n’est envoyé dans le laboratoire.","Consultez le statut de chaque communication. Afficher cet historique ne déclenche aucun envoi.")}</p>{notifications.map(item => <div key={item.id} className="mb-3 rounded-xl border p-3 text-sm"><p className="font-semibold">{item.subject} · {admissionNotificationStatusLabel(item.status)}</p><p>{item.recipientLabel} · {dateTime(item.createdAt)}</p><p className="mt-2 whitespace-pre-wrap">{item.body}</p></div>)}<ActionForm fields={[{ name: 'kind', label: 'Destinataire fictif', type: 'select', required: true, options: [{ value: 'client', label: 'Client' }, ...(professionalTarget.available ? [{ value: 'professional', label: 'Professionnel lié' }] : []), { value: 'internal', label: 'Équipe administrative' }] }, { name: 'subject', label: 'Objet à prévisualiser', required: true, maxLength: 200 }, { name: 'body', label: 'Contenu à prévisualiser', type: 'textarea', required: true }]} submitLabel="Enregistrer la simulation" onSubmit={async values => { await ui.run('notifications.simulate', null, { admissionId, ...(processId ? { processId } : {}), ...(values.kind === 'professional' && professionalTarget.assignmentId ? { assignmentId: professionalTarget.assignmentId } : {}), ...values }) }} /></Fold>
  </div>
}
export const panelClass = clinicalCard
