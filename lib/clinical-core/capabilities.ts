import type { ClinicalAccessContext, ClinicalActorInput, ClinicalCapability, FixtureRole } from './types'

export type CapabilitySubject = { id: string; role: FixtureRole; capabilities?: readonly ClinicalCapability[]; context?: ClinicalAccessContext }
export type ResolvedActor<T extends CapabilitySubject> = T & { context: ClinicalAccessContext }
/** No role fallback: a missing or empty capability set grants nothing. */
export function capabilitiesOf(actor: CapabilitySubject): readonly ClinicalCapability[] { return Array.isArray(actor.capabilities) ? actor.capabilities : [] }
export function hasCapability(actor: CapabilitySubject, capability: ClinicalCapability): boolean { return capabilitiesOf(actor).includes(capability) }
export function canAdmin(actor: CapabilitySubject): boolean { return actor.context === 'administration' && hasCapability(actor, 'administration') }
export function canPractice(actor: CapabilitySubject): boolean { return actor.context === 'clinical' && hasCapability(actor, 'practice') }
export function canSupervise(actor: CapabilitySubject): boolean { return actor.context === 'clinical' && hasCapability(actor, 'supervision') }
export function actorIdOf(input: ClinicalActorInput): string {
  if (typeof input === 'string' && input.length > 0 && input.length <= 200) return input
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['actorId', 'context'].includes(key))
    || typeof input.actorId !== 'string' || !input.actorId || input.actorId.length > 200
    || !['administration', 'clinical'].includes(input.context)) throw new Error('Contexte d’accès invalide.')
  return input.actorId
}
/** Resolve every request independently; a context never creates a capability or a record grant. */
export function resolveActor<T extends CapabilitySubject>(actor: T, input: ClinicalActorInput): ResolvedActor<T> {
  if (actorIdOf(input) !== actor.id) throw new Error('Identité d’accès invalide.')
  const administrative = hasCapability(actor, 'administration')
  const clinical = hasCapability(actor, 'practice') || hasCapability(actor, 'supervision')
  const context = typeof input === 'string'
    ? administrative && clinical ? null : administrative ? 'administration' : clinical ? 'clinical' : null
    : input.context
  if (!context || (context === 'administration' ? !administrative : !clinical)) throw new Error('Sélectionnez un contexte autorisé explicite pour ce compte.')
  return { ...actor, context }
}
export function actorRequest(actor: CapabilitySubject & { context: ClinicalAccessContext }): Exclude<ClinicalActorInput, string> {
  return { actorId: actor.id, context: actor.context }
}