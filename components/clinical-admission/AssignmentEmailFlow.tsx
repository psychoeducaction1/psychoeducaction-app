'use client'

import { useState } from 'react'
import { EmailComposerModal, type EmailComposerDrafts, type EmailComposerSection } from '@/components/EmailComposerModal'
import type { AdmissionNotification } from '@/lib/clinical-admission/types'
import { buildClientAssignmentEmailTemplate, buildProfessionalAssignmentEmailTemplate } from '@/lib/assignmentEmailTemplates'
import type { AdmissionUi } from './shared'

function section(notice: AdmissionNotification): EmailComposerSection {
  return { enabled: true, fromLabel: 'Clinique PsychoÉducAction', to: notice.recipientLabel, cc: notice.cc.join(', '), subject: notice.subject, message: notice.body }
}

export function AssignmentEmailFlow({ ui, assignmentId, notifications, onClose }: {
  ui: AdmissionUi; assignmentId: string; notifications: AdmissionNotification[]; onClose: () => void
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const currentNotifications = ui.data.notifications.some(item => item.assignmentId === assignmentId)
    ? ui.data.notifications : notifications
  const prepared = currentNotifications.filter(item => item.assignmentId === assignmentId && item.purpose === 'assignment' && item.status === 'prepared'
    && !currentNotifications.some(review => review.supersedesNotificationId === item.id))
  const professional = prepared.find(item => item.kind === 'professional')
  const client = prepared.find(item => item.kind === 'client')
  const assignment = ui.data.assignments.find(item => item.id === assignmentId)
  const profile = ui.data.professionals.find(item => item.id === assignment?.professionalId)
  const professionalTemplate = buildProfessionalAssignmentEmailTemplate({ professionalName: profile?.displayName, professionalEmail: profile?.email, appUrl: typeof window === 'undefined' ? '' : window.location.origin })
  const clientTemplate = buildClientAssignmentEmailTemplate({ professionalName: profile?.displayName, professionalEmail: profile?.email, professionalTitle: profile?.professionalTitle, professionalPhone: profile?.professionalPhone, professionalLicenseNumber: profile?.professionalLicenseNumber,
    appointment: assignment?.firstAppointmentDate && assignment.firstAppointmentTime && assignment.firstAppointmentModality && ['telehealth','home','montreal','longueuil'].includes(assignment.firstAppointmentModality)
      ? { date: assignment.firstAppointmentDate, time: assignment.firstAppointmentTime, modality: assignment.firstAppointmentModality as 'telehealth' | 'home' | 'montreal' | 'longueuil' } : null })
  const drafts: EmailComposerDrafts = {
    ...(professional ? { professional: { ...section(professional), subject: professionalTemplate.subject, message: professionalTemplate.message } } : {}),
    ...(client ? { client: { ...section(client), subject: clientTemplate.subject, message: clientTemplate.message,
      cc: clientTemplate.cc?.map(() => 'supervision@fixture.invalid').join(', ') ?? '' } } : {}),
  }

  const save = async (edited: EmailComposerDrafts) => {
    setError(''); setSending(true)
    try {
      for (const [notice, value] of [[professional, edited.professional], [client, edited.client]] as const) {
        if (!notice || !value) continue
        await ui.run('notifications.review', notice.id, {
          decision: value.enabled ? 'simulate' : 'skip',
          to: value.enabled ? value.to.trim() : '',
          cc: value.enabled ? value.cc?.split(',').map(item => item.trim()).filter(Boolean) ?? [] : [],
          subject: value.subject.trim(), body: value.message.trim(),
        })
      }
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La simulation des courriels a échoué.')
    } finally { setSending(false) }
  }

  return <EmailComposerModal key={assignmentId} open={prepared.length > 0} drafts={drafts} sending={sending}
    onCancel={onClose} onSend={edited => void save(edited)} externalError={error}
    title="Préparer les courriels d’assignation"
    description="Modifiez les destinataires, la copie, l’objet et le message. Dans cette version test, l’envoi est simulé et limité aux adresses .invalid. Fermer conserve l’assignation sans valider les courriels."
    sendLabel="Valider les courriels simulés" />
}
