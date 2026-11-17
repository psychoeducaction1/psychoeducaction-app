import { isProfessionalSlug,professionalSlug } from '../clinical-workspace/professionalLinks.ts'
import type { ClinicalAccessContext } from '../clinical-core/types.ts'
import type { UnifiedWorkspaceTransport } from './workspace.ts'

const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const text = (v: unknown) => typeof v === 'string'
const version = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0
const array = (v: unknown, check: (item: unknown) => boolean) => Array.isArray(v) && v.every(check)
const fail = (code = 'UNIFIED_RESPONSE_INVALID'): never => { throw Object.assign(new Error(code), { code }) }

export const unifiedProfessionalActions = new Set([
  'profile.update', 'preferences.update', 'signature.add', 'signature.upload',
  'document.add', 'agreement.create', 'agreement.sign', 'office.details',
])

function preferences(value: unknown): boolean {
  return object(value) && ['pref_languages', 'pref_client_groups', 'pref_service_types', 'pref_office_locations',
    'pref_meeting_modes', 'pref_motifs'].every(key => array(value[key], text))
    && ['pref_exclusions', 'pref_matching_notes'].every(key => text(value[key]))
    && array(value.pref_age_ranges, age => object(age) && Number.isInteger(age.min)
      && (age.max === null || Number.isInteger(age.max)))
}
function directoryEntry(value: unknown): boolean {
  return object(value) && uuid(value.id) && ['fullName', 'title', 'email'].every(key => text(value[key]))
    && typeof value.active === 'boolean' && typeof value.platformAccess === 'boolean'
    && preferences(value.preferences) && version(value.preferencesVersion)
}
function professional(value: unknown): boolean {
  return object(value) && uuid(value.id) && version(value.version)
    && ['fullName', 'title', 'email', 'prefix', 'phone', 'address', 'licenseNumber', 'correspondenceEmail',
      'ivacProviderNumber', 'cnesstProviderNumber', 'registeredAt'].every(key => text(value[key]))
    && typeof value.active === 'boolean' && typeof value.platformAccess === 'boolean'
    && preferences(value.preferences)
    && (value.signature === null || object(value.signature) && uuid(value.signature.id)
      && version(value.signature.version) && Array.isArray(value.signature.strokes)
      && ['imageMediaType', 'imageBase64'].every(key => value.signature && object(value.signature)
        && (value.signature[key] === null || text(value.signature[key]))) && text(value.signature.createdAt))
    && array(value.documents, d => object(d) && uuid(d.id)
      && ['kind', 'label', 'fileName', 'mediaType', 'sha256', 'createdAt'].every(key => text(d[key]))
      && (d.previousId === null || uuid(d.previousId)))
    && array(value.agreements, a => object(a) && uuid(a.id) && version(a.version)
      && ['pending', 'signed'].includes(String(a.status)) && text(a.title) && text(a.sha256)
      && text(a.createdAt) && (a.signedAt === null || text(a.signedAt))
      && (a.signedSha256 === null || text(a.signedSha256)))
    && array(value.offices, o => object(o) && uuid(o.id) && version(o.version)
      && ['name', 'color', 'officeNumber', 'address', 'city', 'province', 'postalCode'].every(key => text(o[key]))
      && typeof o.active === 'boolean')
    && array(value.grants, g => object(g) && uuid(g.officeId) && text(g.validFrom)
      && (g.validTo === null || text(g.validTo)))
    && array(value.availability, a => object(a) && ['weekday', 'startMinute', 'endMinute'].every(key => Number.isInteger(a[key])))
    && array(value.history, h => object(h) && uuid(h.id) && text(h.action) && text(h.at))
    && array(value.communications, c => object(c) && uuid(c.id) && text(c.subject) && text(c.at) && c.status === 'simulated')
}

/** The original ProfessionalWorkspace contract, backed by existing profile UUIDs.
 * No actor ID from a browser is trusted; all permissions are rechecked in the RPC. */
export function createUnifiedProfessionalAdapter(transport: UnifiedWorkspaceTransport) {
  return {
    async read(token: string, context: ClinicalAccessContext, professionalId: string | null = null) {
      if (professionalId !== null && !uuid(professionalId)) {
        if (context !== 'administration' || !isProfessionalSlug(professionalId)) fail('22023')
        const directory = await transport.rpc('clinical_unified_professional_query',{p_context:context,p_professional_id:null},token)
        if (!object(directory)) return fail()
        if (!array(directory.professionals,directoryEntry)) return fail()
        const matches = (directory.professionals as {id:string;fullName:string}[]).filter(p=>professionalSlug(p.fullName)===professionalId)
        if(matches.length!==1) fail('PROFESSIONAL_LINK_NOT_UNIQUE')
        professionalId=matches[0].id
      }
      const result = await transport.rpc('clinical_unified_professional_query', {
        p_context: context, p_professional_id: professionalId,
      }, token)
      if (!object(result) || !array(result.professionals, directoryEntry)
        || !(result.professional === null || professional(result.professional))
        || professionalId !== null && (!object(result.professional) || result.professional.id !== professionalId)
        || context === 'clinical' && result.professionals instanceof Array && result.professionals.length !== 0) fail()
      return result
    },
    async command(token: string, context: ClinicalAccessContext, professionalId: string | null,
      action: string, data: Record<string, unknown>, key: string) {
      if (professionalId !== null && !uuid(professionalId) || !uuid(key)
        || !unifiedProfessionalActions.has(action)) fail('22023')
      const result = await transport.rpc('clinical_unified_professional_command', {
        p_context: context, p_professional_id: professionalId, p_action: action, p_data: data, p_key: key,
      }, token)
      if (!object(result) || result.ok !== true || result.action !== action || !uuid(result.professionalId)
        || professionalId !== null && result.professionalId !== professionalId
        || !(result.resourceId === null || uuid(result.resourceId))
        || !(result.version === null || version(result.version))) fail()
      return result
    },
    async document(token: string, context: ClinicalAccessContext, professionalId: string,
      documentId: string, signed: boolean) {
      if (!uuid(professionalId) || !uuid(documentId)) fail('22023')
      return transport.rpc(signed ? 'clinical_unified_professional_signed_pdf_query' : 'clinical_unified_professional_query', {
        p_context: context, p_professional_id: professionalId,
        ...(signed ? { p_agreement_id: documentId } : { p_document_id: documentId }),
      }, token)
    },
  }
}
