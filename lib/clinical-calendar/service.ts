import { actorIdOf, actorRequest, canAdmin as canAdminister, canPractice, hasCapability, resolveActor, type ResolvedActor } from '../clinical-core/capabilities.ts'
import type { ClinicalActorInput } from '../clinical-core/types'
import {
  CalendarServiceError, type CalendarActor, type CalendarDirectory, type CalendarStore, type CalendarWorkspace,
  type ClinicalAppointment, type ClinicalAvailability, type CreateAppointmentInput, type RescheduleAppointmentInput, type CalendarAuditEvent, type NoteAppointmentReference,
} from './types.ts'
import { addMinutes, calendarRange, intervalsOverlap, shiftCalendarDate, torontoLocalInstant, validCalendarDate } from './time.ts'

export function createCalendarStore(seed: Partial<CalendarStore> = {}): CalendarStore {
  return structuredClone({ appointments: [], offices: [], availability: [], availabilityRevisions: {}, audit: [], ...seed })
}
function integer(value: unknown, minimum: number, maximum: number, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new CalendarServiceError('INVALID_INPUT', `${name} invalide.`)
  return value
}
function exactKeys(value: object, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new CalendarServiceError('INVALID_INPUT', 'Les champs du calendrier sont invalides.')
  }
}
const blocked = (a: ClinicalAppointment) => a.status !== 'cancelled'
const occupiedStart = (a: ClinicalAppointment) => addMinutes(a.startAt, -a.travelBeforeMinutes)
const occupiedEnd = (a: ClinicalAppointment) => addMinutes(a.endAt, a.travelAfterMinutes)

export function createClinicalCalendarService(options: {
  store: CalendarStore; directory: CalendarDirectory; now?: () => Date; newId?: () => string
}) {
  const { store, directory } = options
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? (() => crypto.randomUUID())
  function actorFor(input: ClinicalActorInput) {
    try {
      const actor = directory.actors().find(value => value.id === actorIdOf(input))
      if (actor) return resolveActor(actor, input)
    } catch { /* An explicit valid context is required; never fall back after failure. */ }
    throw new CalendarServiceError('FORBIDDEN', 'Compte ou contexte de démonstration non autorisé.', 403)
  }
  function professionalFor(professionalId: string) {
    const professional = directory.actors().find(value => value.id === professionalId)
    if (!professional || !hasCapability(professional, 'practice')) throw new CalendarServiceError('INVALID_INPUT', 'Choisissez un professionnel.')
    return professional
  }
  function authorizedCase(actor: ResolvedActor<CalendarActor>, caseId: string, professionalId: string, requireOpen = true) {
    professionalFor(professionalId)
    if (!canAdminister(actor) && actor.id !== professionalId) throw new CalendarServiceError('FORBIDDEN', 'Vous pouvez gérer uniquement votre agenda.', 403)
    const careCase = directory.casesFor(professionalId).find(value => value.id === caseId && value.professionalIds.includes(professionalId))
    if (!careCase || (!canAdminister(actor) && !directory.casesFor(actor.id).some(value => value.id === caseId))) {
      throw new CalendarServiceError('NOT_FOUND', 'Dossier non disponible pour ce professionnel.', 404)
    }
    if (requireOpen && careCase.status !== 'open') throw new CalendarServiceError('INVALID_TRANSITION', 'Le dossier doit être ouvert pour planifier un rendez-vous.', 409)
    const client = directory.clientsFor(actorRequest(actor)).find(value => value.id === careCase.clientId)
    if (!client) throw new CalendarServiceError('NOT_FOUND', 'Client non disponible.', 404)
    return { careCase, client }
  }
  function managedAppointment(actor: ResolvedActor<CalendarActor>, id: string, expectedVersion: number) {
    integer(expectedVersion, 1, Number.MAX_SAFE_INTEGER, 'Version')
    const appointment = store.appointments.find(value => value.id === id)
    if (!appointment) throw new CalendarServiceError('NOT_FOUND', 'Rendez-vous non disponible.', 404)
    authorizedCase(actor, appointment.caseId, appointment.professionalId, false)
    if (appointment.version !== expectedVersion) throw new CalendarServiceError('VERSION_CONFLICT', 'Ce rendez-vous a changé. Actualisez avant de continuer.', 409)
    return appointment
  }
  function assertConflicts(candidate: ClinicalAppointment, appointments: ClinicalAppointment[]) {
    for (const existing of appointments) {
      if (!blocked(existing) || existing.id === candidate.id) continue
      if (existing.professionalId === candidate.professionalId && intervalsOverlap(occupiedStart(candidate), occupiedEnd(candidate), occupiedStart(existing), occupiedEnd(existing))) {
        throw new CalendarServiceError('CONFLICT', 'Le professionnel est déjà occupé sur cette plage, déplacements compris.', 409)
      }
      if (existing.officeId && existing.officeId === candidate.officeId && intervalsOverlap(candidate.startAt, candidate.endAt, existing.startAt, existing.endAt)) {
        throw new CalendarServiceError('CONFLICT', 'Ce bureau est déjà occupé sur cette plage.', 409)
      }
      if (existing.clientId === candidate.clientId && intervalsOverlap(candidate.startAt, candidate.endAt, existing.startAt, existing.endAt)) {
        throw new CalendarServiceError('CONFLICT', 'Un autre rendez-vous existe pour ce client sur cette plage.', 409)
      }
    }
  }
  function temporalInput(input: Pick<CreateAppointmentInput, 'startLocal' | 'durationMinutes' | 'modality' | 'officeId' | 'travelBeforeMinutes' | 'travelAfterMinutes' | 'disambiguation'>) {
    const duration = integer(input.durationMinutes, 1, 720, 'Durée')
    if (!['office', 'home', 'phone', 'video'].includes(input.modality)) throw new CalendarServiceError('INVALID_INPUT', 'Modalité invalide.')
    if (input.disambiguation !== undefined && !['earlier', 'later'].includes(input.disambiguation)) throw new CalendarServiceError('INVALID_INPUT', 'Choix du changement d’heure invalide.')
    const officeId = input.officeId || null
    if (input.modality === 'office' ? !store.offices.some(office => office.id === officeId && office.active) : officeId !== null) {
      throw new CalendarServiceError('INVALID_INPUT', 'Choisissez un bureau actif uniquement pour une rencontre au bureau.')
    }
    const startAt = torontoLocalInstant(input.startLocal, input.disambiguation)
    return { startAt, endAt: addMinutes(startAt, duration), modality: input.modality, officeId,
      travelBeforeMinutes: integer(input.travelBeforeMinutes ?? 0, 0, 180, 'Temps de déplacement avant'),
      travelAfterMinutes: integer(input.travelAfterMinutes ?? 0, 0, 180, 'Temps de déplacement après') }
  }
  function commit(next: ClinicalAppointment[], events: Omit<CalendarAuditEvent, 'id' | 'at'>[]) {
    const stamped = events.map(event => ({ ...event, id: newId(), at: now().toISOString() }))
    // Toute validation et construction d'audit précède ces deux remplacements synchrones.
    store.appointments = next
    store.audit = [...store.audit, ...stamped]
  }
  function createAppointments(actorId: ClinicalActorInput, input: CreateAppointmentInput): ClinicalAppointment[] {
    const actor = actorFor(actorId)
    exactKeys(input, ['caseId', 'professionalId', 'startLocal', 'durationMinutes', 'modality', 'officeId', 'travelBeforeMinutes', 'travelAfterMinutes', 'recurrence', 'disambiguation'])
    const { client } = authorizedCase(actor, input.caseId, input.professionalId)
    let count = 1
    if (input.recurrence) {
      exactKeys(input.recurrence, ['frequency', 'count'])
      if (input.recurrence.frequency !== 'weekly') throw new CalendarServiceError('INVALID_INPUT', 'Seule la répétition hebdomadaire limitée est disponible.')
      count = integer(input.recurrence.count, 2, 12, 'Nombre de rencontres')
    }
    const seriesId = count > 1 ? newId() : null
    const candidateRows: ClinicalAppointment[] = []
    const timestamp = now().toISOString()
    for (let index = 0; index < count; index++) {
      const startLocal = index === 0 ? input.startLocal : `${shiftCalendarDate(input.startLocal.slice(0, 10), index * 7)}${input.startLocal.slice(10)}`
      const candidate: ClinicalAppointment = { id: newId(), caseId: input.caseId, clientId: client.id, professionalId: input.professionalId,
        ...temporalInput({ ...input, startLocal }), status: 'planned', seriesId, version: 1, createdAt: timestamp, updatedAt: timestamp,
        cancelledAt: null, cancellationReason: null }
      assertConflicts(candidate, [...store.appointments, ...candidateRows])
      candidateRows.push(candidate)
    }
    commit([...store.appointments, ...candidateRows], candidateRows.map(value => ({ actorId: actor.id, context: actor.context, appointmentId: value.id, professionalId: value.professionalId, action: 'appointment_created', version: value.version })))
    return structuredClone(candidateRows)
  }
  function rescheduleAppointment(actorId: ClinicalActorInput, appointmentId: string, input: RescheduleAppointmentInput) {
    const actor = actorFor(actorId)
    exactKeys(input, ['expectedVersion', 'startLocal', 'durationMinutes', 'modality', 'officeId', 'travelBeforeMinutes', 'travelAfterMinutes', 'disambiguation'])
    const previous = managedAppointment(actor, appointmentId, input.expectedVersion)
    authorizedCase(actor, previous.caseId, previous.professionalId)
    if (previous.status !== 'planned') throw new CalendarServiceError('INVALID_TRANSITION', 'Seul un rendez-vous planifié peut être déplacé.', 409)
    const candidate = { ...previous, ...temporalInput(input), version: previous.version + 1, updatedAt: now().toISOString() }
    assertConflicts(candidate, store.appointments)
    commit(store.appointments.map(value => value.id === previous.id ? candidate : value), [{ actorId: actor.id, context: actor.context, appointmentId, professionalId: candidate.professionalId, action: 'appointment_rescheduled', version: candidate.version }])
    return structuredClone(candidate)
  }
  function cancelAppointment(actorId: ClinicalActorInput, appointmentId: string, input: { expectedVersion: number; reason: 'client' | 'professional' | 'clinic'; scope?: 'one' | 'future' }) {
    const actor = actorFor(actorId)
    exactKeys(input, ['expectedVersion', 'reason', 'scope'])
    const previous = managedAppointment(actor, appointmentId, input.expectedVersion)
    if (previous.status !== 'planned') throw new CalendarServiceError('INVALID_TRANSITION', 'Ce rendez-vous ne peut plus être annulé.', 409)
    if (!['client', 'professional', 'clinic'].includes(input.reason) || (input.scope !== undefined && !['one', 'future'].includes(input.scope))) throw new CalendarServiceError('INVALID_INPUT', 'Annulation invalide.')
    const targeted = store.appointments.filter(value => value.id === previous.id || (input.scope === 'future' && previous.seriesId && value.seriesId === previous.seriesId && value.startAt >= previous.startAt && value.status === 'planned'))
    targeted.forEach(value => authorizedCase(actor, value.caseId, value.professionalId, false))
    const ids = new Set(targeted.map(value => value.id))
    const timestamp = now().toISOString()
    const updated = targeted.map(value => ({ ...value, status: 'cancelled' as const, cancellationReason: input.reason, cancelledAt: timestamp, updatedAt: timestamp, version: value.version + 1 }))
    commit(store.appointments.map(value => ids.has(value.id) ? updated.find(item => item.id === value.id)! : value), updated.map(value => ({ actorId: actor.id, context: actor.context, appointmentId: value.id, professionalId: value.professionalId, action: 'appointment_cancelled', version: value.version })))
    return structuredClone(updated)
  }
  function recordOutcome(actorId: ClinicalActorInput, appointmentId: string, expectedVersion: number, status: 'completed' | 'no_show') {
    const actor = actorFor(actorId)
    const previous = managedAppointment(actor, appointmentId, expectedVersion)
    if (!['completed', 'no_show'].includes(status)) throw new CalendarServiceError('INVALID_INPUT', 'Résultat invalide.')
    if (previous.status !== 'planned' || Date.parse(previous.startAt) > now().getTime()) throw new CalendarServiceError('INVALID_TRANSITION', 'Le rendez-vous doit avoir commencé et être planifié.', 409)
    const candidate = { ...previous, status, updatedAt: now().toISOString(), version: previous.version + 1 }
    commit(store.appointments.map(value => value.id === appointmentId ? candidate : value), [{ actorId: actor.id, context: actor.context, appointmentId, professionalId: candidate.professionalId, action: `appointment_${status}`, version: candidate.version }])
    return structuredClone(candidate)
  }
  function setAvailability(actorId: ClinicalActorInput, professionalId: string, input: Omit<ClinicalAvailability, 'id' | 'professionalId'>[], expectedRevision: number) {
    const actor = actorFor(actorId)
    professionalFor(professionalId)
    if (!canAdminister(actor) && actor.id !== professionalId) throw new CalendarServiceError('FORBIDDEN', 'Vous pouvez gérer uniquement vos disponibilités.', 403)
    integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1, 'Révision des disponibilités')
    const previousRevision = store.availabilityRevisions[professionalId] ?? 0
    if (expectedRevision !== previousRevision) throw new CalendarServiceError('VERSION_CONFLICT', 'Les disponibilités de ce professionnel ont changé. Actualisez avant de continuer.', 409)
    if (!Array.isArray(input) || input.length > 21) throw new CalendarServiceError('INVALID_INPUT', 'Indiquez au maximum 21 plages de disponibilité.')
    const candidates = input.map(value => {
      exactKeys(value, ['weekday', 'startMinute', 'endMinute', 'validFrom', 'validTo'])
      const weekday = integer(value.weekday, 1, 7, 'Jour')
      const startMinute = integer(value.startMinute, 0, 1439, 'Début')
      const endMinute = integer(value.endMinute, 1, 1440, 'Fin')
      if (startMinute >= endMinute || !validCalendarDate(value.validFrom) || (value.validTo !== null && (!validCalendarDate(value.validTo) || value.validTo < value.validFrom))) throw new CalendarServiceError('INVALID_INPUT', 'Plage de disponibilité invalide.')
      return { ...value, id: newId(), professionalId, weekday, startMinute, endMinute }
    })
    const replacement = [...store.availability.filter(value => value.professionalId !== professionalId), ...candidates]
    const event = { id: newId(), actorId: actor.id, context: actor.context, appointmentId: null, professionalId, action: 'availability_changed', at: now().toISOString(), version: previousRevision + 1 }
    store.availability = replacement
    store.availabilityRevisions = { ...store.availabilityRevisions, [professionalId]: previousRevision + 1 }
    store.audit = [...store.audit, event]
    return structuredClone(candidates)
  }
  function getWorkspace(actorId: ClinicalActorInput, from: string, to: string): CalendarWorkspace {
    const actor = actorFor(actorId)
    const range = calendarRange(from, to)
    const professionals = directory.actors().filter(value => hasCapability(value, 'practice'))
    const clients = directory.clientsFor(actorRequest(actor))
    const cases = canAdminister(actor) ? professionals.flatMap(value => directory.casesFor(value.id)) : directory.casesFor(actor.id)
    const uniqueCases = [...new Map(cases.map(value => [value.id, value])).values()]
    const choices = uniqueCases.filter(value => value.status === 'open').flatMap(value => {
      const client = clients.find(item => item.id === value.clientId)
      return client ? [{ clientId: client.id, caseId: value.id, name: `${client.firstName} ${client.lastName}`, professionalIds: [...value.professionalIds] }] : []
    })
    const rows = store.appointments.filter(value => intervalsOverlap(occupiedStart(value), occupiedEnd(value), range.from, range.to))
    const authorized = (value: ClinicalAppointment) => canAdminister(actor) || (value.professionalId === actor.id && uniqueCases.some(careCase => careCase.id === value.caseId))
    const visible = rows.filter(authorized)
    const busy = rows.filter(value => !authorized(value) && blocked(value)).flatMap(value => [
      { professionalId: value.professionalId, officeId: null, startAt: occupiedStart(value), endAt: occupiedEnd(value), kind: 'busy' as const, resource: 'professional' as const },
      ...(value.officeId ? [{ professionalId: value.professionalId, officeId: value.officeId, startAt: value.startAt, endAt: value.endAt, kind: 'busy' as const, resource: 'office' as const }] : []),
    ])
    const audit = store.audit.filter(value => canAdminister(actor) || (value.professionalId === actor.id && (!value.appointmentId || visible.some(row => row.id === value.appointmentId))))
    return structuredClone({ mode: 'isolated_fixture', durable: false, context: actor.context, currentTime: now().toISOString(), actor, professionals: [...professionals], clients: choices,
      offices: store.offices, appointments: visible.map(value => ({ ...value,
        clientName: clients.find(client => client.id === value.clientId) ? `${clients.find(client => client.id === value.clientId)!.firstName} ${clients.find(client => client.id === value.clientId)!.lastName}` : 'Client non disponible', canManage: value.status === 'planned' })),
      busy, availability: store.availability.filter(value => canAdminister(actor) || value.professionalId === actor.id),
      availabilityRevisions: Object.fromEntries(professionals.filter(value => canAdminister(actor) || value.id === actor.id).map(value => [value.id, store.availabilityRevisions[value.id] ?? 0])), audit, from, to })
  }
  function getBillingAppointments(actorId: ClinicalActorInput) {
    const actor = actorFor(actorId)
    // Historique financier propre, indépendant du droit actuel de lire une note clinique.
    // Cette projection interne ne contient ni texte clinique ni dossier ni occupation d'un collègue.
    return structuredClone(store.appointments.filter(value => canAdminister(actor) || value.professionalId === actor.id).map(value => ({
      id: value.id, clientId: value.clientId, professionalId: value.professionalId, startAt: value.startAt, endAt: value.endAt, status: value.status,
    })))
  }
  const noteReference = (value: ClinicalAppointment): NoteAppointmentReference => ({ id: value.id, caseId: value.caseId, clientId: value.clientId, professionalId: value.professionalId,
    startAt: value.startAt, endAt: value.endAt, modality: value.modality, status: value.status, version: value.version })
  function noteActor(actorId: ClinicalActorInput) {
    const actor = actorFor(actorId)
    if (!canPractice(actor)) throw new CalendarServiceError('FORBIDDEN', 'Cette liaison est réservée à l’auteur professionnel de la note.', 403)
    return actor
  }
  function getNoteAppointmentChoices(actorId: ClinicalActorInput, caseId: string): NoteAppointmentReference[] {
    const actor = noteActor(actorId)
    authorizedCase(actor, caseId, actor.id, false)
    return structuredClone(store.appointments.filter(value => value.professionalId === actor.id && value.caseId === caseId && ['planned', 'completed'].includes(value.status))
      .sort((a, b) => a.startAt.localeCompare(b.startAt)).map(noteReference))
  }
  function resolveNoteAppointment(actorId: ClinicalActorInput, appointmentId: string): NoteAppointmentReference {
    const actor = noteActor(actorId)
    const appointment = store.appointments.find(value => value.id === appointmentId && value.professionalId === actor.id)
    if (!appointment) throw new CalendarServiceError('NOT_FOUND', 'Rencontre non disponible pour cet auteur.', 404)
    authorizedCase(actor, appointment.caseId, actor.id, false)
    if (!['planned', 'completed'].includes(appointment.status)) throw new CalendarServiceError('INVALID_TRANSITION', 'Une note peut être rattachée seulement à une rencontre planifiée ou effectuée.', 409)
    return structuredClone(noteReference(appointment))
  }
  return { getWorkspace, getBillingAppointments, getNoteAppointmentChoices, resolveNoteAppointment, createAppointments, rescheduleAppointment, cancelAppointment, recordOutcome, setAvailability }
}
