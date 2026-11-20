'use client'

import { useEffect, useState } from 'react'
import { workspaceHref } from '@/lib/clinical-workspace/navigation'
import { Badge, buttonClass } from '@/components/Ui'
import { useClinicalNavigation } from '@/components/clinical-workspace/NavigationGuard'
import type { ClientAdminProjection } from '@/lib/clinical-core/types'
import type { ClientOverview } from '@/lib/clinical-workspace/clientDetails'
import type { ClinicalMandateRevision, MandateRevision, MandateSigner } from '@/lib/clinical-mandates/types'
import { Field, Fold, MandateForm, inputClass, type MandateUi } from './primitives'
import { audienceLabels, documentForSigner, hasSignedClinicalConsent, mayLocallySign, moneyLabel, requiredSignaturesComplete, roleLabels, statusLabels, timeLabel } from './model'
import { SignatureCapture } from './SignatureCapture'
import { MandateEditor } from './MandateEditor'
import { ProspectDialog } from '@/components/intake/ProspectDialog'
import { authenticatedDocumentUrl, mandatePreviewUrl } from '@/lib/clinical-mandates/client'
import { ConsentDeliveryPanel, useConsentDelivery } from './ConsentDeliveryPanel'
import { clinicalRequest } from '@/lib/clinical-workspace/api'
import { isSignatureEvidence } from '@/lib/clinical-mandates/validation'
import { newestMandateDocument } from '@/lib/clinical-mandates/documentOrder'

export function MandateDetail({ ui, coreClients, requesterFile, compact = false, onEditRequesters, delivery }: { ui: MandateUi; coreClients: ClientAdminProjection[]; requesterFile?: ClientOverview; compact?: boolean; onEditRequesters?: () => void; delivery?: ReturnType<typeof useConsentDelivery> }) {
  const selected = ui.data.selected, navigation = useClinicalNavigation()
  const [revisionId, setRevisionId] = useState('')
  const [editing, setEditing] = useState(false)
  const [action, setAction] = useState<'sign'|'remote'|'signatures'|'history'|null>(null)
  const [selectedSignerId, setSelectedSignerId] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [actionError, setActionError] = useState('')
  if (!selected) return null
  const revision = selected.revisions.find(item => item.id === revisionId) ?? selected.revisions.find(item => item.id === selected.mandate.currentRevisionId) ?? selected.revisions[0]
  if (!revision) return <p>Aucune version autorisée.</p>
  const administrative = ui.data.context === 'administration', current = revision.id === selected.mandate.currentRevisionId
  const adminRevision = (administrative || revision.draft.professionalId === ui.data.actor.id) && 'people' in revision.draft ? revision as MandateRevision : null
  const visibleAudience = administrative ? 'administrative' : 'clinical'
  const primaryDocument = [...revision.documents].filter(document => document.audience === visibleAudience)
    .sort(newestMandateDocument)
    .find(document => document.kind === 'proof') ?? revision.documents.find(document => document.kind === 'convention' && document.audience === visibleAudience)
  const candidates = revision.draft.signers
  const selectedSigner = candidates.find(signer => signer.id === selectedSignerId) ?? candidates[0]
  const revisionPeople = adminRevision?.draft.people ?? []
  const recipientEmails = Object.fromEntries(revision.draft.signers.map(signer => [signer.id, revisionPeople.find(person => person.id === signer.personId)?.email ?? '']))
  const openSigning = async (next: 'sign' | 'remote') => {
    if (ui.busy || preparing) return
    setActionError('')
    if (revision.status === 'draft') {
      setPreparing(true)
      try {
        await ui.command({ action: 'mandate.prepare', data: { mandateId: selected.mandate.id, revisionId: revision.id, expectedVersion: revision.version } })
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : 'La convention ne peut pas encore être signée.')
        return
      } finally {
        setPreparing(false)
      }
    }
    setAction(next)
  }
  const openEditor = async () => {
    if (ui.busy || !adminRevision || !current) return
    setActionError('')
    if (revision.status !== 'draft') {
      try {
        await ui.command({ action: 'mandate.amend', data: {
          mandateId: selected.mandate.id,
          revisionId: revision.id,
          expectedVersion: revision.version,
          reason: 'Modification du mandat',
        } })
        setRevisionId('')
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : 'La modification du mandat a échoué.')
        return
      }
    }
    setEditing(true)
  }
  return <div className="grid min-w-0 gap-4" data-mandate-person-ids={revisionPeople.map(person => person.id).join(',')}>
    {!compact && <section className="rounded-2xl border border-[#eadfd2] bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-semibold">{selected.mandate.clientName}</h3><p className="mt-1 text-sm">{selected.mandate.episodeLabel} · {selected.mandate.serviceLabel}</p></div><Badge tone={revision.status === 'signed' || revision.status === 'archived' ? 'success' : 'neutral'}>{statusLabels[revision.status]}</Badge></div><div className="mt-4"><Field label="Version conservée"><select className={inputClass} value={revision.id} onChange={event => { const id = event.target.value; void navigation.canLeave().then(allowed => { if (allowed) setRevisionId(id) }) }}>{[...selected.revisions].sort((a, b) => b.number - a.number).map(item => <option key={item.id} value={item.id}>Version {item.number} · {statusLabels[item.status]}{item.id === selected.mandate.currentRevisionId ? ' · actuelle' : ''}</option>)}</select></Field></div></section>}
    <RevisionSummary revision={revision} ui={ui} episodeId={selected.mandate.episodeId} />
    {revision.professionalAcceptances?.map(acceptance=><p key={acceptance.profileId} className="text-sm text-[#7a6859]">{acceptance.role==='supervisor'?'Supervision':'Professionnel'} · acceptation automatique du mandat : {timeLabel(acceptance.effectiveAt)}.{!acceptance.graphicAddedAt&&' L’image de signature sera ajoutée après son enregistrement dans le profil, sans changer cette date.'}</p>)}
    {revision.supervisorSignatureStatus === 'missing' && <p className="text-sm text-amber-800">La signature de la superviseure sera ajoutée automatiquement après son enregistrement dans son profil.</p>}
    {revision.professionalSignatureStatus === 'missing' && <p className="text-sm text-amber-800">La signature du professionnel doit être enregistrée dans son profil pour être ajoutée automatiquement à la convention.</p>}
    {adminRevision && current && <button type="button" data-edit-mandate className={buttonClass('secondary')+' justify-self-start'} disabled={ui.busy} onClick={()=>void openEditor()}>Modifier le mandat</button>}
    {editing && adminRevision && <ProspectDialog title="Modifier le mandat" compactHeader onClose={()=>void navigation.canLeave().then(ok=>{if(ok)setEditing(false)})}><MandateEditor key={revision.id + ':' + revision.version} ui={ui} coreClients={coreClients} requesterFile={requesterFile} clientId={selected.mandate.clientId} episodeId={selected.mandate.episodeId} revision={adminRevision} mandateId={selected.mandate.id} embedded onSaved={()=>setEditing(false)} onEditRequesters={onEditRequesters ? () => void navigation.canLeave().then(ok => { if (ok) { setEditing(false); onEditRequesters() } }) : undefined}/></ProspectDialog>}
    <div className="flex flex-wrap gap-2" aria-label="Actions du mandat"><a className={buttonClass('secondary')} href={primaryDocument ? authenticatedDocumentUrl(primaryDocument.id,ui.data.context) : mandatePreviewUrl(revision.id,ui.data.context)} target="_blank" rel="noopener noreferrer">Consulter le PDF</a><button type="button" className={buttonClass('secondary')} disabled={ui.busy||preparing} onClick={()=>void openSigning('sign')}>Signer sur place</button><button type="button" className={buttonClass('secondary')} disabled={ui.busy||preparing||!delivery} onClick={()=>void openSigning('remote')}>Signature à distance</button>{!compact && <button type="button" className={buttonClass('ghost')} onClick={()=>setAction('history')}>Historique</button>}</div>
    {actionError && <p role="alert" className="text-sm text-red-800">{actionError}</p>}
    {(action==='sign'||action==='signatures')&&revision.status!=='draft'&&<ProspectDialog compactHeader title={action==='sign'?'Faire signer sur place':'Statut des signatures'} onClose={()=>void navigation.canLeave().then(ok=>{if(ok)setAction(null)})}><div className="grid gap-4">{action==='signatures'?revision.draft.signers.map(signer=><SignerPanel key={signer.id} signer={signer} revision={revision} ui={ui} mandateId={selected.mandate.id} current={current} mode="status" />):candidates.length?<><Field label="Personne concernée"><select className={inputClass} value={selectedSigner?.id??''} onChange={event=>setSelectedSignerId(event.target.value)}>{candidates.map(signer=><option key={signer.id} value={signer.id}>{signer.name} · {roleLabels[signer.role]}</option>)}</select></Field>{selectedSigner&&<SignerPanel key={selectedSigner.id} signer={selectedSigner} revision={revision} ui={ui} mandateId={selected.mandate.id} current={current} mode="local" />}</>:<p className="text-sm">Aucune signature en attente pour cette version.</p>}</div></ProspectDialog>}
    {action==='remote' && delivery && revision.status!=='draft' && <ProspectDialog compactHeader title="Signature à distance" onClose={()=>setAction(null)}><ConsentDeliveryPanel ui={delivery} revisionId={revision.id} recipientEmails={recipientEmails}/></ProspectDialog>}
    {action==='history'&&<ProspectDialog compactHeader title="Anciennes versions et historique" onClose={()=>void navigation.canLeave().then(ok=>{if(ok)setAction(null)})}><div className="grid gap-4">{administrative && current && revision.status !== 'draft' && revision.status !== 'archived' && <Fold title="Archiver la version signée"><MandateForm disabled={ui.busy || !requiredSignaturesComplete(revision)} submitLabel="Archiver et produire la preuve PDF" onSave={async () => { if (!window.confirm('Archiver cette version et conserver sa preuve de signature ?')) throw new Error('Archivage annulé.'); await ui.command({ action: 'mandate.archive', data: { mandateId: selected.mandate.id, revisionId: revision.id, expectedVersion: revision.version } }) }}><p className="text-xs">Toutes les signatures obligatoires doivent être confirmées avant l’archivage. L’original et l’historique restent accessibles.</p></MandateForm>
    </Fold>}<section className="rounded-xl border border-[#eadfd2] bg-white p-4"><h4 className="mb-3 font-semibold">Historique ({selected.history.length})</h4><ol className="grid gap-3 text-sm">{[...selected.history].reverse().map(event => <li key={event.id} className="border-l-2 border-[#d8b992] pl-3"><p>{historyLabel(event.action)} · {timeLabel(event.at)}</p><p className="mt-1 text-xs text-[#8a6f5d]">{event.source === 'external_demo' ? 'Portail fictif externe' : event.actorId === ui.data.actor.id ? 'Vous' : 'Compte autorisé'}</p>{event.detail && <p className="whitespace-pre-wrap">{event.detail}</p>}</li>)}</ol></section></div></ProspectDialog>}
  </div>
}
function RevisionSummary({ revision, ui, episodeId }: { revision: MandateRevision | ClinicalMandateRevision; ui: MandateUi; episodeId: string }) {
  const administrative = ui.data.context === 'administration', draft = revision.draft
  const adminDraft = administrative || draft.professionalId === ui.data.actor.id && 'rateId' in draft ? (revision as MandateRevision).draft : null
  const rate = adminDraft ? ui.data.services.flatMap(service => service.rates ?? []).find(rate => rate.id === adminDraft.rateId) : undefined
  const service = ui.data.services.find(item => item.id === draft.serviceId)
  const template = ui.data.templates.find(item => item.id === draft.templateId)
  const professional = ui.data.professionals.find(item => item.id === draft.professionalId)
  const supervisor = ui.data.professionals.find(item => item.id === draft.supervisorId)
  const episode = ui.data.episodes.find(item => item.id === episodeId)
  const profileLink = (id: string, name: string) => administrative ? <a className="text-[#8a5633] underline underline-offset-2" href={workspaceHref('administration', 'professionals', { professional: id })}>{name}</a> : name
  return <section className="rounded-xl border border-[#eadfd2] bg-white p-4"><dl className="grid gap-x-8 gap-y-4 text-sm md:grid-cols-2"><div className="grid content-start gap-3"><div><dt className="font-semibold">Courant</dt><dd>{episode?.status === 'open' ? 'Oui' : 'Non'}</dd></div><div><dt className="font-semibold">Début</dt><dd>{draft.serviceDate}</dd></div><div><dt className="font-semibold">Titre</dt><dd>{template?.title ?? 'Convention de consentement'}</dd></div><div><dt className="font-semibold">Description du service</dt><dd>{service?.label ?? 'À préciser'}</dd></div>{adminDraft?.administrativeText && <div><dt className="font-semibold">Conditions et modalités</dt><dd className="whitespace-pre-wrap">{adminDraft.administrativeText}</dd></div>}{adminDraft && <div><dt className="font-semibold">Taux horaire</dt><dd>{adminDraft.overrideCents !== null ? moneyLabel(adminDraft.overrideCents) : rate ? moneyLabel(rate.amountCents) : 'À préciser'}</dd></div>}</div><div className="grid content-start gap-3"><div><dt className="font-semibold">Professionnel</dt><dd>{professional ? profileLink(professional.id, professional.name) : 'À préciser'}</dd></div>{supervisor && <div><dt className="font-semibold">Superviseur</dt><dd>{profileLink(supervisor.id, supervisor.name)}</dd></div>}{adminDraft && <div><dt className="font-semibold">Requérants responsables des honoraires</dt><dd>{adminDraft.payers.length ? adminDraft.payers.map(payer => (adminDraft.people.find(person => person.id === payer.personId)?.name ?? 'Payeur') + ' · ' + (payer.basisPoints / 100).toLocaleString('fr-CA') + ' %').join(' · ') : 'À préciser'}</dd></div>}</div></dl>{adminDraft?.overrideReason && <p className="mt-4 text-sm"><strong>Exception tarifaire :</strong> {adminDraft.overrideReason}</p>}</section>
}
function SignerPanel({ signer, revision, ui, mandateId, current, mode }: { signer: MandateSigner; revision: MandateRevision | ClinicalMandateRevision; ui: MandateUi; mandateId: string; current: boolean; mode: 'local' | 'status' }) {
  const [opened, setOpened] = useState<{ id: string; hash: string } | null>(null)
  const signature = revision.signatures.find(item => item.signerId === signer.id), document = documentForSigner(revision, signer)
  const canSign = current && !signature && revision.status !== 'archived' && mayLocallySign(signer, ui.data.context, ui.data.actor.id)
  const notesEntitlement = signer.personId && hasSignedClinicalConsent(revision, signer.personId)
  return <section className="rounded-xl border border-[#eadfd2] p-4"><h4 className="font-semibold">{signer.name} · {roleLabels[signer.role]}</h4><p className="mt-1 text-sm">{audienceLabels[signer.audience]} · {signer.required ? 'Obligatoire' : 'Facultatif'}</p>{mode === 'status' && signer.personId && (notesEntitlement ? <p className="mt-2 text-sm text-green-800">Consentement clinique signé : droit aux notes, à traiter par le professionnel.</p> : signer.role === 'payer' ? <p className="mt-2 text-sm text-[#7a6859]">Honoraires seulement : aucun droit aux notes cliniques.</p> : null)}{signature ? <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm"><p>Signé le {timeLabel(signature.signedAt)} · {signature.automatic ? 'Signature professionnelle automatique' : signature.mode === 'remote_demo' ? 'Portail à distance simulé' : signature.mode === 'local_drawn' ? 'Dessin local fictif' : 'Clavier local fictif'}</p><p className="mt-1 break-all font-mono text-[10px]">{signature.documentHash}</p></div> : mode === 'local' && canSign && document ? <><a className={buttonClass('secondary') + ' mt-3'} href={authenticatedDocumentUrl(document.id, ui.data.context)} target="_blank" rel="noopener noreferrer" onClick={() => setOpened({ id: document.id, hash: document.sha256 })}>Lire la convention</a><SignatureCapture expectedName={signer.name} documentHash={document.sha256} documentOpened={opened?.id === document.id && opened.hash === document.sha256} disabled={ui.busy} onSign={async evidence => { await ui.command({ action: 'signature.local', data: { mandateId, revisionId: revision.id, expectedVersion: revision.version, signerId: signer.id, documentId: document.id, documentHash: document.sha256, evidence } }) }} /><SavedProfileSignatureButton signer={signer} revision={revision} ui={ui} mandateId={mandateId} documentId={document.id} documentHash={document.sha256} documentOpened={opened?.id === document.id && opened.hash === document.sha256} /></> : mode === 'local' && !signature && signer.profileId ? <ProfileSignatureAccess profileId={signer.profileId} actorId={ui.data.actor.id} context={ui.data.context} mandateId={mandateId} available={current && revision.status !== 'archived'} busy={ui.busy} /> : mode === 'status' ? <p className="mt-3 text-sm text-[#8a6f5d]">Signature en attente.</p> : null}
  </section>
}
function SavedProfileSignatureButton({ signer, revision, ui, mandateId, documentId, documentHash, documentOpened }: {
  signer: MandateSigner; revision: MandateRevision | ClinicalMandateRevision; ui: MandateUi;
  mandateId: string; documentId: string; documentHash: string; documentOpened: boolean
}) {
  const [saved, setSaved] = useState<{ id: string; strokes: { x: number; y: number }[][] } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (ui.data.context !== 'clinical' || signer.profileId !== ui.data.actor.id) return
    const controller = new AbortController()
    void clinicalRequest<{ professional: { signature: { id: string; strokes: unknown } | null } }>(
      { actorId: ui.data.actor.id, context: 'clinical' }, '/professionals/self', undefined, 'GET', controller.signal,
    ).then(result => {
      const signature = result.professional?.signature
      const evidence = { name: signer.name, attested: true, strokes: signature?.strokes, profileSignatureId: signature?.id }
      if (signature && isSignatureEvidence(evidence) && evidence.strokes) {
        setSaved({ id: signature.id, strokes: evidence.strokes })
      }
    }).catch(() => setSaved(null))
    return () => controller.abort()
  }, [signer.name, signer.profileId, ui.data.actor.id, ui.data.context])
  if (!saved) return null
  return <div className="mt-3 grid justify-items-start gap-2">
    <button type="button" className={buttonClass('secondary')} disabled={!documentOpened || ui.busy}
      onClick={async () => {
        if (!window.confirm('Apposer votre signature enregistrée sur cette version exacte de la convention ?')) return
        setError('')
        try {
          await ui.command({ action: 'signature.local', data: {
            mandateId, revisionId: revision.id, expectedVersion: revision.version, signerId: signer.id,
            documentId, documentHash,
            evidence: { name: signer.name, attested: true, strokes: saved.strokes, profileSignatureId: saved.id },
          } })
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Signature non enregistrée.') }
      }}>Utiliser ma signature enregistrée</button>
    {!documentOpened && <p className="text-xs text-[#8a6f5d]">Ouvrez d’abord la convention exacte à signer.</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
  </div>
}
function historyLabel(action: string) {
  const labels: Record<string, string> = { 'invitation.prepare_demo': 'Invitation préparée sans envoi', 'invitation.renew_demo': 'Invitation renouvelée sans envoi', 'invitation.remind_demo': 'Relance préparée sans envoi', 'invitation.revoke_demo': 'Invitation révoquée', 'mandate.create': 'Mandat créé', 'mandate.update': 'Brouillon modifié', 'mandate.prepare': 'Documents figés', 'mandate.amend': 'Avenant créé', 'mandate.archive': 'Version archivée', 'signature.local': 'Signature locale', 'invitation.create': 'Invitation simulée créée', 'invitation.revoke': 'Invitation révoquée', 'portal.sign': 'Signature à distance simulée', 'document.read': 'Document ouvert', mandate_created: 'Mandat créé', mandate_updated: 'Brouillon modifié', mandate_prepared: 'Documents figés', mandate_amended: 'Avenant créé', mandate_archived: 'Version archivée', signature_recorded: 'Signature enregistrée', signature_local: 'Signature locale', invitation_created: 'Invitation simulée créée', invitation_revoked: 'Invitation révoquée', invitation_consumed: 'Invitation utilisée', document_read: 'Document demandé', document_downloaded: 'Document ouvert', rate_added: 'Tarif daté ajouté', template_added: 'Version de gabarit ajoutée', policy_added: 'Politique fictive ajoutée' }
  return labels[action] ?? 'Événement du mandat'
}

/** Switching context never signs or expands the account's server-side grants. */
export function ProfileSignatureAccess({ profileId, actorId, context, mandateId, available, busy = false }: { profileId: string; actorId: string; context: 'administration' | 'clinical'; mandateId: string; available: boolean; busy?: boolean }) {
  const navigation = useClinicalNavigation()
  if (!available) return <p className="mt-3 text-sm text-[#8a6f5d]">Signature non disponible dans cette version ou ce contexte.</p>
  if (context !== 'administration' || profileId !== actorId) return <p className="mt-3 text-sm text-[#8a6f5d]">Ce profil doit se connecter à son propre espace Clinique pour signer son document clinique.</p>
  const href = workspaceHref('clinical', 'mandates', { mandate: mandateId })
  return <div className="mt-3 grid justify-items-start gap-3">
    <p className="text-sm text-[#8a6f5d]">Ce signataire correspond à votre compte professionnel. Passez dans votre espace Clinique pour signer ce même mandat.</p>
    <button type="button" className={buttonClass('secondary') + ' max-w-full whitespace-normal text-left'} disabled={busy} onClick={async () => {
      if (busy || !await navigation.canLeave()) return
      window.location.assign(href)
    }}>Ouvrir mon espace Clinique pour signer</button>
  </div>
}
