import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createSupabaseStub } from './supabaseStub.ts'

let denied = 0
let authorized = false
let privateReads = 0
globalThis.fetch = async () => assert.fail('Aucun accès réseau dans ce test')
const stub = createSupabaseStub({ assigned_clients: [
  { assignment_request_id: 'fixture-request', is_active: true, canceled_at: null },
  { assignment_request_id: 'fixture-request', is_active: false, canceled_at: null },
  { assignment_request_id: 'fixture-request', is_active: null, canceled_at: null },
  { assignment_request_id: 'fixture-request', is_active: null, canceled_at: null },
  { assignment_request_id: 'fixture-request', is_active: true, canceled_at: '2026-01-01' },
  { assignment_request_id: 'other-request', is_active: true, canceled_at: null },
] })
globalThis.__requestSummaryAuthorize = async () => {
  authorized = true
  return denied ? { error: { status: denied, message: 'Interdit' } }
    : { context: { user: { id: 'fixture-admin' }, profile: { role: 'direction' } } }
}
globalThis.__requestSummaryAdmin = () => {
  assert.ok(authorized && !denied, 'Accès privilégié avant autorisation')
  privateReads++
  return stub.client
}
const moduleUrl = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/superAdminServer') return {
    url: moduleUrl('export const getSuperAdminContext = globalThis.__requestSummaryAuthorize'), shortCircuit: true,
  }
  if (specifier === '@/lib/supabaseAdmin') return {
    url: moduleUrl('export const getSupabaseAdmin = globalThis.__requestSummaryAdmin'), shortCircuit: true,
  }
  if (specifier === 'server-only') return { url: moduleUrl('export {}'), shortCircuit: true }
  if (specifier === 'next/server') return nextResolve('next/server.js', context)
  return nextResolve(specifier, context)
} })
const { NextRequest } = await import('next/server.js')
const { GET } = await import('../../app/api/direction/assignment-requests/[id]/route.ts')
for (denied of [401, 403, 0]) {
  authorized = false
  const response = await GET(new NextRequest('https://fixture.example.invalid/api/direction/assignment-requests/fixture-request'),
    { params: Promise.resolve({ id: 'fixture-request' }) })
  assert.equal(response.status, denied || 200)
  if (!denied) {
    const expected = { linkedClients: 4, serviceTaken: 1, serviceNotTaken: 1, pending: 2 }
    assert.deepEqual(await response.json(), { ...expected, summary: expected })
  }
}
assert.equal(privateReads, 1)
