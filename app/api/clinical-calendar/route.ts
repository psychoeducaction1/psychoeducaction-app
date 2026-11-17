import { isLocalClinicalRuntime } from '@/lib/clinical-local/runtime'
import { localModuleUnavailable } from '@/lib/clinical-local/http'
import type { ClinicalActorInput } from '@/lib/clinical-core/types'
import { getClinicalFixtureActor, isClinicalFixtureEnabled } from '@/lib/clinical-core/fixtureAccess'
import { ClinicalError, isClinicalError, object, uuid } from '@/lib/clinical-core/validation'
import { isCalendarServiceError, type CreateAppointmentInput, type RescheduleAppointmentInput, type ClinicalAvailability } from '@/lib/clinical-calendar/types'
import { readCalendarJson } from '@/lib/clinical-calendar/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'X-Clinical-Fixture-Actor, X-Clinical-Context', 'X-Content-Type-Options': 'nosniff' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
async function handle(request: Request) {
  if (isLocalClinicalRuntime()) return localModuleUnavailable(request)
  if (!isClinicalFixtureEnabled()) return json({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
  const actor = getClinicalFixtureActor(request.headers.get('X-Clinical-Fixture-Actor'))
  if (!actor) return json({ error: 'Compte de démonstration non autorisé.', code: 'FORBIDDEN' }, 403)
  try {
    const context = request.headers.get('X-Clinical-Context')
    const actorInput:ClinicalActorInput = context === null ? actor.id : context === 'administration' || context === 'clinical' ? {actorId:actor.id,context} : (()=>{throw new ClinicalError(400,'INVALID_CONTEXT','Contexte invalide.')})()
    const { getCalendarFixtureServiceForActor } = await import('@/lib/clinical-calendar/fixtures')
    const service = getCalendarFixtureServiceForActor(actorInput)
    if (request.method === 'GET') {
      const url = new URL(request.url)
      return json({ workspace: service.getWorkspace(actorInput, url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? '') })
    }
    const value = await readCalendarJson(request)
    const envelope = object(value, ['action', 'appointmentId', 'professionalId', 'expectedRevision', 'input'])
    switch (envelope.action) {
      case 'create': {
        object(value, ['action', 'input'])
        return json({ appointments: service.createAppointments(actorInput, envelope.input as CreateAppointmentInput) }, 201)
      }
      case 'reschedule': {
        object(value, ['action', 'appointmentId', 'input'])
        return json({ appointment: service.rescheduleAppointment(actorInput, uuid(envelope.appointmentId), envelope.input as RescheduleAppointmentInput) })
      }
      case 'cancel': {
        object(value, ['action', 'appointmentId', 'input'])
        const input = object(envelope.input, ['expectedVersion', 'reason', 'scope'])
        return json({ appointments: service.cancelAppointment(actorInput, uuid(envelope.appointmentId), input as Parameters<typeof service.cancelAppointment>[2]) })
      }
      case 'outcome': {
        object(value, ['action', 'appointmentId', 'input'])
        const input = object(envelope.input, ['expectedVersion', 'status'])
        return json({ appointment: service.recordOutcome(actorInput, uuid(envelope.appointmentId), input.expectedVersion as number, input.status as 'completed' | 'no_show') })
      }
      case 'availability': {
        object(value, ['action', 'professionalId', 'input', 'expectedRevision'])
        const availability = service.setAvailability(actorInput, uuid(envelope.professionalId), envelope.input as Omit<ClinicalAvailability, 'id' | 'professionalId'>[], envelope.expectedRevision as number)
        return json({ availability, revision: (envelope.expectedRevision as number) + 1 })
      }
      default: return json({ error: 'Action du calendrier invalide.', code: 'INVALID_INPUT' }, 400)
    }
  } catch (error) {
    if (isCalendarServiceError(error) || isClinicalError(error)) return json({ error: error.message, code: error.code }, error.status)
    return json({ error: 'Le calendrier fictif ne peut pas effectuer cette opération.', code: 'FIXTURE_ERROR' }, 503)
  }
}
export async function GET(request: Request) { return handle(request) }
export async function POST(request: Request) { return handle(request) }
