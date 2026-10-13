// Vraie route, dépendances isolées dans ce processus, sans réseau ni courriel.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createSupabaseStub } from './supabaseStub.ts'

let current
globalThis.fetch = async () => assert.fail('Aucun accès réseau dans ce test')
globalThis.__transferAuthorize = async () => {
  current.authorized = true
  return current.denied
    ? { error: { status: current.denied, message: 'Interdit' } }
    : { context: { user: { id: 'fixture-direction' }, profile: { role: 'direction', full_name: 'Direction fictive' } } }
}
globalThis.__transferAdmin = () => {
  assert.ok(current.authorized && !current.denied, 'Accès privilégié avant autorisation')
  current.privateAccess++
  return { ...current.stub.client, rpc: async (name, args) => {
    current.rpc.push({ name, args })
    return { data: { success: true, waitingListClientId: 'new-fixture' }, error: null }
  } }
}
const moduleUrl = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/directionServer') return {
    url: moduleUrl('export const getDirectionContext = globalThis.__transferAuthorize'), shortCircuit: true,
  }
  if (specifier === '@/lib/supabaseAdmin') return {
    url: moduleUrl('export const getSupabaseAdmin = globalThis.__transferAdmin'), shortCircuit: true,
  }
  if (specifier === 'next/server') return nextResolve('next/server.js', context)
  return nextResolve(specifier, context)
} })
const { NextRequest } = await import('next/server.js')
const { POST } = await import('../../app/api/direction/prospects/[id]/transfer/route.ts')
const prospect = { id: 'fixture-prospect', first_name: 'Camille', last_name: 'Fictive',
  birth_date: '1990-01-01', email: 'fixture@example.invalid', phone: '+1 (514) 555-0100',
  requester_names: ['Requérant fictif'], service_address: 'Adresse fictive',
  service_city: 'Ville fictive', service_postal_code: 'H0H 0H0',
  modalities: ['Visioconférence'], waiting_list_client_id: null,
  consultation_reason: 'Motif fictif',
}
const existing = { id: 'fixture-client', client_name: 'Camille Fictive',
  birth_date: prospect.birth_date, service_requested: 'Psychoéducation',
  contact_email: prospect.email, contact_phone: '5145550100',
  first_requester_name: prospect.requester_names[0],
  city: 'Adresse fictive, Ville fictive, H0H 0H0', meeting_modality: prospect.modalities,
  consultation_reason: prospect.consultation_reason,
}
for (const scenario of [
  { status: 409 },
  { status: 200, reason: 'Nouveau motif fictif' },
  { status: 200, client: { birth_date: '2000-01-01' } },
  { status: 200, client: { contact_email: 'other@example.invalid' } },
  { status: 200, client: { first_requester_name: 'Autre requérant fictif' } },
  { status: 200, client: { city: 'Autre adresse fictive' } },
  { status: 200, client: { meeting_modality: ['Présentiel'] } },
  { status: 200, linked: true },
  { status: 400, reason: ' ' },
  { status: 401, denied: 401 }, { status: 403, denied: 403 },
  { status: 500, readFailure: true },
]) {
  current = { authorized: false, privateAccess: 0, rpc: [], denied: scenario.denied,
    stub: createSupabaseStub({
      public_intake_prospects: [{ ...prospect, waiting_list_client_id: scenario.linked ? existing.id : null }],
      waiting_list_clients: [{ ...existing, ...scenario.client }],
    }, scenario.readFailure ? { 'waiting_list_clients:select': 'Lecture fictive impossible' } : {}),
  }
  const reason = scenario.reason ?? prospect.consultation_reason
  const response = await POST(new NextRequest('https://fixture.example.invalid/api/direction/prospects/fixture-prospect/transfer', {
    method: 'POST', body: JSON.stringify({ priorityLevel: 'normal', consultationReason: reason }),
  }), { params: Promise.resolve({ id: prospect.id }) })
  assert.equal(response.status, scenario.status, JSON.stringify(scenario))
  assert.equal(current.rpc.length, scenario.status === 200 ? 1 : 0)
  if (scenario.status === 200) {
    assert.equal(current.stub.rows('public_intake_prospects')[0].consultation_reason, reason)
    assert.deepEqual(current.rpc[0], { name: 'transfer_prospect_to_waiting_list', args: {
      p_prospect_id: prospect.id, p_priority_level: 'normal', p_actor_id: 'fixture-direction', p_actor_name: 'Direction fictive',
    } })
  } else {
    assert.deepEqual(current.stub.rows('public_intake_prospects')[0].consultation_reason, prospect.consultation_reason)
  }
  if (scenario.denied || scenario.status === 400) assert.equal(current.privateAccess, 0)
}
