import type { ConsentDeliveryTarget } from './deliveryTypes'
import type { MandateCommand } from './types'
import { generateInvitationToken } from './client.ts'
import { isInvitationToken, isMandateCommand } from './validation.ts'

export type LocalInvitationIntent = {
  command: Extract<MandateCommand, { action: 'invitation.create' }>
  href: string
}

/** The pilot's simulated invitation must still exercise the real portal. Its
 * bearer capability lives only in this transient intent, never in a journal. */
export function localSignatureInvitationUrl(origin: string, token: string): string {
  if (origin !== 'http://127.0.0.1:3110' || !isInvitationToken(token)) {
    throw new Error('Le lien de démonstration est réservé au pilote local.')
  }
  return origin + '/signature-convention#jeton=' + token
}

export function createLocalInvitationIntent(
  target: Pick<ConsentDeliveryTarget, 'mandateId' | 'revisionId' | 'expectedVersion' | 'signerId'>,
  expiresInSeconds: number,
  origin: string,
): LocalInvitationIntent {
  // Reject another destination before creating a bearer capability.
  if (origin !== 'http://127.0.0.1:3110') throw new Error('Le lien de démonstration est réservé au pilote local.')
  const token = generateInvitationToken()
  const command: LocalInvitationIntent['command'] = { action: 'invitation.create', data: {
    mandateId: target.mandateId, revisionId: target.revisionId,
    expectedVersion: target.expectedVersion, signerId: target.signerId, expiresInSeconds, token,
  } }
  if (!isMandateCommand(command)) throw new Error('Les renseignements de l’invitation sont invalides.')
  return { command, href: localSignatureInvitationUrl(origin, token) }
}
