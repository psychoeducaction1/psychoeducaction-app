import { JsonBodyError, readBoundedJsonObject } from '../boundedJsonBody.ts'
import type { ClinicalAccessContext } from '../clinical-core/types.ts'
import { CALENDAR_UUID, isCalendarPeriod } from '../clinical-calendar/durableTransport.ts'
import type { UnifiedWorkspaceTransport } from './workspace.ts'

const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const reply = (v: unknown, status = 200) => Response.json(v, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
const invalid = () => reply({ error: 'Vérifiez les plages et le nombre de clients demandés.', code: 'INVALID_INPUT' }, 400)

/** Called after common JWT authentication. SQL330 derives its owner from auth.uid(). */
export async function handleUnifiedCapacityRequest(request: Request, segments: string[], auth: { token: string; context: ClinicalAccessContext }, transport: UnifiedWorkspaceTransport): Promise<Response> {
  if (segments.length || new URL(request.url).search) return invalid()
  if (request.method !== 'POST') return reply({ error: 'Ressource introuvable.', code: 'NOT_FOUND' }, 404)
  if (auth.context !== 'clinical') return reply({ error: 'Cette demande appartient à l’espace professionnel.', code: 'FORBIDDEN' }, 403)
  try {
    const key = request.headers.get('Idempotency-Key')
    if (!key || !CALENDAR_UUID.test(key) || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return invalid()
    const data = await readBoundedJsonObject(request, 16384)
    const slots = data.offerSlots
    if (Object.keys(data).sort().join() !== 'comment,offerSlots,requestedCount,schedulePreference'
      || !Array.isArray(slots) || slots.length < 1 || slots.length > 60
      || !Number.isInteger(data.requestedCount) || Number(data.requestedCount) < 1 || Number(data.requestedCount) > slots.length
      || !['grouped', 'spread', 'flexible', 'other'].includes(String(data.schedulePreference))
      || typeof data.comment !== 'string' || data.comment.length > 300
      || (data.schedulePreference === 'other' && !data.comment.trim())
      || slots.some(slot => !object(slot) || Object.keys(slot).sort().join() !== 'day,endMinute,startMinute'
        || typeof slot.day !== 'string' || !isCalendarPeriod(slot.day, slot.day)
        || !Number.isInteger(slot.startMinute) || Number(slot.startMinute) < 480 || Number(slot.startMinute) > 1260
        || Number(slot.startMinute) % 60 !== 0 || slot.endMinute !== Number(slot.startMinute) + 60)
      || new Set(slots.map(slot => `${slot.day}/${slot.startMinute}`)).size !== slots.length) return invalid()
    const value = await transport.rpc('clinical_create_capacity_offer', {
      p_slots: slots, p_requested_count: data.requestedCount, p_preference: data.schedulePreference,
      p_comment: data.comment, p_operation_key: key,
    }, auth.token)
    if (!object(value) || Object.keys(value).length !== 3 || typeof value.id !== 'string' || !CALENDAR_UUID.test(value.id)
      || typeof value.assignmentRequestId !== 'string' || !CALENDAR_UUID.test(value.assignmentRequestId)
      || value.requestedCount !== data.requestedCount) throw Object.assign(new Error('UNIFIED_RESPONSE_INVALID'), { code: 'UNIFIED_RESPONSE_INVALID' })
    return reply(value, 201)
  } catch (cause) {
    if (cause instanceof JsonBodyError) return reply({ error: cause.message, code: 'INVALID_BODY' }, cause.status)
    throw cause
  }
}
