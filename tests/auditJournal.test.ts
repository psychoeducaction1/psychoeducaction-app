import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { excludeSatisfactionAuditEvents, isVisibleInAuditJournal } from '../lib/auditJournal.ts'

test('le journal masque les événements Satisfaction actuels et futurs sans masquer les autres actions ou les valeurs nulles', () => {
  for (const action of ['satisfaction_import_created', 'satisfaction_email_sent', 'satisfaction_email_failed',
    'satisfaction_eligible_updated', 'satisfaction_future_eligibles_restored', 'satisfaction_new_event']) {
    assert.equal(isVisibleInAuditJournal({ action, entity_type: null }), false)
  }
  for (const entity_type of ['satisfaction_import', 'satisfaction_eligible']) {
    assert.equal(isVisibleInAuditJournal({ action: null, entity_type }), false)
    assert.equal(isVisibleInAuditJournal({ action: 'legacy_event', entity_type }), false)
  }
  for (const row of [
    { action: null, entity_type: null }, { action: 'assignment_created', entity_type: 'assigned_client' },
    { action: 'client_notification_sent', entity_type: null }, { action: null, entity_type: 'waiting_list_client' },
    { action: 'satisfactionXlegacy', entity_type: 'another_module' }, { action: 'other_event', entity_type: 'another_module' },
  ]) assert.equal(isVisibleInAuditJournal(row), true)
})

test('la vraie requête Supabase combine les deux exclusions avant sa limite et conserve les anciennes valeurs NULL', async () => {
  let called = false
  const client = createClient('https://fixture.example.invalid', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      called = true
      const url = new URL(String(input))
      const filters = url.searchParams.getAll('or')
      assert.equal(filters.length, 2, 'Aucune des deux exclusions ne doit écraser l’autre')
      assert.ok(filters[0].includes('action.is.null'))
      assert.ok(filters[0].includes('action.not.like.satisfaction\\_%'), 'Le soulignement doit rester littéral')
      assert.ok(filters[1].includes('entity_type.is.null'))
      assert.ok(filters[1].includes('entity_type.not.in.(satisfaction_import,satisfaction_eligible)'))
      assert.equal(url.searchParams.get('limit'), '500')
      assert.equal(url.searchParams.get('order'), 'created_at.desc')
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
    } },
  })
  const { error } = await excludeSatisfactionAuditEvents(client.from('audit_logs').select('id,action,entity_type'))
    .order('created_at', { ascending: false }).limit(500)
  assert.equal(error, null)
  assert.equal(called, true)
})
