/** Archiving is a normal lifecycle state, not a service outage. Preserve other errors. */
export function mandateLoadError(cause: unknown, closed: boolean): string {
 const message = cause instanceof Error ? cause.message : ''
 if (!message || message === 'Le service clinique est momentanément indisponible.')
  return closed ? 'Le mandat archivé n’a pas pu être chargé. Réessayez.' : 'Le mandat n’a pas pu être chargé. Réessayez.'
 return message
}
