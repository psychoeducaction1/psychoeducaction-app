'use client'

import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { buttonClass } from '@/components/Ui'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { CalendarForm, Field, inputClass, type CalendarFormHandle } from '@/components/clinical-calendar/primitives'
import type { WorkspaceView } from '@/lib/clinical-core/types'
import type { ClientOverview } from '@/lib/clinical-workspace/clientDetails'
import { clientFileMutation } from './clientFileApi'
import { clientDocumentHref } from './clientFileModel'

export function ClientFileDocuments({ overview, workspace, onCommitted, onAccessDenied }: { overview: ClientOverview; workspace: WorkspaceView; onCommitted: () => Promise<void>; onAccessDenied: (cause: unknown) => void }) {
  const [adding, setAdding] = useState(false), [file, setFile] = useState<File | null>(null), [label, setLabel] = useState(''), [recordId, setRecordId] = useState('')
  const form = useRef<CalendarFormHandle>(null)
  const canAdd = workspace.context === 'administration' ? overview.canUploadAdministrative : overview.uploadClinicalRecordIds.length > 0
  const documents = overview.documents.filter(document => ['uploaded', 'invoice', 'receipt'].includes(document.kind) && document.audience === workspace.context)
  return <section className="grid gap-3"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Documents associés</h3>{canAdd && <button type="button" className={buttonClass('secondary')} onClick={() => setAdding(true)}><Upload size={16} />Ajouter un document</button>}</div>
    {documents.length ? <ul className="grid gap-2">{documents.map(document => <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eadfd2] p-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{document.label}</p><p className="mt-1 text-xs text-[#8a6f5d]">{document.kind === 'invoice' ? 'Facture' : document.kind === 'receipt' ? 'Reçu' : document.audience === 'clinical' ? 'Document clinique' : 'Document administratif'} · {document.createdAt.slice(0, 10)}{document.bytes ? ` · ${Math.ceil(document.bytes / 1024)} ko` : ''}</p></div>{clientDocumentHref(document.downloadHref) && <a className={buttonClass('secondary')} href={document.downloadHref}><Download size={16} />Télécharger</a>}</li>)}</ul> : <p className="text-sm text-[#8a6f5d]">Aucun autre document accessible dans cet espace.</p>}
    {adding && <ProspectDialog compactHeader title="Ajouter un document au client" onClose={() => form.current?.requestCancel()}><CalendarForm submitLabel="Enregistrer le document" formRef={form} onCancel={() => setAdding(false)} changed={Boolean(file || label)} onSave={async () => {
      if (file && file.name.length > 180) throw new Error('Le nom du fichier doit contenir au maximum 180 caractères.')
      if (!file || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size < 1 || file.size > 1024 * 1024) throw new Error('Choisissez un PDF, JPEG ou PNG de 1 Mo maximum.')
      if (workspace.context === 'clinical' && (overview.uploadClinicalRecordIds.length > 1 && !recordId || !overview.uploadClinicalRecordIds.includes(recordId || overview.uploadClinicalRecordIds[0]))) throw new Error('Choisissez un dossier clinique autorisé.')
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      await clientFileMutation({ actorId: workspace.actor.id, context: workspace.context }, `/clients/${overview.clientId}/documents`, { label: label.trim() || file.name, fileName: file.name, mediaType: file.type, dataBase64: btoa(binary), audience: workspace.context, ...(workspace.context === 'clinical' ? { recordId: recordId || overview.uploadClinicalRecordIds[0] } : {}) }, 'POST', onAccessDenied)
      return async () => { setAdding(false); setFile(null); setLabel(''); await onCommitted() }
    }}><Field label="Titre"><input className={inputClass} maxLength={160} value={label} onChange={event => setLabel(event.target.value)} /></Field><Field label="Fichier PDF, JPEG ou PNG (1 Mo maximum)"><input className={inputClass} type="file" required accept="application/pdf,image/jpeg,image/png" onChange={event => setFile(event.target.files?.[0] ?? null)} /></Field>{workspace.context === 'clinical' && overview.uploadClinicalRecordIds.length > 1 && <Field label="Dossier clinique"><select className={inputClass} required value={recordId} onChange={event => setRecordId(event.target.value)}><option value="">Choisir un dossier autorisé</option>{overview.uploadClinicalRecordIds.map(id => <option key={id} value={id}>{workspace.records.find(record => record.id === id)?.label ?? 'Dossier autorisé'}</option>)}</select></Field>}<p className="text-xs text-[#8a6f5d]">Le document reste privé dans cet espace. Aucun envoi ni partage automatique.</p></CalendarForm></ProspectDialog>}
  </section>
}
const communicationStatus = { prepared: 'Préparé', simulated: 'Simulation · aucun envoi', expired: 'Invitation expirée', revoked: 'Invitation révoquée', sent: 'Envoyé', delivered: 'Livraison confirmée', failed: 'Échec d’envoi' }
export function ClientFileCommunications({ overview }: { overview: ClientOverview }) {
  const communications = overview.communications.filter(item => !item.kind.startsWith('mandate') && !item.kind.startsWith('consent'))
  return <section className="grid gap-3"><h3 className="font-semibold">Autres communications associées</h3>{communications.length ? <ol className="grid gap-2">{communications.map(item => <li key={item.id} className="rounded-xl border border-[#eadfd2] p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{item.label}</strong><span className="text-xs text-[#8a6f5d]">{item.simulation ? 'Simulation · aucun envoi réel' : communicationStatus[item.status]}</span></div>{item.recipientLabel && <p className="mt-1 break-words text-[#7a6859]">{item.recipientLabel}</p>}<p className="mt-2 text-xs text-[#8a6f5d]">{new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.at))}</p></li>)}</ol> : <p className="text-sm text-[#8a6f5d]">Aucune autre communication associée à ce client. Les invitations de consentement apparaissent ci-dessus. Aucun envoi réel n’est activé dans ce laboratoire.</p>}</section>
}