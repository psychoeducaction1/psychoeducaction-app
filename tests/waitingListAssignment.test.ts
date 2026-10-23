import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runWaitingListAssignmentAction } from '../lib/waitingListAssignmentActions.ts'
import { createAssignmentFromWaitingListClient } from '../lib/waitingListAssignment.ts'
import { buildServiceAppointment } from '../lib/serviceAppointment.ts'

const actorId = '10000000-0000-4000-8000-000000000001'
const clientId = '10000000-0000-4000-8000-000000000002'
const professionalId = '10000000-0000-4000-8000-000000000003'
const idempotencyKey = '10000000-0000-4000-8000-000000000004'
const processId = '10000000-0000-4000-8000-000000000005'
const body = { professionalId, idempotencyKey, outcome: 'pending' }

test('les actions d’assignation refusent identité et paramètres invalides avant accès privilégié', async () => {
  for (const action of ['assign','restore','mark_off_platform'] as const) {
    for (const status of [401,403]) {
      const result = await runWaitingListAssignmentAction(action, clientId, body, {
        authorize: async () => ({ error: 'Accès refusé fictif', status }),
        rpc: () => assert.fail('Aucun accès privilégié sans autorisation'),
      })
      assert.equal(result.status, status)
    }
  }
  for (const input of [null, [], {}, { ...body, outcome: 'active' }, { ...body, idempotencyKey: 'incorrect' },
    { ...body, professionalId: 'incorrect' }, { ...body, assignmentProcessId: 'incorrect' }]) {
    const result = await runWaitingListAssignmentAction('assign', clientId, input, {
      authorize: async () => ({ actorId }), rpc: () => assert.fail('Aucune mutation invalide'),
    })
    assert.equal(result.status, 400)
  }
})

test('le RPC reçoit seulement identifiants validés et acteur authentifié, jamais le contenu client fourni', async () => {
  for (const outcome of ['pending','service_taken']) {
    const appointment = { date: '2026-11-10', time: '14:30', modality: 'telehealth' as const }
    const result = await runWaitingListAssignmentAction('assign', clientId,
      { ...body, outcome, assignmentProcessId: processId, ...(outcome === 'service_taken' ? { appointment } : {}), p_actor_id: 'usurpé', client_name: 'Valeur ignorée' }, {
        authorize: async () => ({ actorId }),
        rpc: async (name, args) => {
          assert.equal(name, outcome === 'service_taken' ? 'create_scheduled_waiting_list_assignment' : 'create_waiting_list_assignment')
          assert.deepEqual(args, {
            p_waiting_list_client_id: clientId, p_professional_id: professionalId,
            p_outcome: outcome, p_idempotency_key: idempotencyKey,
            p_assignment_process_id: processId, p_actor_id: actorId,
            ...(outcome === 'service_taken' ? { p_appointment: buildServiceAppointment(appointment, { montreal: '', longueuil: '' }) } : {}),
          })
          return { data: { assignedClientId: 'fictif', reused: true }, error: null }
        },
      })
    assert.equal(result.status, 200)
    assert.equal('reused' in result.body && result.body.reused, true)
  }
})

test('restauration et hors plateforme utilisent la même garde transactionnelle et ne modifient pas le client en JS', async () => {
  for (const action of ['restore','mark_off_platform'] as const) {
    for (const failure of ['ACTIVE_ASSIGNMENT_EXISTS','ACTIVE_ASSIGNMENT_PROCESS','NO_ASSIGNMENT_CAPACITY','ASSIGNMENT_RETIRED']) {
      let calls = 0
      const result = await runWaitingListAssignmentAction(action, clientId, null, {
        authorize: async () => ({ actorId }),
        rpc: async (name, args) => {
          calls++
          assert.equal(name, 'transition_unassigned_waiting_list_client')
          assert.deepEqual(args, { p_waiting_list_client_id: clientId, p_action: action, p_actor_id: actorId })
          return { data: null, error: { message: failure } }
        },
      })
      assert.equal(result.status, 409)
      assert.equal(calls, 1)
    }
  }
})

test('une migration absente échoue explicitement sans fallback et une erreur interne ne fuit pas', async () => {
  for (const failure of [
    { message: 'fonction indisponible', code: 'PGRST202' },
    { message: 'fonction indisponible', code: '42883' },
    { message: 'FAUX_RENSEIGNEMENT_PRIVE', code: 'XX000' },
  ]) {
    const result = await runWaitingListAssignmentAction('assign', clientId, body, {
      authorize: async () => ({ actorId }), rpc: async () => ({ data: null, error: failure }),
    })
    assert.equal(result.status, failure.code === 'XX000' ? 500 : 503)
    assert.doesNotMatch(JSON.stringify(result.body), /FAUX_RENSEIGNEMENT_PRIVE/)
  }
})

test('le client conserve la même clé après réponse perdue et transmet uniquement les identifiants', async () => {
  const originalFetch = globalThis.fetch
  const calls: Record<string, unknown>[] = []
  const sessionClient = {
    auth: { getSession: async () => ({ data: { session: { user: { id: actorId }, access_token: 'fixture-token' } } }) },
    from: () => assert.fail('Aucune mutation directe depuis le navigateur'),
  } as unknown as SupabaseClient
  const client = { id: clientId, client_name: 'Nom périmé fictif', first_requester_name: null,
    second_requester_name: null, contact_email: null, contact_phone: null,
    consultation_reason: 'Motif périmé fictif', meeting_modality: null, city: null }
  const payload = { assignedClientId: 'assignment-fictif', assignmentRequest: { id: 'request-fictif' },
    assignedAt: '2026-10-17T12:00:00Z', requesterName: null,
    updatedClient: { id: clientId, client_name: 'Nom frais fictif', status: 'assigned' }, reused: true }
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, `/api/direction/waiting-list-clients/${clientId}/assign`)
      assert.equal(init?.cache, 'no-store')
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-token')
      calls.push(JSON.parse(String(init?.body)))
      if (calls.length === 1) throw new Error('Réponse perdue fictive')
      return Response.json(payload)
    }
    const args = { supabase: sessionClient, client, professionalId }
    await assert.rejects(createAssignmentFromWaitingListClient(args), /Réponse perdue fictive/)
    assert.deepEqual(await createAssignmentFromWaitingListClient(args), payload)
    assert.deepEqual(calls[0], calls[1])
    assert.deepEqual(Object.keys(calls[0]).sort(), ['idempotencyKey','outcome','professionalId'])
    assert.match(String(calls[0].idempotencyKey), /^[0-9a-f-]{36}$/)
    await createAssignmentFromWaitingListClient(args)
    assert.notEqual(calls[2].idempotencyKey, calls[1].idempotencyKey)
  } finally { globalThis.fetch = originalFetch }
})

test('la vraie API assigner/reclasser refuse les comptes interdits avant le client privilégié', () => {
  const result = spawnSync(process.execPath, [
    '--import', new URL('./register-aliases.mjs', import.meta.url).href,
    '--experimental-strip-types', fileURLToPath(new URL('./helpers/waitingListAssignmentRoutes.mjs', import.meta.url)),
  ], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
})

test('un refus explicite peut être corrigé avant une nouvelle action volontaire sans réessai automatique', async () => {
  const originalFetch = globalThis.fetch
  const calls: Record<string, unknown>[] = []
  const sessionClient = { auth: { getSession: async () => ({ data: { session: {
    user: { id: actorId }, access_token: 'fixture-token',
  } } }) } } as unknown as SupabaseClient
  const client = { id: processId, client_name: null, first_requester_name: null, second_requester_name: null,
    contact_email: null, contact_phone: null, consultation_reason: null, meeting_modality: null, city: null }
  try {
    globalThis.fetch = async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)))
      return calls.length === 1 ? Response.json({ error: 'Refus fictif' }, { status: 409 })
        : Response.json({ assignedClientId: 'fictif', assignmentRequest: { id: 'fictif' }, updatedClient: {} })
    }
    const args = { supabase: sessionClient, client, professionalId }
    await assert.rejects(createAssignmentFromWaitingListClient(args), /Refus fictif/)
    assert.equal(calls.length, 1)
    await createAssignmentFromWaitingListClient(args)
    assert.notEqual(calls[0].idempotencyKey, calls[1].idempotencyKey)
  } finally { globalThis.fetch = originalFetch }
})
