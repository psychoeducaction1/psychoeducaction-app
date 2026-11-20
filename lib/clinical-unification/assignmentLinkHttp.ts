import type { UnifiedDomainHandler } from './http.ts'
import { unifiedJson } from './http.ts'
import { isUnifiedAssignmentId, unifiedAssignmentDestination } from './assignmentLink.ts'

/** Reuse the source ownership checks and existing idempotent case linker. */
export const handleUnifiedAssignmentLink: UnifiedDomainHandler = async (request, path, identity) => {
  if (path[0] !== 'assignment-link') return null
  if (identity.context !== 'clinical') return unifiedJson({ code: 'FORBIDDEN', error: 'Ouvrez cette assignation dans votre espace professionnel.' }, 403)
  if (path.length !== 2 || !isUnifiedAssignmentId(path[1])
    || new URL(request.url).search || !['GET', 'POST'].includes(request.method)) return unifiedJson({ code: 'INVALID_INPUT', error: 'Lien d’assignation invalide.' }, 400)
  const link = await identity.transport.rpc(request.method === 'GET' ? 'clinical_get_my_assignment_link' : 'clinical_link_my_existing_assignment', { p_assignment_id: path[1] }, identity.token)
  if (link !== null && !unifiedAssignmentDestination(link)) throw new Error('UNIFIED_RESPONSE_INVALID')
  return unifiedJson({ link })
}
