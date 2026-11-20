import { hasCapability } from '@/lib/clinical-core/capabilities'
import type { ClinicalActorInput } from '@/lib/clinical-core/types'
import { getClinicalFixtureService, CLINICAL_FIXTURE_ACTORS } from '@/lib/clinical-core/fixtures'
import { createCalendarStore, createClinicalCalendarService } from './service.ts'
import type { CalendarDirectory, CalendarStore } from './types.ts'

const officeA = '71000000-0000-4000-8000-000000000001'
const officeB = '71000000-0000-4000-8000-000000000002'
const now = () => new Date('2026-10-17T12:00:00.000Z')

function directoryFor(actorId: ClinicalActorInput): CalendarDirectory {
  const context = getClinicalFixtureService().getSchedulingDirectory(actorId)
  const actors = context.actors.map(value => ({ id: value.id, name: value.displayName, role: value.role, capabilities: value.capabilities }))
  const cases = context.records.map(value => ({ id: value.id, clientId: value.clientId, status: value.status,
    professionalIds: value.members.filter(member => member.canRead).map(member => member.actorId) }))
  return { actors: () => actors, clientsFor: () => context.clients,
    casesFor: targetId => cases.filter(value => value.professionalIds.includes(targetId)) }
}
function seededStore(): CalendarStore {
  const directory = directoryFor(CLINICAL_FIXTURE_ACTORS[0].id)
  const professionals = directory.actors().filter(value => hasCapability(value, 'practice'))
  const store = createCalendarStore({
    offices: [{ id: officeA, name: 'Longueuil — bureau A fictif', color: '#8a5633', active: true },
      { id: officeB, name: 'Longueuil — bureau B fictif', color: '#19766f', active: true }],
    availability: professionals.flatMap(professional => Array.from({ length: 6 }, (_, index) => ({ id: crypto.randomUUID(),
      professionalId: professional.id, weekday: index + 1, startMinute: index === 5 ? 9 * 60 : 8 * 60,
      endMinute: index === 5 ? 13 * 60 : 18 * 60, validFrom: '2026-01-01', validTo: null }))),
  })
  const service = createClinicalCalendarService({ store, directory, now })
  const admin = CLINICAL_FIXTURE_ACTORS[0].id
  const professional = CLINICAL_FIXTURE_ACTORS[2].id
  const supervisor = CLINICAL_FIXTURE_ACTORS[3].id
  const first = directory.casesFor(professional)[0]
  const second = directory.casesFor(supervisor).find(value => value.id !== first?.id)
  if (first) {
    const [past] = service.createAppointments(admin, { caseId: first.id, professionalId: professional,
      startLocal: '2026-10-16T09:00', durationMinutes: 60, modality: 'office', officeId: officeA })
    service.recordOutcome(admin, past.id, 1, 'completed')
    service.createAppointments(admin, { caseId: first.id, professionalId: professional, startLocal: '2026-10-19T09:00', durationMinutes: 60,
      modality: 'office', officeId: officeA, recurrence: { frequency: 'weekly', count: 3 } })
    service.createAppointments(admin, { caseId: first.id, professionalId: professional, startLocal: '2026-10-20T14:00', durationMinutes: 75,
      modality: 'home', travelBeforeMinutes: 30, travelAfterMinutes: 30 })
  }
  if (second) service.createAppointments(admin, { caseId: second.id, professionalId: supervisor, startLocal: '2026-10-19T10:00', durationMinutes: 50, modality: 'office', officeId: officeB })
  return store
}

/** Toujours appeler après le triple verrou HTTP. Le singleton ne persiste rien sur disque. */
export function getCalendarFixtureServiceForActor(actorId: ClinicalActorInput) {
  const runtime = globalThis as typeof globalThis & { __peaClinicalCalendarStoreV1?: CalendarStore }
  const store = runtime.__peaClinicalCalendarStoreV1 ??= seededStore()
  store.availabilityRevisions ??= {}
  return createClinicalCalendarService({ store, directory: directoryFor(actorId), now })
}
