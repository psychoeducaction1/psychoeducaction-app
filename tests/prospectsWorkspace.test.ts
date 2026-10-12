import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { historyStatuses, legacyCalendarUrl, prospectCallLabel, prospectsTab, reconcileTransferredAppointment, splitProspectAppointments, type IntakeAppointment } from '../lib/prospectsWorkspace.ts'
import { runProspectTestAction } from '../lib/prospectTestActions.ts'

const id = '00000000-0000-4000-8000-000000000001'
const actorId = '00000000-0000-4000-8000-000000000002'
const appointment = (start_at: string, status: IntakeAppointment['status'] = 'scheduled'): IntakeAppointment => ({
  id, prospect_id: id, start_at, end_at: start_at, status, events: [],
})

test('un ancien rendez-vous transféré est terminé, mais l’heure seule ne termine jamais un appel', () => {
  const past = appointment('2026-10-12T13:00:00Z')
  const now = new Date('2026-10-12T19:00:00Z')
  const transferred = { status: 'transferred_to_waiting_list', waiting_list_client_id: 'fixture-client' }
  assert.equal(reconcileTransferredAppointment(past, transferred, now).status, 'completed')
  assert.equal(past.status, 'scheduled', 'Les données stockées ne sont pas modifiées par la lecture')
  for (const prospect of [null, {status: 'scheduled'}, {status: 'transferred_to_waiting_list'}]) {
    assert.equal(reconcileTransferredAppointment(past, prospect, now).status, 'scheduled')
  }
  assert.equal(reconcileTransferredAppointment(appointment('2026-10-12T20:00:00Z'), transferred, now).status, 'scheduled')
  for (const status of ['cancelled', 'no_show', 'completed'] as const) {
    assert.equal(reconcileTransferredAppointment({...past, status}, transferred, now).status, status)
  }
})

test('le libelle de rendez-vous utilise son instant en heure de Toronto, independamment de la reception', () => {
  const label = prospectCallLabel({ contact_request_type: 'scheduled_call', created_at: '2026-10-01T12:00:00Z', appointments: [appointment('2026-10-12T14:00:00Z')] } as Parameters<typeof prospectCallLabel>[0])
  assert.match(label, /^Rendez-vous :/)
  assert.match(label, /12 oct/)
  assert.match(label, /10[ :h]+00/)
  assert.match(label, /Planifié/)
  assert.doesNotMatch(label, /1 oct/)
  const winter = prospectCallLabel({ contact_request_type: 'scheduled_call', appointments: [appointment('2026-12-12T14:00:00Z')] })
  assert.match(winter, /09?[ :h]+00/)
})

test('un rendez-vous actif prime sur les annules; sans rendez-vous un rappel est des que possible', () => {
  const rows = [appointment('2026-10-20T14:00:00Z', 'cancelled'), appointment('2026-10-12T14:00:00Z')]
  assert.match(prospectCallLabel({ contact_request_type: 'rapid_callback', appointments: rows }), /12 oct.*Planifié/)
  assert.equal(rows[0].status, 'cancelled', 'Le helper ne doit pas modifier les donnees de la fiche')
  assert.match(prospectCallLabel({ contact_request_type: 'scheduled_call', appointments: [rows[0]] }), /Annulé/)
  assert.equal(prospectCallLabel({ contact_request_type: 'rapid_callback', appointments: [] }), 'Rappel dès que possible')
  assert.equal(prospectCallLabel({ contact_request_type: 'scheduled_call', appointments: [] }), 'Aucun rendez-vous enregistré')
})

test('les anciens liens conservent leur prospect et leurs parametres et ouvrent le bon onglet', () => {
  const url = new URL(legacyCalendarUrl({ prospect: id, tab: 'history', filter: ['one', 'two'], absent: undefined }), 'https://fixture.invalid')
  assert.equal(url.pathname, '/direction/prospects')
  assert.equal(url.searchParams.get('tab'), 'calendar')
  assert.equal(url.searchParams.get('prospect'), id)
  assert.deepEqual(url.searchParams.getAll('filter'), ['one', 'two'])
  assert.equal(prospectsTab(undefined, 'transferred_to_waiting_list'), 'history')
  assert.equal(prospectsTab(undefined, 'service_not_taken'), 'history')
  assert.equal(prospectsTab('calendar', 'service_not_taken'), 'calendar')
  for (const status of ['new', 'contacted'] as const) {
    assert.equal(historyStatuses.has(status), false)
    assert.equal(prospectsTab(undefined, status), 'active')
  }
  assert.equal(prospectsTab(undefined, 'other'), 'history')
  assert.equal(prospectsTab(undefined, 'service_taken'), 'history')
})

test('la fiche isole un rendez-vous principal sans perdre les autres rendez-vous ni leur historique', () => {
  const old = { ...appointment('2026-10-01T14:00:00Z', 'cancelled'), id: 'old' }
  const current = { ...appointment('2026-10-12T14:00:00Z'), id: 'current' }
  const newerCancelled = { ...appointment('2026-10-20T14:00:00Z', 'cancelled'), id: 'newer-cancelled' }
  const rows = [old, current, newerCancelled]
  const result = splitProspectAppointments(rows)
  assert.equal(result.primary, current)
  assert.deepEqual(result.others, [newerCancelled, old])
  assert.deepEqual(rows, [old, current, newerCancelled])
  assert.equal(splitProspectAppointments([old, newerCancelled]).primary, newerCancelled)
  assert.deepEqual(splitProspectAppointments([]), { primary: null, others: [] })
})

test('marquage et suppression refusent les sessions non autorisees avant tout acces privilegie', async () => {
  for (const action of ['mark', 'delete'] as const) {
    for (const status of [401, 403]) {
      let called = false
      const result = await runProspectTestAction(action, id, { confirmed: true, isTest: true }, {
        authorize: async () => ({ error: 'Interdit', status }),
        rpc: async () => { called = true; return { data: {}, error: null } },
      })
      assert.equal(result.status, status)
      assert.equal(called, false)
    }
  }
})

test('une confirmation stricte et un UUID sont requis, le marquage exige un booleen', async () => {
  for (const [action, target, body] of [
    ['delete', id, null], ['delete', id, { confirmed: 'true' }],
    ['delete', 'invalid-id', { confirmed: true }],
    ['mark', id, { confirmed: true, isTest: 'true' }],
    ['mark', id, { isTest: true }],
  ] as const) {
    const result = await runProspectTestAction(action, target, body, {
      authorize: async () => ({ actorId }),
      rpc: async () => { assert.fail('Le RPC ne doit pas etre appele pour une entree invalide') },
    })
    assert.equal(result.status, 400)
  }
})

test('les actions transmettent seulement les arguments autorises au RPC atomique', async () => {
  for (const action of ['mark', 'delete'] as const) {
    const calls: unknown[] = []
    const result = await runProspectTestAction(action, id, { confirmed: true, isTest: false, p_actor_id: 'untrusted', waiting_list_client_id: 'untrusted' }, {
      authorize: async () => ({ actorId }),
      rpc: async (name, args) => { calls.push([name, args]); return { data: { success: true }, error: null } },
    })
    assert.equal(result.status, 200)
    assert.deepEqual(calls, [[action === 'mark' ? 'mark_intake_prospect_test' : 'delete_intake_test_prospect', {
      p_prospect_id: id, p_actor_id: actorId, ...(action === 'mark' ? { p_is_test: false } : {}),
    }]])
  }
})

test('les refus en base deviennent des erreurs explicites sans fuite de donnees', async () => {
  for (const [message, status] of [['PROSPECT_NOT_FOUND', 404], ['PROSPECT_NOT_TEST', 409], ['PROSPECT_ALREADY_TRANSFERRED', 409], ['DIRECTION_REQUIRED', 403], ['fixture-private-database-detail', 500]] as const) {
    const result = await runProspectTestAction('delete', id, { confirmed: true }, {
      authorize: async () => ({ actorId }), rpc: async () => ({ data: null, error: { message } }),
    })
    assert.equal(result.status, status)
    assert.doesNotMatch(JSON.stringify(result.body), /fixture-private-database-detail/)
  }
})

test('le contrat SQL interdit le delete direct et reserve les RPC au serveur', async () => {
  const sql = await readFile(new URL('../supabase/prospects-and-calls.sql', import.meta.url), 'utf8')
  assert.match(sql, /drop policy if exists "public_intake_prospects_direction_all"/)
  assert.doesNotMatch(sql, /create policy[\s\S]*?for delete/i)
  for (const signature of ['mark_intake_prospect_test(uuid, uuid, boolean)', 'delete_intake_test_prospect(uuid, uuid)']) {
    assert.ok(sql.includes(`revoke all on function public.${signature} from public, anon, authenticated`))
    assert.ok(sql.includes(`grant execute on function public.${signature} to service_role`))
  }
  // Contrat statique seulement; l'execution et les rollbacks sont verifies par test:db.
  assert.match(sql, /if prospect\.is_test is not true then raise exception 'PROSPECT_NOT_TEST'/)
  assert.match(sql, /prospect\.waiting_list_client_id is not null or prospect\.status = 'transferred_to_waiting_list'/)
  assert.doesNotMatch(sql, /delete from public\.waiting_list_clients/)
})
