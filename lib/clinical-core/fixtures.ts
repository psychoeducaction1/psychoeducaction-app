import { createClinicalService } from '@/lib/clinical-core/service'
import { createMemoryClinicalStore, emptyClinicalState } from '@/lib/clinical-core/store'
import type { ClinicalService } from './service'
import type { ClinicalAppointmentProvider } from './types'
import { ClinicalError } from '@/lib/clinical-core/validation'
import { CLINICAL_FIXTURE_ACTORS } from '@/lib/clinical-core/actors'
export { CLINICAL_FIXTURE_ACTORS } from '@/lib/clinical-core/actors'

// A fresh isolated demonstration. No data is imported from existing patients or accounts.
export function createClinicalFixtureService(options: { now?: () => string; appointments?: ClinicalAppointmentProvider } = {}) {
  let sequence = 100
  let seeding = true
  const initial = emptyClinicalState()
  initial.actors = structuredClone([...CLINICAL_FIXTURE_ACTORS])
  const store = createMemoryClinicalStore(initial)
  const service = createClinicalService({ store, appointments: options.appointments, now: () => seeding ? '2026-10-17T12:00:00.000Z' : (options.now?.() ?? '2026-10-17T12:00:00.000Z'), newId: () => `50000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}` })
  const [admin, , professional, supervisor] = CLINICAL_FIXTURE_ACTORS
  const first = service.createClient(admin.id, { firstName: 'Léa', lastName: 'Martin', birthDate: '2010-04-18' })
  service.addContact(admin.id, first.id, { fullName: 'Robin Martin — fictif', relationship: 'Parent', email: 'parent.lea@example.invalid', phone: '000-000-0000' })
  service.addRepresentative(admin.id, first.id, { fullName: 'Robin Martin — fictif', relationship: 'Parent', authorityVerified: false })
  service.addPayer(admin.id, first.id, { fullName: 'Robin Martin — fictif', payerType: 'parent', email: 'parent.lea@example.invalid' })
  let firstProjection = service.createRequest(admin.id, first.id, { service: 'Psychoéducation fictive', administrativeReason: 'Demande administrative de démonstration.' })
  firstProjection = service.createEpisode(admin.id, first.id, { requestId: firstProjection.requests[0].id, label: 'Suivi fictif — automne' })
  const firstRecord = service.createClinicalRecord(admin.id, { clientId: first.id, episodeId: firstProjection.episodes[0].id, label: 'Dossier clinique fictif A', members: [
    { actorId: professional.id, canRead: true, canWrite: true, canCosign: false, requiresCosignature: true, supervisorId: supervisor.id },
    { actorId: supervisor.id, canRead: true, canWrite: true, canCosign: true, requiresCosignature: false, supervisorId: null },
  ] })
  service.createNote(professional.id, firstRecord.id, { noteType: 'evolution', encounterDate: '2026-10-16', content: { objectif: 'Essai entièrement fictif : faciliter les transitions.', informations: 'Le personnage décrit un coucher parfois difficile.', interventions: 'Discussion fictive et essai d’une routine visuelle.', suite: 'Revoir cette stratégie lors d’un prochain essai fictif.' } })
  const evaluation = service.createNote(supervisor.id, firstRecord.id, { noteType: 'evaluation_1', encounterDate: '2026-10-15', content: { objectif: 'Explorer une demande fictive de psychoéducation.', informations: 'Données synthétiques pour tester la conservation des versions.' } })
  service.signNote(supervisor.id, evaluation.note.id, { expectedVersion: 1, attested: true })
  const homonym = service.createClient(admin.id, { firstName: 'Léa', lastName: 'Martin', birthDate: '1990-08-03' })
  let secondProjection = service.createRequest(admin.id, homonym.id, { service: 'Accompagnement fictif' })
  secondProjection = service.createEpisode(admin.id, homonym.id, { requestId: secondProjection.requests[0].id, label: 'Épisode sans dossier clinique' })
  service.linkAssignment(admin.id, homonym.id, { episodeId: secondProjection.episodes[0].id, externalAssignmentId: '60000000-0000-4000-8000-000000000001' })
  const other = service.createClient(admin.id, { firstName: 'Alex', lastName: 'Dubois', birthDate: '1985-02-11' })
  const thirdProjection = service.createEpisode(admin.id, other.id, { label: 'Suivi fictif réservé à Sam' })
  const privateRecord = service.createClinicalRecord(admin.id, { clientId: other.id, episodeId: thirdProjection.episodes[0].id, label: 'Dossier fictif B — autre professionnel', members: [
    { actorId: supervisor.id, canRead: true, canWrite: true, canCosign: false, requiresCosignature: false, supervisorId: null },
  ] })
  service.createNote(supervisor.id, privateRecord.id, { noteType: 'observation', content: { description: 'Contenu fictif réservé au second dossier autorisé.' } })
  seeding = false
  return service
}

// Call only after the HTTP fixture gate. This module has no production adapter.
// The shared process global also spans separate Next route module graphs. It is
// intentionally lost on restart; this is not a database or durable patient store.
type ClinicalFixtureRuntime = typeof globalThis & { __peaClinicalFixtureServiceV1?: ClinicalService; __peaClinicalAppointmentProviderV1?: ClinicalAppointmentProvider }
export function configureClinicalFixtureAppointments(provider: ClinicalAppointmentProvider) {
  const runtime = globalThis as ClinicalFixtureRuntime
  runtime.__peaClinicalAppointmentProviderV1 = provider
}
export function getClinicalFixtureService(): ClinicalService {
  const runtime = globalThis as ClinicalFixtureRuntime
  const provider = () => {
    if (!runtime.__peaClinicalAppointmentProviderV1) throw new ClinicalError(503, 'APPOINTMENT_PROVIDER_UNAVAILABLE', 'Les rencontres ne peuvent pas être vérifiées pour le moment.')
    return runtime.__peaClinicalAppointmentProviderV1
  }
  return runtime.__peaClinicalFixtureServiceV1 ??= createClinicalFixtureService({ now: () => new Date().toISOString(), appointments: { list: query => provider().list(query), resolve: query => provider().resolve(query) } })
}
