import { configureClinicalFixtureAppointments, getClinicalFixtureService } from '@/lib/clinical-core/fixtures'
import { ClinicalError } from '@/lib/clinical-core/validation'
import { getCalendarFixtureServiceForActor } from '@/lib/clinical-calendar/fixtures'
import { isCalendarServiceError } from '@/lib/clinical-calendar/types'
import type { NoteAppointmentReference } from '@/lib/clinical-calendar/types'
import type { ClinicalAppointmentSource } from '@/lib/clinical-core/types'

function source(reference: NoteAppointmentReference): ClinicalAppointmentSource {
  return { id: reference.id, recordId: reference.caseId, clientId: reference.clientId, professionalId: reference.professionalId, startAt: reference.startAt, endAt: reference.endAt, modality: reference.modality, status: reference.status, version: reference.version }
}
function checked<T>(operation: () => T): T {
  try { return operation() } catch (error) {
    if (isCalendarServiceError(error)) throw new ClinicalError(error.status, 'APPOINTMENT_UNAVAILABLE', 'La rencontre choisie n’est pas disponible pour ce professionnel et ce dossier.')
    throw error
  }
}

// Composition belongs outside both domains: neither domain imports the other.
// Registering the provider is lazy; list/resolve execute only after core authorization.
export function getComposedClinicalFixtureService() {
  configureClinicalFixtureAppointments({
    list: query => checked(() => getCalendarFixtureServiceForActor({actorId: query.actorId, context: query.context ?? 'clinical'}).getNoteAppointmentChoices({actorId: query.actorId, context: query.context ?? 'clinical'}, query.recordId).map(source)),
    resolve: query => checked(() => source(getCalendarFixtureServiceForActor({actorId: query.actorId, context: query.context ?? 'clinical'}).resolveNoteAppointment({actorId: query.actorId, context: query.context ?? 'clinical'}, query.appointmentId))),
  })
  return getClinicalFixtureService()
}
