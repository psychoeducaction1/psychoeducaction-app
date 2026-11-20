import { ClinicalApiError } from '@/lib/clinical-workspace/api'

/** Validation failures are editable; a response that may follow a commit must retain its exact attempt. */
export function calendarWriteIsUncertain(cause: unknown): boolean {
  if (cause instanceof ClinicalApiError) return cause.status >= 500 || cause.status === 408 || cause.status === 429
  return cause instanceof TypeError || (typeof DOMException !== 'undefined' && cause instanceof DOMException && cause.name === 'AbortError')
}

export function calendarWriteErrorMessage(cause: unknown): string {
  if (cause instanceof TypeError || (typeof DOMException !== 'undefined' && cause instanceof DOMException && cause.name === 'AbortError')) return 'Connexion interrompue. Vérifiez votre connexion, puis réessayez la même opération.'
  return cause instanceof Error ? cause.message : 'Écriture non confirmée. Votre saisie est conservée.'
}
