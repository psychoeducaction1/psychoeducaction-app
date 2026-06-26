import type { SupabaseClient } from '@supabase/supabase-js'

export type AssignedClient = {
  id: string
  assignment_request_id: string | null
  waiting_list_client_id?: string | null
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

export type StatusAuditActor = {
  id: string
  role: string | null
  name: string | null
}

export type AuditLogActor = StatusAuditActor

export type AuditLogInput = {
  actor: AuditLogActor
  action: string
  entityType: string
  entityId?: string | null
  description: string
  metadata?: Record<string, unknown>
}

export function getUsedAssignmentCount(
  clients: Array<{ is_active: boolean | null }>
): number {
  return clients.filter((client) => client.is_active === true).length
}

export async function logAssignedClientStatusChange({
  supabase,
  assignedClientId,
  previousStatus,
  newStatus,
  actor,
}: {
  supabase: SupabaseClient
  assignedClientId: string
  previousStatus: boolean | null
  newStatus: boolean | null
  actor: StatusAuditActor
}): Promise<void> {
  if (previousStatus === newStatus) return

  try {
    const { error } = await supabase
      .from('assigned_client_status_history')
      .insert({
        assigned_client_id: assignedClientId,
        previous_status: previousStatus,
        new_status: newStatus,
        changed_by_profile_id: actor.id,
        changed_by_role: actor.role,
        changed_by_name: actor.name,
      })

    if (!error) return

    console.error('[assigned-client-status-history] Audit insert failed:', {
      assignedClientId,
      message: error.message,
    })
  } catch (caughtError) {
    console.error('[assigned-client-status-history] Audit insert failed:', {
      assignedClientId,
      message:
        caughtError instanceof Error
          ? caughtError.message
          : 'Erreur inconnue pendant l’écriture de l’audit.',
    })
  }
}

export async function logAudit({
  supabase,
  actor,
  action,
  entityType,
  entityId,
  description,
  metadata,
}: AuditLogInput & { supabase: SupabaseClient }): Promise<void> {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      actor_profile_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      description,
      metadata: metadata ?? {},
    })

    if (!error) return

    console.error('[audit-log] Audit insert failed:', {
      action,
      entityType,
      entityId,
      message: error.message,
    })
  } catch (caughtError) {
    console.error('[audit-log] Audit insert failed:', {
      action,
      entityType,
      entityId,
      message:
        caughtError instanceof Error
          ? caughtError.message
          : 'Erreur inconnue pendant l’écriture de l’audit.',
    })
  }
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
  const normalizedRemainingCount =
    normalizedRequestedCount > 0
      ? getRemainingAssignmentCount(
          normalizedRequestedCount,
          normalizedAcceptedCount
        )
      : Math.max(remainingCount ?? 0, 0)
  const isCompleted =
    normalizedRequestedCount > 0 &&
    normalizedAcceptedCount >= normalizedRequestedCount
  const isCurrentlyActive =
    isActive === true &&
    !isCompleted &&
    (normalizedRequestedCount > 0
      ? normalizedAcceptedCount < normalizedRequestedCount
      : normalizedRemainingCount > 0)
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
