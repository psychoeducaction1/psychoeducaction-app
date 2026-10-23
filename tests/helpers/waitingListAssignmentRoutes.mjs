import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const actorId = '10000000-0000-4000-8000-000000000001'
const clientId = '10000000-0000-4000-8000-000000000002'
const body = { professionalId: '10000000-0000-4000-8000-000000000003',
  idempotencyKey: '10000000-0000-4000-8000-000000000004', outcome: 'pending' }
let denied = 0
let authorized = false
let calls = []
globalThis.__waitingAuthorize = async () => {
  authorized = true
  return denied ? { error: { message: 'Compte interdit fictif', status: denied } }
    : { context: { user: { id: actorId } } }
}
globalThis.__waitingAdmin = () => {
  assert.ok(authorized && !denied, 'Client privilégié avant autorisation')
  return { from: () => assert.fail('Aucune écriture multiétape'), rpc: async (name, args) => {
    calls.push({ name, args })
    return { data: { success: true }, error: null }
  } }
}
const moduleUrl = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { shortCircuit: true, url: moduleUrl('export {}') }
  if (specifier === '@/lib/directionServer') return { shortCircuit: true,
    url: moduleUrl('export const getDirectionContext=globalThis.__waitingAuthorize') }
  if (specifier === '@/lib/supabaseAdmin') return { shortCircuit: true,
    url: moduleUrl('export const getSupabaseAdmin=globalThis.__waitingAdmin') }
  if (specifier === 'next/server') return nextResolve('next/server.js', context)
  return nextResolve(specifier, context)
} })
const { NextRequest } = await import('next/server.js')
for (const [route, rpc] of [['assign','create_waiting_list_assignment']]) {
  const { POST } = await import(`../../app/api/direction/waiting-list-clients/[id]/${route}/route.ts`)
  for (const status of [401,403,0]) {
    denied = status; authorized = false; calls = []
    const response = await POST(new NextRequest(`https://fixture.example.invalid/${route}`, {
      method: 'POST', body: status ? '{invalide' : JSON.stringify({ ...body, actorId: 'forgé' }),
    }), { params: Promise.resolve({ id: clientId }) })
    assert.equal(response.status, status || 200)
    assert.equal(calls.length, status ? 0 : 1)
    if (!status) {
      assert.equal(calls[0].name, rpc)
      assert.equal(calls[0].args.p_actor_id, actorId)
      assert.match(response.headers.get('cache-control'), /private, no-store/)
    }
  }
}

const { POST: assign } = await import('../../app/api/direction/waiting-list-clients/[id]/assign/route.ts')
denied = 0; authorized = false; calls = []
const scheduled = await assign(new NextRequest('https://fixture.example.invalid/assign', { method: 'POST',
  body: JSON.stringify({ ...body, outcome: 'service_taken', appointment: { date: '2026-11-10', time: '14:30', modality: 'montreal', address: 'adresse falsifiée' } }),
}), { params: Promise.resolve({ id: clientId }) })
assert.equal(scheduled.status, 200)
assert.equal(calls[0].name, 'create_scheduled_waiting_list_assignment')
assert.match(calls[0].args.p_appointment.address, /1600, boulevard Henri-Bourassa Ouest/)
assert.match(calls[0].args.p_appointment.address, /bureau 233 \(2e étage\)/)
assert.equal(calls[0].args.p_appointment.startsAt, '2026-11-10T19:30:00.000Z')
for (const scenario of [
  { text: JSON.stringify({ ...body, extra: 'x'.repeat(3_000) }), status: 413 },
  { text: JSON.stringify({ ...body, extra: 'x'.repeat(3_000) }), contentLength: '1', status: 413 },
  { text: JSON.stringify(body), contentLength: '4096', status: 413 },
  { text: '[', status: 400 }, { text: '[]', status: 400 },
]) {
  denied = 0; authorized = false; calls = []
  const bytes = new TextEncoder().encode(scenario.text)
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
  const response = await assign(new NextRequest('https://fixture.example.invalid/assign', {
    method: 'POST', body: stream, duplex: 'half',
    headers: scenario.contentLength ? { 'Content-Length': scenario.contentLength } : {},
  }), { params: Promise.resolve({ id: clientId }) })
  assert.equal(response.status, scenario.status)
  assert.equal(calls.length, 0, 'Aucun RPC pour un flux surdimensionné ou JSON invalide')
}
