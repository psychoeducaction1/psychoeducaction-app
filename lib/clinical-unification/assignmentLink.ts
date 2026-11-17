export const isUnifiedAssignmentId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

/** The original client page is keyed by the patient, never by the case. */
export function unifiedAssignmentDestination(link: unknown): string | null {
  if (!link || typeof link !== 'object') return null
  const value = link as Record<string, unknown>
  return isUnifiedAssignmentId(value.patientId) && isUnifiedAssignmentId(value.caseId)
    ? `/clinique/clients/${value.patientId}?record=${value.caseId}` : null
}
