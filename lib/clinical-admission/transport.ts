import type { ClinicalAccessContext } from '@/lib/clinical-core/types'
import { ADMISSION_ACTIONS, type AdmissionAction, type AdmissionCommandResult, type AdmissionWorkspace } from '@/lib/clinical-admission/types'

export const ADMISSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const collections = ['prospects','admissions','capacityRequests','professionals','processes','assignments','tasks','notifications','events','calendarBlocks'] as const
const resultKinds = new Set(['prospect','admission','capacity','preferences','process','assignment','block','task','notification'])
export const ADMISSION_CREATING_ACTIONS = new Set<AdmissionAction>(['prospects.create','calendar.block','admissions.create','admissions.assign','admissions.process','capacities.create','processes.assign','tasks.create','notifications.simulate','notifications.review'])
const idlessActions = new Set<AdmissionAction>(['prospects.create','calendar.block','admissions.create','capacities.create','tasks.create','notifications.simulate'])
export function isAdmissionAction(value: unknown): value is AdmissionAction { return typeof value === 'string' && (ADMISSION_ACTIONS as readonly string[]).includes(value) }
export function isAdmissionCommand(value: unknown): value is { action: AdmissionAction; id: string | null; data: Record<string, unknown> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 3 || Object.keys(input).some(key => !['action','id','data'].includes(key)) || !isAdmissionAction(input.action)
    || !input.data || typeof input.data !== 'object' || Array.isArray(input.data)) return false
  return idlessActions.has(input.action) ? input.id === null : typeof input.id === 'string' && ADMISSION_UUID.test(input.id)
}
export function isAdmissionWorkspace(value: unknown, actorId: string, context?: ClinicalAccessContext): value is AdmissionWorkspace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return (data.mode === 'isolated_local' || data.mode === 'isolated_unified') && data.durable === true && data.actorId === actorId
    && (data.context === 'administration' || data.context === 'clinical') && (!context || data.context === context)
    && Object.keys(data).every(key => ['mode','durable','actorId','context',...collections].includes(key))
    && collections.every(key => Array.isArray(data[key]))
}
export function isAdmissionResult(value: unknown, actorId: string, context?: ClinicalAccessContext): value is AdmissionCommandResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>, result = data.result
  if (Object.keys(data).some(key => !['workspace','result'].includes(key)) || !isAdmissionWorkspace(data.workspace, actorId, context)
    || !result || typeof result !== 'object' || Array.isArray(result)) return false
  const item = result as Record<string, unknown>
  return Object.keys(item).length === 2 && typeof item.kind === 'string' && resultKinds.has(item.kind) && typeof item.id === 'string' && ADMISSION_UUID.test(item.id)
}
