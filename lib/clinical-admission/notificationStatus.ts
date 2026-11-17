import type { AdmissionNotification } from './types.ts'

/** Historical audit proves an operation was recorded, not mailbox delivery. */
export function admissionNotificationStatusLabel(status: AdmissionNotification['status']): string {
  return { prepared: 'À valider', simulated: 'Simulé', skipped: 'Non envoyé', recorded: 'Envoi enregistré' }[status]
}
