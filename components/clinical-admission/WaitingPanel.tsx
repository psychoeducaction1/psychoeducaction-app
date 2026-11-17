'use client'

import { clinicalUiText } from '@/lib/clinical-workspace/presentationText'
import { useState } from 'react'
import { buttonClass, Badge } from '@/components/Ui'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import type { ClientAdminProjection } from '@/lib/clinical-core/types'
import type { AdmissionCase, AdmissionNotification } from '@/lib/clinical-admission/types'
import { AssignmentEmailFlow } from './AssignmentEmailFlow'
import { openingFeeOptions, recordOpeningFeeChoice } from './openingFee'
import { capacityPlaces, waitingTabSelectionPatch } from './presentation'
import { dateKeyInToronto } from '@/lib/publicIntakeSchedule'
import { clinicalInput, clinicalLabel } from '@/components/clinical-workspace/styles'
import { workspaceHref } from '@/lib/clinical-workspace/navigation'
import { serviceDisplayLabel } from '@/lib/professionalPreferences'
import { ActionForm, Details, Pager, Search, dateTime, lines, modalities, pageRows, panelClass, priorityOptions, serviceOptions as availableServiceOptions, services, stageLabels, terminalProcess, text, type AdmissionUi, type Field } from './shared'

const age = (birthDate: string | null) => { if (!birthDate) return null; const today = dateKeyInToronto(new Date()), years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4)); return years - (today.slice(5) < birthDate.slice(5) ? 1 : 0) }
const serviceLabel = (value: string) => value === 'psychoeducation' ? 'Psychoéducation' : serviceDisplayLabel(value)
const serviceOptions = (current?: string) => current && !services.includes(current)
  ? [{ value: current, label: serviceLabel(current) }, ...availableServiceOptions.filter(option => option.label !== serviceLabel(current))] : availableServiceOptions
const selectedModalities = (query: URLSearchParams) => (query.get('modalite') ?? '').split('|').filter(Boolean)
function fields(value?: AdmissionCase): Field[] {
  return [
    { name: 'priority', label: 'Priorité', type: 'select', required: true, options: priorityOptions, initial: value?.priority ?? 'normal' },
    { name: 'contactDate', label: 'Date de contact initial', type: 'date', initial: value?.contactDate.slice(0, 10) ?? dateKeyInToronto(new Date()) },
    { name: 'service', label: 'Service demandé', type: 'select', required: true, options: serviceOptions(value?.service), initial: value?.service ?? services[0] },
    { name: 'firstName', label: 'Prénom fictif', required: true, initial: value?.firstName, maxLength: 100 },
    { name: 'lastName', label: 'Nom fictif', required: true, initial: value?.lastName, maxLength: 100 },
    { name: 'requesterNames', label: 'Requérants', type: 'list', addLabel: 'Ajouter un autre requérant', initial: value?.requesterNames },
    { name: 'birthDate', label: 'Date de naissance', type: 'date', initial: value?.birthDate ?? '' },
    { name: 'address', label: 'Adresse de service fictive', initial: value?.address },
    { name: 'modalities', label: 'Modalités de rencontre', type: 'multiselect', options: [...modalities, ...(value?.modalities ?? []).filter(item => !modalities.includes(item))].map(item => ({ value: item, label: item })), initial: value?.modalities },
    { name: 'emails', label: 'Courriels fictifs', type: 'list', itemType: 'email', addLabel: 'Ajouter un autre courriel', initial: value?.emails },
    { name: 'phones', label: 'Téléphones fictifs', type: 'list', addLabel: 'Ajouter un autre téléphone', initial: value?.phones },
    { name: 'availability', label: 'Préférence horaire', maxLength: 1000, initial: value?.availability },
    { name: 'consultationReason', label: 'Motif de consultation', required: true, type: 'textarea', maxLength: 1000, initial: value?.consultationReason },
    { name: 'internalNotes', label: 'Notes administratives internes', type: 'textarea', maxLength: 6000, initial: value?.internalNotes },
  ]
}
export const admissionFieldLines = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : lines(value)
function formData(values: Record<string, unknown>): Record<string, unknown> {
  return { ...values, birthDate: text(values.birthDate) || null, requesterNames: admissionFieldLines(values.requesterNames), emails: admissionFieldLines(values.emails), phones: admissionFieldLines(values.phones), modalities: admissionFieldLines(values.modalities) }
}
function matches(item: AdmissionCase, ui: AdmissionUi) {
  const q = ui.query, search = (q.get('recherche') ?? '').toLocaleLowerCase('fr')
  if (search && ![item.firstName, item.lastName, ...item.requesterNames, ...item.emails, ...item.phones, item.address, item.service, item.consultationReason, ...item.modalities].join(' ').toLocaleLowerCase('fr').includes(search)) return false
  if (q.get('client') && item.clientId !== q.get('client')) return false
  if (q.get('service') && item.service !== q.get('service')) return false
  if (q.get('stage') && item.stage !== q.get('stage')) return false
  const years = age(item.birthDate)
  if (years !== null && q.get('ageMin') && years < Number(q.get('ageMin'))) return false
  if (years !== null && q.get('ageMax') && years > Number(q.get('ageMax'))) return false
  const selected = selectedModalities(q)
  if (selected.length && !selected.some(value => item.modalities.includes(value))) return false
  if (q.get('tiers') === 'hide' && /\b(ivac|pae|cnesst)\b/i.test([item.service, item.internalNotes, item.consultationReason].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) return false
  return true
}
export function WaitingPanel({ ui, clients }: { ui: AdmissionUi; clients: ClientAdminProjection[] }) {
  const [adding, setAdding] = useState(false)
  const [selectedAction, setSelectedAction] = useState<'edit' | 'assign' | 'task' | null>(null)
  const [emailAssignment, setEmailAssignment] = useState<{ id: string; notifications: AdmissionNotification[] } | null>(null)
  const history = ui.query.get('tab') === 'history', activeProcessIds = new Set(ui.data.processes.filter(value => !terminalProcess(value.status)).map(value => value.admissionId))
  const rows = ui.data.admissions.filter(item => !activeProcessIds.has(item.id) && (history ? item.stage !== 'waiting' : item.stage === 'waiting') && matches(item, ui)).sort((a, b) => {
    const order = { urgent: 0, existing_or_transfer: 1, normal: 2 }; return (history ? 0 : order[a.priority] - order[b.priority]) || a.contactDate.localeCompare(b.contactDate)
  })
  const selected = ui.data.admissions.find(item => item.id === ui.query.get('admission')), size = history ? 5 : 10
  const activeModalities = selectedModalities(ui.query)
  const toggleModality = (value: string, checked: boolean) => {
    const next = checked ? [...activeModalities, value] : activeModalities.filter(item => item !== value)
    void ui.select({ modalite: next.length ? next.join('|') : null, page: null })
  }
  const openAction = (item: AdmissionCase, action: 'edit' | 'assign' | 'task' | null) => {
    setSelectedAction(action)
    void ui.select({ admission: item.id })
  }
  const startProcess = async (item: AdmissionCase) => {
    if (!window.confirm(`Démarrer une assignation pour ${item.firstName} ${item.lastName} ? Le client quittera la liste d’attente et apparaîtra dans « Assignations en cours ».`)) return
    try {
      const result = await ui.run('admissions.process', item.id, { expectedVersion: item.version })
      await ui.navigate('processes', { process: result.result.id, tab: 'active' })
    } catch { /* Le module affiche l’erreur de la commande. */ }
  }
  const removeFromWaiting = async (item: AdmissionCase) => {
    if (!window.confirm(clinicalUiText(`Retirer ${item.firstName} ${item.lastName} de la liste d’attente ? Le dossier et son historique resteront conservés dans le laboratoire.`,`Retirer ${item.firstName} ${item.lastName} de la liste d’attente ? Le dossier et son historique resteront conservés.`))) return
    try {
      await ui.run('admissions.classify', item.id, { expectedVersion: item.version, classification: 'closed', reason: 'Retiré de la liste d’attente par la direction.' })
      if (selected?.id === item.id) void ui.select({ admission: null })
    } catch { /* Le module affiche l’erreur de la commande. */ }
  }
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2">{[['waiting', 'Liste d’attente'], ['history', 'Historique clients']].map(([value, label]) => <button key={value} className={buttonClass((history ? 'history' : 'waiting') === value ? 'primary' : 'secondary')} onClick={() => void ui.select(waitingTabSelectionPatch(ui.query, value as 'waiting' | 'history'))}>{label}</button>)}</div><button className={buttonClass('secondary')} onClick={() => setAdding(true)}>Ajouter un client</button></div>
    <section className={panelClass}><Search ui={ui} /><details className="mt-3 rounded-xl border border-[#eadfd2] p-3"><summary className="cursor-pointer font-medium">Filtres</summary><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className={clinicalLabel}>Service<select className={clinicalInput} value={ui.query.get('service') ?? ''} onChange={event => void ui.select({ service: event.target.value || null, page: null })}><option value="">Tous</option>{availableServiceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className={clinicalLabel}>Statut<select className={clinicalInput} value={ui.query.get('stage') ?? ''} onChange={event => void ui.select({ stage: event.target.value || null, page: null })}><option value="">Tous</option>{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <fieldset className="sm:col-span-2"><legend className={clinicalLabel}>Modalités de rencontre</legend><div className="mt-1 flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-[#dfd0bf] bg-white px-3 py-2.5">{modalities.map(value => <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={activeModalities.includes(value)} onChange={event => toggleModality(value, event.target.checked)} />{value}</label>)}</div></fieldset>
      {['ageMin', 'ageMax'].map((key, index) => <label key={key} className={clinicalLabel}>{index ? 'Âge maximum' : 'Âge minimum'}<input className={clinicalInput} type="number" min={0} max={120} value={ui.query.get(key) ?? ''} onChange={event => void ui.select({ [key]: event.target.value || null, page: null })} /></label>)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ui.query.get('tiers') === 'hide'} onChange={event => void ui.select({ tiers: event.target.checked ? 'hide' : null, page: null })} />Masquer IVAC / PAE / CNESST</label>
    </div><button className={buttonClass('ghost')} onClick={() => void ui.select({ recherche: null, service: null, stage: null, ageMin: null, ageMax: null, modalite: null, compat: null, tiers: null, client: null, page: null })}>Réinitialiser les filtres</button></details></section>
    <section className={panelClass}><h2 className="mb-1 text-lg font-semibold">{history ? 'Historique clients' : 'Clients en attente'} ({rows.length})</h2><p className="mb-4 text-sm text-[#7a6859]">Cliquez sur la ligne pour voir l’aperçu, ou sur le nom pour ouvrir le dossier client.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[1900px] border-collapse text-left text-sm"><thead><tr className="border-b border-[#eadfd2] text-[#6c5a4d]">
        <th className="min-w-40 p-3">Actions</th><th className="p-3">Priorité</th><th className="p-3">Statut</th><th className="p-3">Contact initial</th><th className="p-3">Service</th><th className="p-3">Client</th><th className="p-3">Requérant</th><th className="min-w-28 p-3">Naissance / âge</th><th className="min-w-40 p-3">Adresse</th><th className="p-3">Modalités</th><th className="min-w-40 p-3">Disponibilités</th><th className="min-w-48 p-3">Coordonnées</th><th className="min-w-60 p-3">Motif et notes internes</th>
      </tr></thead><tbody>{pageRows(rows, ui.query, size).map(item => {
        const canAdvance = item.stage === 'waiting' && !activeProcessIds.has(item.id) && !ui.data.assignments.some(assignment => assignment.admissionId === item.id && !assignment.canceledAt && assignment.outcome !== 'not_taken')
        const pendingTask = ui.data.tasks.some(task => task.admissionId === item.id && task.kind === 'assignment_support' && task.status === 'pending')
        return <tr key={item.id} role="button" tabIndex={0} aria-label={`Voir l’aperçu de ${item.firstName} ${item.lastName}`} className="cursor-pointer border-b border-[#f0e7de] align-top hover:bg-[#fbf6ef] focus-visible:bg-[#fbf6ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a37452]" onClick={() => openAction(item, null)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openAction(item, null) } }}>
          <td className="p-3"><div className="grid gap-1.5" onClick={event => event.stopPropagation()}>{canAdvance && <><button className={buttonClass('primary')} disabled={ui.busy} onClick={() => openAction(item, 'assign')}>Assigner</button><button className={buttonClass('secondary')} disabled={ui.busy} onClick={() => void startProcess(item)}>Démarrer une assignation</button><button className={buttonClass('secondary')} disabled={ui.busy || pendingTask} onClick={() => openAction(item, 'task')}>{pendingTask ? 'Tâche en cours' : 'Tâche aux adjointes'}</button></>}<button className={buttonClass('secondary')} disabled={ui.busy} onClick={() => openAction(item, 'edit')}>Modifier</button>{item.stage === 'waiting' && <button className={buttonClass('danger')} disabled={ui.busy || !canAdvance} onClick={() => void removeFromWaiting(item)}>Supprimer de la liste</button>}</div></td>
          <td className="p-3"><Badge tone={item.priority === 'urgent' ? 'warning' : 'neutral'}>{priorityOptions.find(option => option.value === item.priority)?.label}</Badge></td>
          <td className="p-3">{stageLabels[item.stage]}</td>
          <td className="p-3">{item.contactDate.slice(0, 10)}</td>
          <td className="p-3">{item.service}</td>
          <td className="p-3"><a className="font-semibold text-[#805738] underline underline-offset-2 hover:text-[#58391f] focus-visible:outline-2" href={workspaceHref('administration', 'clients', { client: item.clientId })} onClick={event => event.stopPropagation()}>{item.firstName} {item.lastName}</a></td>
          <td className="p-3">{item.requesterNames.join(' / ') || 'Pour soi-même'}</td>
          <td className="p-3">{item.birthDate ? `${item.birthDate} · ${age(item.birthDate)} ans` : '—'}</td>
          <td className="max-w-48 whitespace-pre-wrap break-words p-3">{item.address || '—'}</td>
          <td className="p-3">{item.modalities.join(' · ') || '—'}</td>
          <td className="max-w-48 whitespace-pre-wrap break-words p-3">{item.availability || '—'}</td>
          <td className="max-w-56 break-words p-3"><div className="grid gap-1">{item.emails.map(email => <span key={email} className="break-all">{email}</span>)}{item.phones.map(phone => <span key={phone}>{phone}</span>)}{!item.emails.length && !item.phones.length && '—'}</div></td>
          <td className="max-w-80 whitespace-pre-wrap break-words p-3"><p>{item.consultationReason || '—'}</p>{item.internalNotes && <p className="mt-2 border-t border-[#eadfd2] pt-2 text-[#7a6859]"><span className="font-semibold">Notes internes : </span>{item.internalNotes}</p>}</td>
        </tr>
      })}{!rows.length && <tr><td colSpan={13} className="p-6 text-center">{history ? 'Aucun client dans cet historique.' : 'Aucun client en attente.'}</td></tr>}</tbody></table></div><Pager total={rows.length} size={size} query={ui.query} select={ui.select} />
    </section>
    {adding && <ProspectDialog title="Ajouter un client à la liste d’attente" onClose={() => setAdding(false)}><ActionForm fields={[{ name: 'existingClientId', label: 'Identité permanente existante (facultatif)', type: 'select', options: clients.map(item => ({ value: item.id, label: item.firstName + ' ' + item.lastName + ' · ' + item.id.slice(0, 8) })) }, ...fields()]} layout="waiting" submitLabel="Ajouter à la liste" reset onSubmit={async values => { const { existingClientId, ...rest } = formData(values); const result = await ui.run('admissions.create', null, { ...rest, ...(text(existingClientId) ? { existingClientId } : {}) }); return async () => { setAdding(false); await ui.select({ admission: result.result.id, tab: 'waiting', page: null }) } }} /></ProspectDialog>}
    {selected && !emailAssignment && <WaitingCase key={`${selected.id}:${selectedAction ?? 'preview'}`} item={selected} ui={ui} initialAction={selectedAction} onStartProcess={startProcess} onRemove={removeFromWaiting} onAssigned={(id, notifications) => { setEmailAssignment({ id, notifications }); setSelectedAction(null); void ui.select({ admission: null }) }} onClose={() => { setSelectedAction(null); void ui.select({ admission: null }) }} />}
    {emailAssignment && <AssignmentEmailFlow ui={ui} assignmentId={emailAssignment.id} notifications={emailAssignment.notifications} onClose={() => setEmailAssignment(null)} />}
  </div>
}
function WaitingCase({ item, ui, initialAction, onStartProcess, onRemove, onAssigned, onClose }: { item: AdmissionCase; ui: AdmissionUi; initialAction: 'edit' | 'assign' | 'task' | null; onStartProcess: (item: AdmissionCase) => Promise<void>; onRemove: (item: AdmissionCase) => Promise<void>; onAssigned: (id: string, notifications: AdmissionNotification[]) => void; onClose: () => void }) {
  const [editing, setEditing] = useState(initialAction === 'edit'), [assigning, setAssigning] = useState(initialAction === 'assign'), [tasking, setTasking] = useState(initialAction === 'task')
  const professionals = ui.data.professionals.filter(value => value.isActive && value.canPractice && capacityPlaces(ui.data.capacityRequests, value.id) > 0)
  const occupied = ui.data.assignments.some(value => value.admissionId === item.id && !value.canceledAt && value.outcome !== 'not_taken')
  const process = ui.data.processes.find(value => value.admissionId === item.id && !terminalProcess(value.status))
  return <ProspectDialog title={`${item.firstName} ${item.lastName}`} onClose={onClose}><div className="grid gap-4">
    <p className="text-sm text-[#7a6859]">{stageLabels[item.stage]} · {priorityOptions.find(option => option.value === item.priority)?.label} · Contact initial {item.contactDate.slice(0, 10)} · Âge {age(item.birthDate) ?? 'inconnu'}</p>
    {editing ? <section aria-label="Modifier la fiche client"><ActionForm key={`${item.version}:${item.identityVersion}`} fields={fields(item)} submitLabel="Enregistrer" layout="waiting" onCancel={() => setEditing(false)} onSubmit={async values => { await ui.run('admissions.update', item.id, { expectedVersion: item.version, expectedIdentityVersion: item.identityVersion, ...formData(values) }); return () => setEditing(false) }} /></section> : <Details value={item} administrative />}
    {!editing && <div className="flex flex-wrap gap-2 border-t border-[#eadfd2] pt-4"><button className={buttonClass('secondary')} onClick={() => { setEditing(true); setAssigning(false); setTasking(false) }}>Modifier</button>
      {item.stage === 'waiting' && !process && !occupied && <><button className={buttonClass('primary')} onClick={() => { setAssigning(value => !value); setTasking(false) }}>{assigning ? 'Masquer l’assignation' : 'Assigner'}</button><button className={buttonClass('secondary')} disabled={ui.busy} onClick={() => void onStartProcess(item)}>Démarrer une assignation</button><button className={buttonClass('secondary')} disabled={ui.busy || ui.data.tasks.some(task => task.admissionId === item.id && task.kind === 'assignment_support' && task.status === 'pending')} onClick={() => { setTasking(value => !value); setAssigning(false) }}>Tâche aux adjointes</button><button className={buttonClass('danger')} disabled={ui.busy} onClick={() => void onRemove(item)}>Supprimer de la liste</button></>}
      {process && <button className={buttonClass('secondary')} onClick={() => void ui.navigate('processes', { process: process.id, tab: 'active' })}>Ouvrir l’assignation en cours</button>}
    </div>}
    {!editing && assigning && <section aria-label="Assigner le client" className="border-t border-[#eadfd2] pt-4"><h3 className="mb-3 font-semibold">Assigner ce client</h3>{professionals.length ? <ActionForm fields={[{ name: 'professionalId', label: 'Professionnel', type: 'select', required: true, options: professionals.map(value => ({ value: value.id, label: `${value.displayName} · ${capacityPlaces(ui.data.capacityRequests, value.id)} place(s)` })) }, { name: 'openingFee', label: 'Frais d’ouverture du dossier', type: 'select', required: true, initial: ui.data.assignments.some(value => value.clientId === item.clientId) || item.priority === 'existing_or_transfer' ? 'waive' : 'charge', options: openingFeeOptions }, { name: 'openingReason', label: 'Précision si le dossier existe déjà (facultative)', type: 'textarea', maxLength: 500 }]} submitLabel="Confirmer l’assignation" onSubmit={async values => { await recordOpeningFeeChoice(ui, item.clientId, text(values.openingFee), text(values.openingReason)); const result = await ui.run('admissions.assign', item.id, { expectedVersion: item.version, professionalId: text(values.professionalId) }); return () => onAssigned(result.result.id, result.workspace.notifications) }} /> : <p>Aucun professionnel avec une place disponible.</p>}</section>}
    {!editing && tasking && <section aria-label="Envoyer aux tâches administratives" className="border-t border-[#eadfd2] pt-4"><h3 className="mb-2 font-semibold">Tâche aux adjointes</h3><p className="mb-3 text-sm">Choisissez le professionnel à contacter. Le client reste dans la liste d’attente.</p><ActionForm fields={[{ name: 'professionalId', label: 'Professionnel envisagé', type: 'select', required: true, options: ui.data.professionals.filter(value => value.isActive && value.canPractice).map(value => ({ value: value.id, label: value.displayName })) }]} submitLabel="Créer la tâche administrative" onSubmit={async values => { const professional = ui.data.professionals.find(value => value.id === text(values.professionalId)); if (!professional) throw new Error('Choisissez un professionnel actif.'); await ui.run('tasks.create', null, { admissionId: item.id, kind: 'assignment_support', targetProfessionalId: professional.id, title: `Assigner ${item.firstName} ${item.lastName} à ${professional.displayName}`, dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }); return () => ui.navigate('tasks', { tab: null }) }} /></section>}
    {!editing && !process && !occupied && item.stage !== 'waiting' && <button className={buttonClass('ghost')} disabled={ui.busy} onClick={async () => { if (!window.confirm('Remettre ce client dans la liste d’attente ?')) return; try { await ui.run('admissions.restore', item.id, { expectedVersion: item.version, reason: 'Retour en liste d’attente confirmé depuis la fiche client.' }); onClose() } catch { /* L’erreur est affichée par le module. */ } }}>Remettre en liste d’attente</button>}
    {ui.data.assignments.some(value => value.admissionId === item.id) && <button className={buttonClass('ghost')} onClick={() => void ui.navigate('assignments', { admission: item.id })}>Voir les assignations</button>}
    <p className="text-xs text-[#8a6f5d]">Demande reçue le {dateTime(item.receivedAt)}</p>
  </div></ProspectDialog>
}
