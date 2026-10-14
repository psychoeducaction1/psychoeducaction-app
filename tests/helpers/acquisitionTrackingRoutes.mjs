// Vraies routes, dependances simulees dans ce sous-processus. Aucun reseau/courriel/base reelle.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { SUPER_ADMIN_EMAIL } from '../../lib/superAdmin.ts'
import { buildIntakeSlots } from '../../lib/publicIntakeSchedule.ts'
const stored = []
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
const moduleUrl = code => `data:text/javascript,${encodeURIComponent(code)}`
globalThis.__trackingAdmin = {
  rpc: async (name, args) => {
    assert.ok(['confirm_public_intake_booking', 'create_public_callback_request'].includes(name))
    const intake = args.p_payload
    const conversionEventId = ids[stored.length]
    stored.push({ created_at: '2026-10-12T12:00:00Z', status: 'scheduled',
      contact_request_type: intake.contactType, utm: intake.utm, conversion_event_id: conversionEventId })
    return { data: { conversionEventId, appointmentId: 'fixture-private-appointment', prospectId: 'fixture-private-prospect' }, error: null }
  },
  from(table) {
    const rows = table === 'public_intake_prospects' ? stored : []
    return { select() { return this }, gte() { return this }, lt() { return this }, lte() { return this }, not() { return this },
      order() { return this }, range() { return this },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve) } }
  },
}
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/supabaseAdmin') return { url: moduleUrl('export const getSupabaseAdmin = () => globalThis.__trackingAdmin'), shortCircuit: true }
  if (specifier === '@/lib/publicIntakeNotifications') return { url: moduleUrl('export const notifyPublicIntakeAppointment = async () => {}; export const notifyRapidCallback = async () => {}'), shortCircuit: true }
  if (specifier === '@/lib/publicIntakeSecurity') return { url: moduleUrl(`
    export const isAllowedPublicIntakeOrigin = () => true;
    export const enforcePublicIntakeRateLimit = async () => true;
    export const verifyPublicIntakeTurnstile = async () => true;
    export const hashHoldToken = () => 'fixture-hash';
    export const publicIntakeOptions = () => new Response(null, {status:204});
    export const publicIntakeJson = (_request, body, status) => Response.json(body, {status});
  `), shortCircuit: true }
  if (specifier === '@/lib/directionServer') return { url: moduleUrl(`export const getDirectionContext = async () => ({context:{user:{id:'fixture-super',email:'${SUPER_ADMIN_EMAIL}'},profile:{role:'direction',is_active:true}}})`), shortCircuit: true }
  if (specifier === 'next/server') return nextResolve('next/server.js', context)
  return nextResolve(specifier, context)
} })
globalThis.fetch = async () => { assert.fail('No network permitted') }
const { NextRequest } = await import('next/server.js')
const bookings = await import('../../app/api/public/intake/bookings/route.ts')
const callbacks = await import('../../app/api/public/intake/callbacks/route.ts')
const acquisition = await import('../../app/api/direction/acquisition/route.ts')
for (const [index, type, handler, utm] of [
  [0, 'scheduled_call', bookings.POST, { source: 'google', medium: 'cpc', campaign: 'fixture-google', gclid: 'fixture-click' }],
  [1, 'rapid_callback', callbacks.POST, { source: 'meta', medium: 'paid_social', campaign: 'fixture-meta', fbclid: 'fixture-click' }],
]) {
  const response = await handler(new NextRequest('https://fixture.example.invalid/api/public/intake/fixture', {
    method: 'POST', headers: { 'Idempotency-Key': `fixture-attempt-${index}-000000`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdToken: 'fixture-hold', startAt: buildIntakeSlots('2099-10-05', 7)[0].startAt,
      turnstileToken: 'fixture-token', intake: { firstName: 'Fixture', lastName: 'Client', phone: '5145550101',
        email: 'fixture@example.invalid', requestType: 'self', modalities: ['telehealth'], contactType: type, utm } }),
  }))
  assert.equal(response.status, 201)
  assert.equal((await response.json()).conversionEventId, ids[index])
  assert.deepEqual(stored[index].utm, utm)
}
const report = await acquisition.GET(new NextRequest('https://fixture.example.invalid/api/direction/acquisition?from=2026-10-05&to=2026-10-12'))
assert.equal(report.status, 200)
assert.deepEqual((await report.json()).prospects.map(row => row.utm), stored.map(row => row.utm))
