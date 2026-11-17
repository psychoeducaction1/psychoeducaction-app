'use client'

import { useState } from 'react'
import { EmailComposerModal, type EmailComposerDrafts } from '@/components/EmailComposerModal'
import type { AdmissionCase, AdmissionProcess } from '@/lib/clinical-admission/types'
import { firstContactEmail } from '@/lib/clinical-admission/contactEmail'
import type { AdmissionUi } from './shared'

export function ProcessContactEmailFlow({ ui, admission, process, onClose }: {
  ui: AdmissionUi; admission: AdmissionCase; process: AdmissionProcess; onClose: () => void
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const template = firstContactEmail(admission.firstName)
  const drafts: EmailComposerDrafts = { client: {
    enabled: true, fromLabel: 'Clinique PsychoÉducAction', to: admission.emails[0] ?? '', cc: '',
    subject: template.subject, message: template.message,
  } }
  const save = async (edited: EmailComposerDrafts) => {
    const client = edited.client
    if (!client?.enabled) { setError('Activez le courriel au client pour consigner cette tentative.'); return }
    setSending(true); setError('')
    try {
      await ui.run('processes.contact', process.id, {
        expectedVersion: process.version, channel: 'email_simulated', occurredAt: new Date().toISOString(),
        outcome: 'no_response', note: 'Courriel de tentative de contact simulé.',
        to: client.to.trim(), cc: client.cc?.split(',').map(item => item.trim()).filter(Boolean) ?? [],
        subject: client.subject.trim(), body: client.message.trim(),
      })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'La simulation du courriel a échoué.') }
    finally { setSending(false) }
  }
  return <EmailComposerModal open drafts={drafts} sending={sending} onCancel={onClose}
    onSend={edited => void save(edited)} externalError={error}
    title="Courriel de tentative de contact"
    description="Texte repris de l’application d’assignation. Dans cette version test, le courriel est seulement consigné comme simulation; aucune adresse réelle n’est acceptée."
    sendLabel="Consigner le courriel simulé" />
}
