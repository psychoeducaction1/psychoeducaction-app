export type AssignedClient = {
  id: string
  assignment_request_id: string | null
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  requester_name: string | null
  assigned_date: string
  contacted: boolean
  is_active: boolean | null
  short_comment: string | null
  meeting_modality: string | null
  service_address: string | null
  closure_reason: string | null
}

export type AssignmentRequest = {
  id: string
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  assigned_count: number | null
  remaining_count: number | null
  request_comment: string | null
}

export type ProfessionalPreferences = {
  pref_client_types: string
  pref_modalities: string
  pref_followup_types: string
  pref_notes: string
}

export type PreferenceField = keyof ProfessionalPreferences

export type ProfilePreferencesRow = {
  role: string | null
  pref_client_types: string[] | null
  pref_modalities: string[] | null
  pref_followup_types: string[] | null
  pref_notes: string | null
}

export type EditableClientField =
  | 'contacted'
  | 'is_active'
  | 'closure_reason'

export const closureReasonOptions = [
  '',
  'Aucune réponse après les tentatives de contact',
  'Client non intéressé par le service',
  'Client a trouvé un autre service',
  'Coordonnées invalides',
  'Autre',
]

export function nullableText(value: string | null): string | null {
  const trimmedValue = value?.trim() ?? ''
  return trimmedValue.length > 0 ? trimmedValue : null
}

export function getUsedAssignmentCount(
  clients: Array<{ is_active: boolean | null }>
): number {
  return clients.filter((client) => client.is_active === true).length
}

export function getRemainingAssignmentCount(
  requestedCount: number,
  assignedCount: number
): number {
  return Math.max(requestedCount - assignedCount, 0)
}

export type AssignmentRequestState = 'active' | 'completed' | 'inactive'

export function getAssignmentRequestMetrics({
  isActive,
  requestedCount,
  acceptedCount,
  remainingCount,
}: {
  isActive: boolean | null | undefined
  requestedCount: number | null | undefined
  acceptedCount: number | null | undefined
  remainingCount?: number | null | undefined
}): {
  requestedCount: number
  acceptedCount: number
  remainingCount: number
  state: AssignmentRequestState
  isActive: boolean
  isCompleted: boolean
} {
  const normalizedRequestedCount = Math.max(requestedCount ?? 0, 0)
  const normalizedAcceptedCount = Math.max(acceptedCount ?? 0, 0)
  const calculatedRemainingCount = getRemainingAssignmentCount(
    normalizedRequestedCount,
    normalizedAcceptedCount
  )
  const storedRemainingCount =
    remainingCount === null || remainingCount === undefined
      ? null
      : Math.max(remainingCount, 0)
  const normalizedRemainingCount =
    storedRemainingCount === null
      ? calculatedRemainingCount
      : Math.min(calculatedRemainingCount, storedRemainingCount)
  const isCompleted =
    normalizedRequestedCount > 0 &&
    (normalizedAcceptedCount >= normalizedRequestedCount ||
      normalizedRemainingCount <= 0)
  const isCurrentlyActive =
    isActive === true &&
    !isCompleted &&
    normalizedRequestedCount > 0 &&
    (normalizedAcceptedCount < normalizedRequestedCount ||
      normalizedRemainingCount > 0)
  const state: AssignmentRequestState = isCompleted
    ? 'completed'
    : isCurrentlyActive
      ? 'active'
      : 'inactive'

  return {
    requestedCount: normalizedRequestedCount,
    acceptedCount: normalizedAcceptedCount,
    remainingCount: normalizedRemainingCount,
    state,
    isActive: isCurrentlyActive,
    isCompleted,
  }
}

export function arrayToTextareaValue(value: string[] | null): string {
  return value?.join(', ') ?? ''
}

export function textareaValueToArray(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function isRecentDate(value: string): boolean {
  const assignedDate = new Date(`${value}T00:00:00`)

  if (Number.isNaN(assignedDate.getTime())) {
    return false
  }

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  return assignedDate >= sevenDaysAgo
}
