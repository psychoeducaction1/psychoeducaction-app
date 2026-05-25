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
