export type LegacyLinkSource = 'waiting_list_clients' | 'assigned_clients'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ClinicalLegacyLink = {
  sourceTable: LegacyLinkSource
  sourceId: string
  patientId: string
  episodeId: string
  caseId: string | null
}

function isClinicalLegacyLink(value: unknown, sourceTable: LegacyLinkSource, sourceId: string): value is ClinicalLegacyLink {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const link = value as Record<string, unknown>
  return Object.keys(link).sort().join(',') === 'caseId,episodeId,patientId,sourceId,sourceTable'
    && link.sourceTable === sourceTable && link.sourceId === sourceId
    && typeof link.patientId === 'string' && uuid.test(link.patientId)
    && typeof link.episodeId === 'string' && uuid.test(link.episodeId)
    && (link.caseId === null || (typeof link.caseId === 'string' && uuid.test(link.caseId)))
}

/** Lecture par identifiants source seulement; aucune recherche de personne par nom. */
export async function runClinicalLegacyLinkQuery(input: {
  sourceTable: string | null
  sourceId: string | null
  actorId: string
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { code?: string; message: string } | null
  }>
}) {
  if ((input.sourceTable !== 'waiting_list_clients' && input.sourceTable !== 'assigned_clients')
    || !input.sourceId || !uuid.test(input.sourceId) || !uuid.test(input.actorId)) {
    return { status: 400, body: { error: 'Identifiant de source invalide.' } }
  }
  const { data, error } = await input.rpc('clinical_get_legacy_link', {
    p_source_table: input.sourceTable, p_source_id: input.sourceId, p_actor_id: input.actorId,
  })
  if (error) return { status: error.code === 'PGRST202' || error.code === '42883' ? 503 : 500,
    body: { error: 'Le lien au dossier clinique est indisponible. Actualisez la fiche avant de réessayer.' } }
  if (data === null) return { status: 200, body: { linked: false } }
  if (!isClinicalLegacyLink(data, input.sourceTable, input.sourceId)) {
    return { status: 502, body: { error: 'Le lien au dossier clinique n’a pas pu être confirmé.' } }
  }
  return { status: 200, body: { linked: true, ...data } }
}
