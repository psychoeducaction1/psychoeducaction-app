import type { ClinicalAccessContext } from '../clinical-core/types.ts'
import type { UnifiedWorkspaceTransport } from './workspace.ts'

const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const validVersion = (v: unknown, min = 1) => Number.isSafeInteger(v) && Number(v) >= min
const invalid = (code = 'UNIFIED_RESPONSE_INVALID'): never => { throw Object.assign(new Error(code), { code }) }
const array = (v: unknown, check: (value: unknown) => boolean) => Array.isArray(v) && v.every(check)
const nullableId = (v: unknown) => v === null || uuid(v)

export function createUnifiedProfessionalServices(transport: UnifiedWorkspaceTransport) {
  return {
    async read(token: string, context: ClinicalAccessContext, professionalId: string) {
      if (context !== 'administration') return invalid('42501')
      if (!uuid(professionalId)) return invalid('22023')
      const result = await transport.rpc('clinical_unified_professional_services_query', {
        p_context: context, p_professional_id: professionalId,
      }, token)
      if (!object(result) || !array(result.services, s => object(s) && uuid(s.id) && typeof s.label === 'string'
        && typeof s.active === 'boolean' && validVersion(s.version)
        && array(s.rates, r => object(r) && uuid(r.id) && typeof r.effectiveFrom === 'string'
          && validVersion(r.amountCents) && ['hour', 'session', 'km'].includes(String(r.unit))
          && (r.unit === 'hour' ? validVersion(r.referenceMinutes) : r.referenceMinutes === null))
        && (s.setting === null || object(s.setting) && validVersion(s.setting.version, 0)
          && typeof s.setting.enabled === 'boolean' && nullableId(s.setting.supervisorId)
          && nullableId(s.setting.templateId) && nullableId(s.setting.policyId)
          && (s.setting.overrideCents === null || validVersion(s.setting.overrideCents))
          && typeof s.setting.overrideReason === 'string' && typeof s.setting.createdAt === 'string'))
        || !array(result.templates, t => object(t) && uuid(t.id) && nullableId(t.serviceId)
          && typeof t.title === 'string' && validVersion(t.version))
        || !array(result.policies, p => object(p) && uuid(p.id) && typeof p.label === 'string' && validVersion(p.version))
        || !array(result.supervisors, s => object(s) && uuid(s.id) && typeof s.name === 'string')
        || !array(result.mandates, m => object(m) && uuid(m.id) && uuid(m.serviceId)
          && typeof m.status === 'string' && typeof m.serviceDate === 'string')) return invalid()
      return result
    },
    async command(token: string, context: ClinicalAccessContext, professionalId: string, data: Record<string, unknown>, key: string) {
      if (context !== 'administration') return invalid('42501')
      if (!uuid(professionalId) || !uuid(key) || !uuid(data.serviceId)) return invalid('22023')
      const result = await transport.rpc('clinical_unified_professional_services_command', {
        p_context: context, p_professional_id: professionalId, p_data: data, p_key: key,
      }, token)
      if (!object(result) || result.ok !== true || result.serviceId !== data.serviceId || !validVersion(result.version)) return invalid()
      return result
    },
  }
}
