/**
 * Les environnements cliniques restent silencieux pendant la structuration du raccord.
 * L'application d'assignation déjà en service n'a pas de PEA_CLINICAL_RUNTIME et
 * conserve son comportement actuel. Toute levée de ce verrou demande un chantier
 * distinct et une vérification des courriels avant activation.
 */
export function isClinicalOutboundEmailBlocked(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return ['fixture', 'local-db', 'staging-db', 'real-db'].includes(
    environment.PEA_CLINICAL_RUNTIME ?? '',
  )
}

export function assertClinicalOutboundEmailAllowed(
  environment: Record<string, string | undefined> = process.env,
): void {
  if (isClinicalOutboundEmailBlocked(environment)) {
    throw new Error('CLINICAL_OUTBOUND_EMAIL_DISABLED')
  }
}
