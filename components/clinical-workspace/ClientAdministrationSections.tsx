'use client'

import { useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { CalendarForm, Field, inputClass, type CalendarFormHandle } from '@/components/clinical-calendar/primitives'
import { billingAllocations, billingParticipants, initialBillingShares, rebalanceClientShare } from '@/lib/clinical-workspace/billingShares'
import type { ClientOverview } from '@/lib/clinical-workspace/clientDetails'
import { BillingShareFields } from './BillingShareFields'
import { canAdmin } from '@/lib/clinical-core/capabilities'
import type { ClientAdminProjection, ClientPayer, WorkspaceView } from '@/lib/clinical-core/types'
import { ClientFileSection } from './ClientFileIdentity'
import { ClinicalAccessEditor } from './ClinicalAccessEditor'
import { EntityForm } from './EntityForm'
import { clientFileMutation } from './clientFileApi'

/** Existing billing identities and the same allocation used by the mandate. */
export function ClientBillingResponsibles({ client, overview, workspace, onUpdated, onAccessDenied }: {
  client: ClientAdminProjection; overview?: ClientOverview; workspace: WorkspaceView; onUpdated: () => Promise<void>; onAccessDenied: (cause: unknown) => void
}) {
  const [editing, setEditing] = useState<ClientPayer | 'new' | null>(null)
  if (!canAdmin(workspace.actor)) return null
  return <div className="mt-4 grid gap-3 border-t border-[#eee4d9] pt-3">
    {client.payers.length > 0 && <div><h3 className="text-sm font-semibold">Responsables de facturation enregistrés</h3><ul className="mt-2 grid gap-2">{client.payers.map(person => <li key={person.id} className="rounded-xl border border-[#eee4d9] p-3 text-sm">
      <div className="flex items-start justify-between gap-3"><p className="font-semibold">{person.fullName}</p><button type="button" className={buttonClass('ghost') + ' !p-1'} aria-label={'Modifier ' + person.fullName} onClick={() => setEditing(person)}><Pencil size={16} /></button></div>
      <p className="text-[#7a6859]">{person.payerType === 'self' ? 'Client' : person.payerType === 'parent' ? 'Parent / représentant' : 'Organisation'}</p>{person.email && <p className="break-words text-[#7a6859]">{person.email}</p>}
      <p className="mt-1">Part des honoraires : {((person.payerShareBasisPoints ?? 0) / 100).toLocaleString('fr-CA')} %</p>
    </li>)}</ul></div>}
    <button type="button" className={buttonClass('secondary')} onClick={() => setEditing('new')}>Ajouter un responsable de facturation</button>
    {editing && overview && <BillingResponsibleEditor key={editing === 'new' ? 'new' : editing.id + ':' + editing.version} client={client} overview={overview} person={editing === 'new' ? undefined : editing} workspace={workspace} onCancel={() => setEditing(null)} onUpdated={onUpdated} onAccessDenied={onAccessDenied} />}
  </div>
}
function BillingResponsibleEditor({ client, overview, person, workspace, onCancel, onUpdated, onAccessDenied }: {
  client: ClientAdminProjection; overview: ClientOverview; person?: ClientPayer; workspace: WorkspaceView; onCancel: () => void; onUpdated: () => Promise<void>; onAccessDenied: (cause: unknown) => void
}) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Toronto' })
  const participants = billingParticipants(client.id, overview.profile, overview.contacts, today)
  const initial = initialBillingShares(client.id, participants, person?.payerType === 'self' ? client.id : person?.id, person?.payerShareBasisPoints ?? undefined)
  const [name, setName] = useState(person?.fullName ?? ''), [email, setEmail] = useState(person?.email ?? '')
  const [payerType, setType] = useState(person?.payerType ?? 'parent')
  const [share, setShare] = useState(initial.share), [others, setOthers] = useState(initial.others)
  const form = useRef<CalendarFormHandle>(null)
  const clientMayPay = participants.some(row => row.personId === client.id)
  return <ProspectDialog compactHeader title={person ? 'Modifier le responsable de facturation' : 'Ajouter un responsable de facturation'} onClose={() => form.current?.requestCancel()}>
    <CalendarForm formRef={form} submitLabel={person ? 'Enregistrer la répartition' : 'Ajouter le responsable'} onCancel={onCancel} onSave={async () => {
      const allocations = billingAllocations(others, share)
      await clientFileMutation({ actorId: workspace.actor.id, context: workspace.context }, '/clients/' + client.id + '/payers' + (person ? '/' + person.id : ''), { fullName: name, payerType, email, payerShareBasisPoints: share, allocations, ...(person ? { expectedVersion: person.version } : {}) }, person ? 'PATCH' : 'POST', onAccessDenied)
      return async () => { onCancel(); await onUpdated() }
    }}>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Nom complet"><input className={inputClass} required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></Field>
      <Field label="Type"><select className={inputClass} value={payerType} onChange={event => {
        const type = event.target.value as ClientPayer['payerType']; setType(type)
        if (type === 'self') { setName(client.firstName + ' ' + client.lastName); setEmail(overview.profile.email); setOthers(others.filter(row => row.personId !== client.id)) }
        else if (payerType === 'self') setOthers(rebalanceClientShare(client.id, [...others, ...participants.filter(row => row.personId === client.id)], share))
      }}>{clientMayPay && <option value="self">Client</option>}<option value="parent">Parent / représentant</option><option value="organization">Organisation</option></select></Field>
      <Field label="Courriel"><input className={inputClass} type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></Field></div>
      <BillingShareFields share={share} others={others} onShare={value => { setShare(value); setOthers(rebalanceClientShare(client.id, others, value)) }} onOther={(id, value) => { const next = others.map(row => row.personId === id ? { ...row, basisPoints: value } : row); setOthers(id === client.id ? next : rebalanceClientShare(client.id, next, share)) }} />
      <p className="text-sm text-[#7a6859]">Cette répartition est reprise dans le mandat. Un requérant qui participe uniquement au suivi n’a pas besoin d’être responsable de facturation.</p>
    </CalendarForm>
  </ProspectDialog>
}

/** Administrative tools in the original client file; no additional clinical access. */
export function ClientAdministrationSections({ client, workspace, onUpdated, onAccessDenied }: {
  client: ClientAdminProjection; workspace: WorkspaceView; onUpdated: () => Promise<void>; onAccessDenied: (cause: unknown) => void
}) {
  if (!canAdmin(workspace.actor)) return null
  const managed = workspace.managedRecords.filter(record => record.clientId === client.id)
  return <div className="grid gap-4">
    <ClientFileSection title="Notes administratives" open={false}>
      <EntityForm key={`${client.administrativeRecord.id}:${client.administrativeRecord.version}`} resetAfterSubmit={false}
        fields={[{ name: 'administrativeNotes', label: 'Informations administratives', type: 'textarea', defaultValue: client.administrativeRecord.administrativeNotes, includeEmpty: true }]}
        submitLabel="Enregistrer les informations" onSubmit={async values => {
          await clientFileMutation({ actorId: workspace.actor.id, context: workspace.context }, `/clients/${client.id}`, { ...values, expectedVersion: client.administrativeRecord.version }, 'PATCH', onAccessDenied)
          await onUpdated()
        }} />
    </ClientFileSection>
    {managed.length > 0 && <ClientFileSection title="Accès au dossier" open={false}>
      <div className="grid gap-3">{managed.map(record => <div key={record.id} className="rounded-xl border border-[#eadfd2] p-3">
        <p className="font-medium">{record.label}</p>
        <p className="mt-1 text-xs text-[#8a6f5d]">{record.members.some(member => member.canRead)
          ? `Accès accordé à ${record.members.filter(member => member.canRead).map(member => workspace.actors.find(actor => actor.id === member.actorId)?.displayName ?? 'Professionnel').join(', ')}.`
          : 'Aucun accès clinique accordé.'}</p>
        <ClinicalAccessEditor key={record.grantRevision} record={record} workspace={workspace} onUpdated={onUpdated} />
      </div>)}</div>
      <p className="mt-3 text-sm text-[#8a6f5d]">Votre accès administratif ne donne pas accès aux notes cliniques.</p>
    </ClientFileSection>}
  </div>
}
