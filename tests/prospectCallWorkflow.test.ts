import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDailyProspectQueue, historyStatuses, splitProspectAppointments, type DailyProspect, type IntakeAppointment } from '../lib/prospectsWorkspace.ts'
import { runProspectCallAction } from '../lib/prospectCallActions.ts'

const id = '00000000-0000-4000-8000-000000000001'
const actorId = '00000000-0000-4000-8000-000000000002'
const appointmentId = '00000000-0000-4000-8000-000000000003'
const key = '00000000-0000-4000-8000-000000000004'
const now = new Date('2026-10-12T14:00:00Z')
const appointment = (start_at: string, status: IntakeAppointment['status'] = 'scheduled'): IntakeAppointment => ({
  id: appointmentId, prospect_id: id, start_at, end_at: start_at, status, events: [],
})
function prospect(name: string, appointments: IntakeAppointment[] = [], overrides: Partial<DailyProspect> = {}): DailyProspect {
  return { id: name, status: 'scheduled', contact_request_type: 'scheduled_call', created_at: '2026-10-01T12:00:00Z', rapid_callback_requested_at: null, appointments, ...overrides }
}

test('la journee est celle du rendez-vous a Toronto, pas celle de reception; demain est distinct', () => {
  const rows = [prospect('today', [appointment('2026-10-12T14:30:00Z')]),
    prospect('tomorrow', [appointment('2026-10-13T14:00:00Z')]),
    prospect('yesterday-in-toronto', [appointment('2026-10-12T02:00:00Z')]),
    prospect('cancelled', [appointment('2026-10-12T17:00:00Z', 'cancelled')])]
  assert.deepEqual(buildDailyProspectQueue(rows, '2026-10-12', now).rows.map((row) => row.prospect.id), ['today'])
  assert.deepEqual(buildDailyProspectQueue(rows, '2026-10-13', now).rows.map((row) => row.prospect.id), ['tomorrow'])
})

test('les rappels rapides anciens sont prioritaires, puis le prochain appel; les heures passees restent a traiter', () => {
  const rows = [prospect('past', [appointment('2026-10-12T13:00:00Z')]),
    prospect('later', [appointment('2026-10-12T17:00:00Z')]),
    prospect('next', [appointment('2026-10-12T14:30:00Z')]),
    prospect('rapid-new', [], { status: 'callback_requested', contact_request_type: 'rapid_callback', rapid_callback_requested_at: '2026-10-12T13:00:00Z' }),
    prospect('rapid-old', [], { status: 'callback_requested', contact_request_type: 'rapid_callback', rapid_callback_requested_at: '2026-10-09T13:00:00Z' })]
  const result = buildDailyProspectQueue(rows, '2026-10-12', now)
  assert.deepEqual(result.rows.map((row) => row.prospect.id), ['rapid-old', 'rapid-new', 'next', 'later', 'past'])
  assert.equal(result.priority?.prospect.id, 'rapid-old')
  assert.equal(result.nextScheduled?.prospect.id, 'next')
  assert.equal(buildDailyProspectQueue(rows.slice(0, 3), '2026-10-12', now).priority?.prospect.id, 'next')
  assert.deepEqual(rows.map((row) => row.id), ['past', 'later', 'next', 'rapid-new', 'rapid-old'])
})

test('les resultats traites quittent la file; un rappel planifie pour demain ne remonte pas comme rapide aujourd hui', () => {
  for (const status of ['other', 'service_not_taken', 'service_taken', 'transferred_to_waiting_list'] as const) {
    assert.ok(historyStatuses.has(status))
    assert.equal(buildDailyProspectQueue([prospect(id, [], { status, contact_request_type: 'rapid_callback' })], '2026-10-12', now).rows.length, 0)
  }
  const planned = prospect('planned-rapid', [appointment('2026-10-13T14:00:00Z')], { contact_request_type: 'rapid_callback' })
  assert.equal(buildDailyProspectQueue([planned], '2026-10-12', now).rows.length, 0)
  assert.equal(buildDailyProspectQueue([planned], '2026-10-13', now).rows[0].isRapid, false)
  assert.equal(buildDailyProspectQueue([], '2026-10-12', now).priority, null)
})

test('la fiche ouvre le rendez-vous clique plutot qu un autre rendez-vous de ce prospect', () => {
  const first = { ...appointment('2026-10-12T14:30:00Z'), id: 'first' }
  const later = { ...appointment('2026-10-13T14:30:00Z'), id: 'later' }
  const result = splitProspectAppointments([first, later], 'first')
  assert.equal(result.primary, first)
  assert.deepEqual(result.others, [later])
})

test('les actions d appel verifient identite et role avant tout acces privilegie', async () => {
  for (const action of ['outcome', 'followup'] as const) {
    for (const status of [401, 403]) {
      const result = await runProspectCallAction(action, id, {}, {
        authorize: async () => ({ error: 'Interdit', status }),
        rpc: async () => { assert.fail('Acces privilegie non autorise') },
      }, now)
      assert.equal(result.status, status)
    }
  }
})

test('un nouveau rendez-vous exige precision, heure valide et cle idempotente, sans envoyer de courriel', async () => {
  const valid = { outcomeReason: 'Suivi fictif', appointmentId, startAt: '2026-10-12T17:00:00Z', idempotencyKey: key }
  for (const body of [null, { ...valid, outcomeReason: ' ' }, { ...valid, appointmentId: 'bad' },
    { ...valid, idempotencyKey: 'bad' }, { ...valid, startAt: 'invalid' },
    { ...valid, startAt: '2026-10-12T15:00:00Z' }, { ...valid, startAt: '2026-10-12T17:15:00Z' },
    { ...valid, startAt: '2026-10-12T17:00:30Z' }, { ...valid, startAt: '2026-10-18T17:00:00Z' }]) {
    const result = await runProspectCallAction('followup', id, body, {
      authorize: async () => ({ actorId }), rpc: async () => { assert.fail('Entree invalide transmise au RPC') },
    }, now)
    assert.equal(result.status, 400)
  }
  let observed: unknown
  const result = await runProspectCallAction('followup', id, { ...valid, actorId: 'untrusted', email: 'fixture@example.invalid' }, {
    authorize: async () => ({ actorId }), rpc: async (name, args) => { observed = [name, args]; return { data: { success: true }, error: null } },
  }, now)
  assert.equal(result.status, 200)
  assert.deepEqual(observed, ['create_prospect_followup_appointment', {
    p_prospect_id: id, p_actor_id: actorId, p_outcome_reason: valid.outcomeReason, p_current_appointment_id: appointmentId,
    p_start_at: '2026-10-12T17:00:00.000Z', p_end_at: '2026-10-12T17:15:00.000Z', p_buffer_end_at: '2026-10-12T17:30:00.000Z', p_idempotency_key: key,
  }])
})

test('le resultat est transmis au RPC avec une precision et le rendez-vous de la meme fiche', async () => {
  let observed: unknown
  const result = await runProspectCallAction('outcome', id, { status: 'other', outcomeReason: '  Precision fictive  ', appointmentId }, {
    authorize: async () => ({ actorId }), rpc: async (name, args) => { observed = [name, args]; return { data: { success: true }, error: null } },
  })
  assert.equal(result.status, 200)
  assert.deepEqual(observed, ['record_prospect_call_outcome', { p_prospect_id: id, p_actor_id: actorId,
    p_outcome_reason: 'Precision fictive', p_current_appointment_id: appointmentId, p_status: 'other' }])
  const invalid = await runProspectCallAction('outcome', id, { status: 'service_taken', outcomeReason: 'Fictif' }, {
    authorize: async () => ({ actorId }), rpc: async () => { assert.fail('Le service pris doit passer par le transfert existant') },
  })
  assert.equal(invalid.status, 400)
})

test('les conflits et dossiers transferes sont refuses sans fuite du message interne', async () => {
  for (const [message, status] of [['SLOT_UNAVAILABLE', 409], ['APPOINTMENT_MISMATCH', 409], ['IDEMPOTENCY_CONFLICT', 409], ['PROSPECT_ALREADY_TRANSFERRED', 409], ['PROSPECT_NOT_FOUND', 404], ['DIRECTION_REQUIRED', 403], ['fixture-internal-detail', 500]] as const) {
    const result = await runProspectCallAction('outcome', id, { status: 'other', outcomeReason: 'Fictif' }, {
      authorize: async () => ({ actorId }), rpc: async () => ({ data: null, error: { message } }),
    })
    assert.equal(result.status, status)
    assert.doesNotMatch(JSON.stringify(result.body), /fixture-internal-detail/)
  }
})
