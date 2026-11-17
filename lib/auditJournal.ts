const SATISFACTION_ACTION_PREFIX = 'satisfaction_'
const SATISFACTION_ENTITY_TYPES = ['satisfaction_import', 'satisfaction_eligible']

export function isVisibleInAuditJournal(row: { action: string | null; entity_type: string | null }) {
  return !row.action?.startsWith(SATISFACTION_ACTION_PREFIX)
    && !SATISFACTION_ENTITY_TYPES.includes(row.entity_type ?? '')
}

export function excludeSatisfactionAuditEvents<T extends { or: (filters: string) => T }>(query: T): T {
  // Filtrer avant la limite des 500 entrées. Conserver les anciennes valeurs NULL;
  // échapper le soulignement pour ne pas masquer une action sans ce préfixe exact.
  return query
    .or('action.is.null,action.not.like.satisfaction\\_%')
    .or(`entity_type.is.null,entity_type.not.in.(${SATISFACTION_ENTITY_TYPES.join(',')})`)
}

// Temporary presentation rule requested by the account owner. Audit writers and
// immutable security records are deliberately unchanged. Remove to restore visibility.
const TEMPORARY_AUDIT_ACTOR = '3c514611-b530-4f48-84e4-32871b32f320'
const TEMPORARY_AUDIT_SINCE = '2026-11-10T00:00:00-05:00'
export function isActorEventVisibleInJournal(actorId: string | null | undefined, at: string | null | undefined): boolean {
  return actorId !== TEMPORARY_AUDIT_ACTOR || !at || Date.parse(at) < Date.parse(TEMPORARY_AUDIT_SINCE)
}
export function excludeTemporaryActorAuditEvents<T extends { or: (filters: string) => T }>(query: T): T {
  return query.or(`actor_profile_id.is.null,actor_profile_id.neq.${TEMPORARY_AUDIT_ACTOR},created_at.is.null,created_at.lt.${TEMPORARY_AUDIT_SINCE}`)
}
