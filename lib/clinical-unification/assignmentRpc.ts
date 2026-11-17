import type { UnifiedWorkspaceTransport } from './workspace.ts'
import { mandateDefaultFailure } from '../clinical-mandates/defaultErrors.ts'

/** Adapt the existing operational helper without privileged credentials. */
export function unifiedAssignmentRpc(transport: UnifiedWorkspaceTransport, token: string) {
  return async (name: string, args: Record<string, unknown>) => {
    const rpc = name === 'clinical_assign_waiting_client' ? 'clinical_unified_assign_waiting_client'
      : name === 'clinical_assign_scheduled_waiting_client' ? 'clinical_unified_assign_scheduled_waiting_client' : null
    if (!rpc) return { data: null, error: { code: '42501', message: 'CLINICAL_BRIDGE_FORBIDDEN' } }
    try { return { data: await transport.rpc(rpc, args, token), error: null } }
    catch (error) {
      const prerequisite = mandateDefaultFailure(error)
      if (prerequisite) return { data: null, error: { code: '22023', message: prerequisite.code } }
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
      return { data: null, error: { code, message: code === '42501' ? 'CLINICAL_BRIDGE_FORBIDDEN'
        : code === '23P01' ? 'CLINICAL_ASSIGNMENT_SLOT_UNAVAILABLE'
          : code === '40001' || code === '23505' ? 'IDEMPOTENCY_CONFLICT' : 'CLINICAL_ASSIGNMENT_UNAVAILABLE' } }
    }
  }
}
