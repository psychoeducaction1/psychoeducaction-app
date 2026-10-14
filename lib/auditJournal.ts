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
