'use client'

import { clinicalUiText } from '@/lib/clinical-workspace/presentationText'
import { useRef, useState } from 'react'
import { buttonClass } from '@/components/Ui'
import { ClinicalApiError } from '@/lib/clinical-workspace/api'
import { generateInvitationToken } from '@/lib/clinical-mandates/client'
import type { MandateCommand, MandateRevision, MandateSigner } from '@/lib/clinical-mandates/types'
import { Field, MandateForm, inputClass, type MandateUi } from './primitives'
import { timeLabel } from './model'

export function InvitationPanel({ signer, revision, ui, mandateId, recipientEmail = '', professionalName = '' }: { signer: MandateSigner; revision: Pick<MandateRevision, 'id' | 'version' | 'invitations'>; ui: MandateUi; mandateId: string; recipientEmail?: string; professionalName?: string }) {
  const [seconds, setSeconds] = useState('864000'), [link, setLink] = useState(''), [copyMessage, setCopyMessage] = useState(''), [uncertain, setUncertain] = useState(false)
  const [email, setEmail] = useState(recipientEmail), [message, setMessage] = useState(`Bonjour,\n\nVeuillez lire la convention fictive et, si elle vous convient, y apposer votre signature.\n\nMerci,\n${professionalName || 'Votre professionnel'}\nPsychoÉducAction`)
  const intent = useRef<Extract<MandateCommand, { action: 'invitation.create' }> | null>(null)
  const invitations = revision.invitations.filter(invitation => invitation.signerId === signer.id)
  if (signer.profileId || ui.data.context !== 'administration') return null
  return <section className="grid gap-3"><p className="text-sm">{clinicalUiText("Aucun courriel n’est envoyé depuis le laboratoire. Le lien fictif cible uniquement ce signataire et ce document. L’adresse et le message ci-dessous servent à prévisualiser l’invitation.","Cet aperçu cible uniquement ce signataire et ce document. Préparer le lien n’envoie pas de courriel. L’adresse et le message ci-dessous servent à prévisualiser l’invitation.")}</p>
    <Field label="Courriel du requérant"><input className={inputClass} type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="personne@example.invalid" /></Field>
    <Field label="Message proposé"><textarea className={inputClass} rows={5} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} /></Field>
    <MandateForm disabled={ui.busy} submitLabel={uncertain ? 'Reprendre la même invitation' : 'Préparer l’envoi simulé'} onSave={async () => {
      if (!intent.current) intent.current = { action: 'invitation.create', data: { mandateId, revisionId: revision.id, expectedVersion: revision.version, signerId: signer.id, expiresInSeconds: Number(seconds), token: generateInvitationToken() } }
      const current = intent.current
      setUncertain(true)
      try {
        await ui.command(current)
        setLink(window.location.origin + (process.env.NEXT_PUBLIC_PEA_CLINICAL_UNIFICATION === 'true' ? '/signature-convention#jeton=' : '/signature-demo#token=') + current.data.token); setCopyMessage(''); intent.current = null; setUncertain(false)
      } catch (cause) { if (cause instanceof ClinicalApiError && cause.status >= 400 && cause.status < 500 && ![408, 429].includes(cause.status)) { intent.current = null; setUncertain(false) } throw cause }
    }}><Field label="Expiration"><select className={inputClass} value={seconds} disabled={uncertain} onChange={event => setSeconds(event.target.value)}><option value="864000">10 jours</option><option value="86400">1 jour</option><option value="604800">7 jours</option><option value="1209600">14 jours</option><option value="2592000">30 jours</option><option value="300">5 minutes · essai</option></select></Field>{uncertain && <p className="text-xs">En cas de réponse incertaine, le même jeton reste uniquement en mémoire pour reprendre la même commande.</p>}</MandateForm>
    {link && <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-semibold">Lien éphémère disponible maintenant</p><p className="mt-1 text-xs">Le lien contient une capacité secrète fictive. Il disparaîtra de cette interface en quittant la fiche. Aucun envoi n’a eu lieu.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClass('secondary')} onClick={async () => { try { await navigator.clipboard.writeText(link); setCopyMessage('Lien fictif copié.') } catch { setCopyMessage('Copie automatique refusée. Utilisez le menu du lien « Ouvrir le portail fictif » pour copier son adresse.') } }}>Copier le lien simulé</button><a href={link} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost')}>Ouvrir le portail fictif</a><button type="button" className={buttonClass('ghost')} onClick={() => { setLink(''); setCopyMessage('Lien effacé de cette interface ; utilisez Révoquer pour invalider l’invitation.') }}>Masquer le lien</button></div>{copyMessage && <p role="status" className="mt-2 text-sm">{copyMessage}</p>}</section>}
    <ul className="mt-4 grid gap-2 text-sm">{invitations.map(invitation => <li key={invitation.id} className="rounded-lg border p-3"><p>{invitation.consumedAt ? 'Utilisée le ' + timeLabel(invitation.consumedAt) : invitation.revokedAt ? 'Révoquée le ' + timeLabel(invitation.revokedAt) : Date.parse(invitation.expiresAt) <= Date.now() ? 'Expirée' : 'Disponible jusqu’au ' + timeLabel(invitation.expiresAt)}</p>{!invitation.revokedAt && !invitation.consumedAt && <MandateForm disabled={ui.busy} submitLabel="Révoquer cette invitation" onSave={async () => { if (!window.confirm('Révoquer immédiatement ce lien fictif ?')) throw new Error('Révocation annulée.'); await ui.command({ action: 'invitation.revoke', data: { mandateId, revisionId: revision.id, expectedVersion: revision.version, invitationId: invitation.id } }); setLink('') }}><p className="text-xs">Le lien sera refusé même si son expiration n’est pas atteinte.</p></MandateForm>}</li>)}</ul>
  </section>
}
