'use client'

import { useState } from 'react'
import { canAdmin, hasCapability } from '@/lib/clinical-core/capabilities'
import { ClipboardList, LockKeyhole } from 'lucide-react'
import { Badge, buttonClass } from '@/components/Ui'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import type { ClientAdminProjection, ClinicalRecordSummary, RecordGrant, WorkspaceView } from '@/lib/clinical-core/types'
import { EntityForm, type FormField } from './EntityForm'
import { ClinicalAccessEditor } from './ClinicalAccessEditor'
import { clinicalCard, clinicalInput, clinicalLabel } from './styles'
import { useClinicalFormGuard } from './NavigationGuard'

function AddSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <details className="rounded-xl border border-[#eadfd2] bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-[#5d4a3d]">{title}</summary><div className="mt-4">{children}</div></details>
}

export function ClientManagementPanel({ client, workspace, onUpdated, onOpenRecord, onOpenAdmission, onOpenCalendar, onOpenMandates, onOpenBilling }: {
  client: ClientAdminProjection; workspace: WorkspaceView; onUpdated: () => Promise<void>; onOpenRecord: (record: ClinicalRecordSummary) => void; onOpenAdmission: () => void; onOpenCalendar: () => void; onOpenMandates: (episodeId?: string) => void; onOpenBilling?: () => void
}) {
  const administrative = canAdmin(workspace.actor)
  const readable = workspace.records.filter(record => record.clientId === client.id)
  const managed = workspace.managedRecords.filter(record => record.clientId === client.id)
  const update = async (path: string, values: Record<string, unknown>, method = 'POST') => { await clinicalRequest({ actorId: workspace.actor.id, context: workspace.context }, `/clients/${client.id}${path}`, values, method); await onUpdated() }
  const nameFields: FormField[] = [{ name: 'fullName', label: 'Nom complet', required: true }, { name: 'relationship', label: 'Lien avec le client' }]
  return <div className="grid min-w-0 gap-5">
    <section className={clinicalCard}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-[#8a6f5d]">Dossier administratif</p><h2 className="mt-1 text-2xl font-semibold">{client.firstName} {client.lastName}</h2><p className="mt-2 break-all text-xs text-[#8a6f5d]">Identité permanente · {client.id}</p></div><Badge tone="muted">Données fictives</Badge></div>
      {workspace.durable && <div className="mt-4 flex flex-wrap gap-2"><button className={buttonClass('secondary')} onClick={onOpenCalendar}>Calendrier et activités de ce client</button><button className={buttonClass('secondary')} onClick={() => onOpenMandates()}>Mandats et consentements</button>{administrative && onOpenBilling && <button className={buttonClass('secondary')} onClick={onOpenBilling}>Facturation de ce client</button>}</div>}
      <div className="mt-5 grid gap-5 sm:grid-cols-2"><div><h3 className="mb-2 font-semibold">Coordonnées</h3>{client.contacts.length ? client.contacts.map(contact => <div key={contact.id} className="mb-3 text-sm"><p className="font-medium">{contact.fullName}{contact.relationship && ` · ${contact.relationship}`}</p><p className="break-all text-[#7a6859]">{[contact.email, contact.phone].filter(Boolean).join(' · ') || 'Coordonnées non renseignées'}</p></div>) : <p className="text-sm text-[#8a6f5d]">Aucun contact associé.</p>}</div>
        <div><h3 className="mb-2 font-semibold">Représentants légaux</h3>{client.representatives.length ? client.representatives.map(person => <p key={person.id} className="mb-2 text-sm">{person.fullName} · {person.relationship}<span className="block text-xs text-[#8a6f5d]">{person.authorityVerified ? 'Autorité vérifiée' : 'Autorité à vérifier'}</span></p>) : <p className="text-sm text-[#8a6f5d]">Aucun représentant déclaré.</p>}</div>
        {administrative && <div className="sm:col-span-2"><h3 className="mb-2 font-semibold">Responsables des honoraires</h3>{client.payers.length ? client.payers.map(person => <p key={person.id} className="mb-2 text-sm">{person.fullName}<span className="text-[#8a6f5d]"> · {person.payerType === 'self' ? 'Client' : person.payerType === 'parent' ? 'Parent / représentant' : 'Organisation'}{person.email && ` · ${person.email}`}</span></p>) : <p className="text-sm text-[#8a6f5d]">Aucun responsable des honoraires.</p>}</div>}
      </div>
      {administrative && <div className="mt-5 grid gap-3"><AddSection title="Ajouter un contact"><EntityForm fields={[...nameFields, { name: 'email', label: 'Courriel', type: 'email' }, { name: 'phone', label: 'Téléphone' }]} submitLabel="Ajouter le contact" onSubmit={values => update('/contacts', values)} /></AddSection>
        <AddSection title="Ajouter un représentant légal"><EntityForm fields={[...nameFields.map(field => ({ ...field, required: true })), { name: 'authorityVerified', label: 'L’autorité du représentant a été vérifiée.', type: 'checkbox' }]} submitLabel="Ajouter le représentant" onSubmit={values => update('/representatives', values)} /></AddSection>
        <AddSection title="Ajouter un responsable des honoraires"><EntityForm fields={[{ name: 'fullName', label: 'Nom complet', required: true }, { name: 'payerType', label: 'Type', type: 'select', required: true, options: [{ value: 'self', label: 'Client' }, { value: 'parent', label: 'Parent / représentant' }, { value: 'organization', label: 'Organisation' }] }, { name: 'email', label: 'Courriel', type: 'email' }]} submitLabel="Ajouter le responsable" onSubmit={values => update('/payers', values)} /></AddSection>
        <AddSection title="Notes administratives"><EntityForm key={`${client.administrativeRecord.id}:${client.administrativeRecord.version}`} resetAfterSubmit={false} fields={[{ name: 'administrativeNotes', label: 'Informations administratives', type: 'textarea', defaultValue: client.administrativeRecord.administrativeNotes, includeEmpty: true }]} submitLabel="Enregistrer les informations" onSubmit={values => update('', { ...values, expectedVersion: client.administrativeRecord.version }, 'PATCH')} /></AddSection>
      </div>}
    </section>
    <section className={clinicalCard}><h3 className="mb-3 flex items-center gap-2 font-semibold"><ClipboardList size={18} />Demandes et épisodes de service</h3>
      <div className="grid gap-3">{client.requests.map(request => <div key={request.id} className="rounded-xl bg-[#f7f1e9] p-3 text-sm"><strong>{request.service}</strong><p className="mt-1 text-[#7a6859]">{request.administrativeReason || 'Demande sans précision administrative.'}</p>
          {administrative && request.status === 'open' && <div className="mt-3 grid gap-3"><button className={buttonClass('ghost')} onClick={onOpenAdmission}>Ouvrir l’admission et les capacités professionnelles</button><AddSection title="Assigner cette demande de service existante"><p className="mb-3 text-xs text-[#8a6f5d]">Une demande de capacité active avec une place disponible est requise. L’assignation ouvre ou rattache le dossier clinique du professionnel.</p><EntityForm fields={[{ name: 'professionalId', label: 'Professionnel', type: 'select', required: true, options: workspace.actors.filter(actor => hasCapability(actor, 'practice')).map(actor => ({ value: actor.id, label: actor.displayName })) }, { name: 'label', label: 'Libellé du nouvel épisode', required: true, defaultValue: 'Suivi fictif', maxLength: 160 }]} submitLabel="Assigner avec contrôle de capacité" onSubmit={values => update('/assign', { ...values, requestId: request.id })} /></AddSection></div>}
        </div>)}
        {client.episodes.map(episode => <div key={episode.id} className="flex flex-wrap justify-between gap-2 rounded-xl border border-[#eadfd2] p-3 text-sm"><span>{episode.label}</span>{workspace.durable && <button className="underline" onClick={() => onOpenMandates(episode.id)}>Mandats de cet épisode</button>}<Badge tone={episode.status === 'open' ? 'success' : 'muted'}>{episode.status === 'open' ? 'En cours' : 'Fermé'}</Badge></div>)}
        {!client.requests.length && !client.episodes.length && <p className="text-sm text-[#8a6f5d]">Aucune demande ni épisode de service.</p>}
      </div>
      {administrative && <div className="mt-4 grid gap-3"><AddSection title="Créer une demande"><EntityForm fields={[{ name: 'service', label: 'Service demandé', required: true }, { name: 'administrativeReason', label: 'Précisions administratives', type: 'textarea' }]} submitLabel="Créer la demande" onSubmit={values => update('/requests', values)} /></AddSection>
        <AddSection title="Ouvrir un épisode de service"><EntityForm fields={[{ name: 'label', label: 'Nom de l’épisode', required: true }, { name: 'requestId', label: 'Demande associée (facultatif)', type: 'select', options: client.requests.map(request => ({ value: request.id, label: request.service })) }]} submitLabel="Ouvrir l’épisode" onSubmit={values => update('/episodes', values)} /></AddSection></div>}
      {client.assignments.length > 0 && <div className="mt-5"><h4 className="font-semibold">Historique des assignations locales</h4><ul className="mt-3 grid gap-2">{client.assignments.map(item => <li key={item.id} className="rounded-xl border border-[#eadfd2] p-3 text-sm"><p className="font-medium">{workspace.actors.find(actor => actor.id === item.professionalId)?.displayName ?? 'Professionnel'}</p><p className="mt-1 text-[#7a6859]">{client.episodes.find(episode => episode.id === item.episodeId)?.label ?? 'Épisode associé'} · {item.status === 'active' ? 'Assignation active' : 'Assignation fermée'}</p><p className="mt-1 text-xs text-[#8a6f5d]">{new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.assignedAt))}</p></li>)}</ul></div>}
    </section>
    <section className={clinicalCard}><h3 className="mb-3 flex items-center gap-2 font-semibold"><LockKeyhole size={18} />Dossiers cliniques</h3>
      {readable.map(record => <button key={record.id} className={`${buttonClass('secondary')} mb-2 !w-full justify-between`} onClick={() => onOpenRecord(record)}><span>{record.label}</span><span>Ouvrir →</span></button>)}
      {managed.map(record => <div key={record.id} className="mb-3 rounded-xl border border-[#eadfd2] p-3"><p className="font-medium">{record.label}</p><p className="mt-1 text-xs text-[#8a6f5d]">{record.members.length ? `Accès accordé à ${record.members.map(member => workspace.actors.find(actor => actor.id === member.actorId)?.displayName ?? 'Professionnel').join(', ')}.` : 'Aucun accès clinique accordé.'} Le contenu reste réservé aux personnes autorisées.</p><ClinicalAccessEditor key={record.grantRevision} record={record} workspace={workspace} onUpdated={onUpdated} /></div>)}
      {!readable.length && !managed.length && <p className="text-sm text-[#8a6f5d]">{administrative ? 'Aucun dossier clinique préparé pour ce client.' : 'Aucun dossier clinique accessible.'}</p>}
      {canAdmin(workspace.actor) && <div className="mt-4"><ClinicalAccessForm client={client} workspace={workspace} onCreated={onUpdated} /></div>}
      {administrative && <p className="mt-3 text-sm text-[#8a6f5d]">Votre accès administratif ne donne pas accès aux notes cliniques.</p>}
    </section>
  </div>
}

function ClinicalAccessForm({ client, workspace, onCreated }: { client: ClientAdminProjection; workspace: WorkspaceView; onCreated: () => Promise<void> }) {
  const availableEpisodes = client.episodes.filter(episode => episode.status === 'open' && !workspace.managedRecords.some(record => record.episodeId === episode.id))
  const [episodeId, setEpisodeId] = useState(availableEpisodes[0]?.id ?? '')
  const [professionalId, setProfessionalId] = useState(workspace.actors.find(actor => hasCapability(actor, 'practice'))?.id ?? '')
  const [supervisorId, setSupervisorId] = useState('')
  const [label, setLabel] = useState('Dossier de suivi')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  useClinicalFormGuard(Boolean(availableEpisodes.length) && dirty, busy)
  if (!availableEpisodes.length) return <p className="text-sm text-[#8a6f5d]">Pour créer un autre dossier clinique, ouvrez d’abord un nouvel épisode de service.</p>
  const selectedEpisode = availableEpisodes.some(episode => episode.id === episodeId) ? episodeId : availableEpisodes[0].id
  return <details className="rounded-xl border border-[#eadfd2] bg-[#f7f1e9] p-4"><summary className="cursor-pointer text-sm font-semibold">Créer un dossier pour un épisode sans assignation</summary><form className="mt-4 grid gap-3" onChange={() => setDirty(true)} onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('')
    const members: RecordGrant[] = [{ actorId: professionalId, canRead: true, canWrite: true, canCosign: false, requiresCosignature: Boolean(supervisorId), supervisorId: supervisorId || null }]
    if (supervisorId) members.push({ actorId: supervisorId, canRead: true, canWrite: false, canCosign: true, requiresCosignature: false, supervisorId: null })
    try { await clinicalRequest({ actorId: workspace.actor.id, context: workspace.context }, '/records', { clientId: client.id, episodeId: selectedEpisode, label, members }, 'POST'); setDirty(false); await onCreated() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Création impossible.') } finally { setBusy(false) }
  }}><label className={clinicalLabel}>Épisode<select required value={selectedEpisode} onChange={event => setEpisodeId(event.target.value)} className={clinicalInput}>{availableEpisodes.map(episode => <option key={episode.id} value={episode.id}>{episode.label}</option>)}</select></label>
    <label className={clinicalLabel}>Libellé du dossier<input required value={label} maxLength={150} onChange={event => setLabel(event.target.value)} className={clinicalInput} /></label>
    <label className={clinicalLabel}>Professionnel autorisé<select required value={professionalId} onChange={event => { setProfessionalId(event.target.value); if (supervisorId === event.target.value) setSupervisorId('') }} className={clinicalInput}>{workspace.actors.filter(actor => hasCapability(actor, 'practice') || hasCapability(actor, 'supervision')).map(actor => <option key={actor.id} value={actor.id}>{actor.displayName}</option>)}</select></label>
    <label className={clinicalLabel}>Supervision avec cosignature<select value={supervisorId} onChange={event => setSupervisorId(event.target.value)} className={clinicalInput}><option value="">Aucune cosignature requise</option>{workspace.actors.filter(actor => hasCapability(actor, 'supervision') && actor.id !== professionalId).map(actor => <option key={actor.id} value={actor.id}>{actor.displayName}</option>)}</select></label>
    <p className="text-xs leading-5 text-[#7a6859]">Cette action accorde un accès explicite au professionnel et, si choisi, au superviseur de ce dossier. Elle ne vous donne pas accès au contenu clinique.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}<button className={buttonClass('secondary')} disabled={busy}>{busy ? 'Création…' : 'Créer et accorder les accès'}</button>
  </form></details>
}

