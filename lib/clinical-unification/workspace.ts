import { validImportedIntake } from '../clinical-migration/intake.ts'
import { CLINICAL_NOTE_BLUEPRINTS } from '../clinicalNoteBlueprints.ts'
import { CLINICAL_NOTE_TEMPLATES } from '../clinicalNoteTemplates.ts'
import type { ClinicalAccessContext, FixtureActor, WorkspaceView } from '../clinical-core/types.ts'
import type { ClientOverview, ClientPersonInput, UpdateClientProfileInput } from '../clinical-workspace/clientDetails.ts'

export interface UnifiedWorkspaceTransport {
  rpc(name: string, args: Record<string, unknown>, token: string): Promise<unknown>
}
export type UnifiedWorkspaceIdentity = { mode: 'isolated_unified'; durable: true; actor: FixtureActor }

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const text = (value: unknown): value is string => typeof value === 'string'
const nullableText = (value: unknown): value is string | null => value === null || text(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const array = (value: unknown, item: (value: unknown) => boolean) => Array.isArray(value) && value.every(item)
function invalid(): never { throw Object.assign(new Error('UNIFIED_RESPONSE_INVALID'), { code: 'UNIFIED_RESPONSE_INVALID' }) }

function actor(value: unknown): value is FixtureActor {
  return object(value) && uuid(value.id) && text(value.displayName)
    && ['admin', 'assistant', 'professional', 'supervisor'].includes(String(value.role))
    && array(value.permissions, permission => permission === 'manage_clinical_access')
    && array(value.capabilities, capability => ['administration', 'practice', 'supervision'].includes(String(capability)))
}
function identity(value: unknown, context: ClinicalAccessContext): value is UnifiedWorkspaceIdentity & Record<string, unknown> {
  return object(value) && value.mode === 'isolated_unified' && value.durable === true
    && actor(value.actor) && value.actor.context === context
    && (context === 'administration' ? value.actor.capabilities.includes('administration')
      : value.actor.capabilities.some(capability => capability === 'practice' || capability === 'supervision'))
}
function record(value: unknown): boolean {
  return object(value) && uuid(value.id) && uuid(value.clientId) && uuid(value.episodeId)
    && text(value.label) && ['open', 'closed'].includes(String(value.status)) && integer(value.grantRevision)
    && text(value.createdAt) && array(value.members, member => object(member) && uuid(member.actorId)
      && ['canRead', 'canWrite', 'canCosign', 'requiresCosignature'].every(key => typeof member[key] === 'boolean')
      && (member.supervisorId === null || uuid(member.supervisorId)))
}
function client(value: unknown): boolean {
  return object(value) && uuid(value.id) && text(value.firstName) && text(value.lastName)
    && nullableText(value.birthDate) && text(value.createdAt) && object(value.administrativeRecord)
    && uuid(value.administrativeRecord.id) && value.administrativeRecord.clientId === value.id
    && integer(value.administrativeRecord.version) && text(value.administrativeRecord.administrativeNotes)
    && ['contacts', 'representatives', 'payers', 'requests', 'episodes', 'assignmentLinks', 'assignments'].every(key =>
      array(value[key], entry => object(entry) && uuid(entry.id) && entry.clientId === value.id))
}
function overview(value: unknown, patientId: string): value is ClientOverview {
  if (!object(value) || value.clientId !== patientId || !object(value.profile) || (Object.hasOwn(value,'importedIntake') && !validImportedIntake(value.importedIntake))) return false
  const profile = value.profile
  return ['firstName', 'lastName', 'sex', 'address', 'email', 'phone', 'consultationReason', 'requestedService'].every(key => text(profile[key]))
    && nullableText(profile.birthDate) && nullableText(profile.assignedAt) && integer(profile.version)
    && ['canEditProfile', 'canAddPerson', 'canUploadAdministrative'].every(key => typeof value[key] === 'boolean')
    && array(value.contacts, person => object(person) && uuid(person.id) && integer(person.version)
      && ['fullName', 'relationship', 'email', 'phone', 'address'].every(key => text(person[key]))
      && ['canEdit', 'communicationAllowed', 'consentAllowed', 'documentsAllowed', 'authorityVerified', 'reminder48h', 'reminder2h'].every(key => typeof person[key] === 'boolean')
      && ['contact', 'representative', 'mandate', 'payer'].includes(String(person.source))
      && nullableText(person.payerResponsibility) && (person.payerShareBasisPoints === null || Number.isSafeInteger(person.payerShareBasisPoints))
      && integer(person.reminderFirstHours) && integer(person.reminderSecondHours))
    && array(value.lifecycle, entry => object(entry) && uuid(entry.recordId) && uuid(entry.episodeId)
      && text(entry.label) && ['open', 'closed'].includes(String(entry.status)) && integer(entry.version)
      && ['canClose', 'canRequestReopen', 'canReopen', 'reopenRequested'].every(key => typeof entry[key] === 'boolean'))
    && array(value.documents, document => object(document) && uuid(document.id) && text(document.label)
      && text(document.fileName) && text(document.mediaType) && text(document.createdAt)
      && text(document.downloadHref) && document.downloadHref.startsWith('/api/clinical-workspace/')
      && ['clinical', 'administration'].includes(String(document.audience))
      && (document.recordId === null || uuid(document.recordId)))
    && Array.isArray(value.communications) && array(value.uploadClinicalRecordIds, uuid)
}

/** Compatibility boundary for the original laboratory components. Every RPC runs
 * with the authenticated caller's JWT; context never supplies an identity. */
export function createUnifiedWorkspaceReader(transport: UnifiedWorkspaceTransport) {
  return {
    async identity(token: string, context: ClinicalAccessContext): Promise<UnifiedWorkspaceIdentity> {
      const result = await transport.rpc('clinical_unified_identity', { p_context: context }, token)
      if (!identity(result, context)) invalid()
      return result
    },
    async workspace(token: string, context: ClinicalAccessContext): Promise<WorkspaceView> {
      const result = await transport.rpc('clinical_unified_workspace', { p_context: context }, token)
      if (!object(result) || !identity(result, context) || result.context !== context
        || !array(result.actors, actor) || !array(result.clients, client)
        || !array(result.records, record) || !array(result.managedRecords, record)
        || !Array.isArray(result.audit)) invalid()
      const projected = result as unknown as Omit<WorkspaceView, 'noteTypes'>
      // The original gabarits are shared, never copied or reconstructed here.
      return { ...projected, noteTypes: CLINICAL_NOTE_TEMPLATES.map(template => ({
        id: template.id, label: template.label,
        sections: CLINICAL_NOTE_BLUEPRINTS[template.id].map(section => ({ id: section.id, title: section.title })),
      })) }
    },
    async clientOverview(token: string, context: ClinicalAccessContext, patientId: string): Promise<ClientOverview> {
      if (!uuid(patientId)) throw Object.assign(new Error('UNIFIED_INVALID_ID'), { code: '22023' })
      const result = await transport.rpc('clinical_unified_client_overview', { p_patient_id: patientId, p_context: context }, token)
      if (!overview(result, patientId)) invalid()
      return result
    },
    async saveProfile(token: string, context: ClinicalAccessContext, patientId: string, profile: UpdateClientProfileInput): Promise<ClientOverview> {
      if (!uuid(patientId)) throw Object.assign(new Error('UNIFIED_INVALID_ID'), { code: '22023' })
      const result = await transport.rpc('clinical_unified_save_patient', { p_patient_id: patientId, p_context: context, p_profile: profile }, token)
      if (!overview(result, patientId)) invalid()
      return result
    },
    async savePerson(token: string, context: ClinicalAccessContext, patientId: string, personId: string | null, person: ClientPersonInput & { expectedVersion?: number }): Promise<ClientOverview> {
      if (!uuid(patientId) || (personId !== null && !uuid(personId))) throw Object.assign(new Error('UNIFIED_INVALID_ID'), { code: '22023' })
      const result = await transport.rpc('clinical_unified_save_person', {
        p_patient_id: patientId, p_context: context, p_person_id: personId, p_person: person,
      }, token)
      if (!overview(result, patientId)) invalid()
      return result
    },
    async removePerson(token: string, context: ClinicalAccessContext, patientId: string, personId: string, expectedVersion: number): Promise<ClientOverview> {
      if (!uuid(patientId) || !uuid(personId) || !integer(expectedVersion)) throw Object.assign(new Error('UNIFIED_INVALID_ID'), { code: '22023' })
      const result = await transport.rpc('clinical_unified_remove_person', {
        p_patient_id: patientId, p_context: context, p_person_id: personId, p_expected_version: expectedVersion,
      }, token)
      if (!overview(result, patientId)) invalid()
      return result
    },
  }
}
