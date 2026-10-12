import assert from 'node:assert/strict'
import test from 'node:test'
import { createWaitingListClient, findWaitingListDuplicates } from '../lib/waitingListDuplicates.ts'
import { createSupabaseStub } from './helpers/supabaseStub.ts'

const client = {
  id: 'client-fixture', client_name: 'Camille Fictive', birth_date: '1990-01-01',
  contact_email: 'fixture@example.invalid', contact_phone: '5145550100',
  status: 'waiting', consultation_reason: 'Motif fictif original', internal_notes: 'Notes fictives originales',
  service_requested: 'Psychoéducation',
}

test('un nom et un contact normalisés repèrent la fiche existante sans fusionner les familles', () => {
  assert.deepEqual(findWaitingListDuplicates({
    client_name: ' CAMILLE-Fictive ', contact_phone: '+1 (514) 555-0100',
  }, [client]), [client])
  for (const candidate of [
    { ...client, client_name: 'Autre Fictive' },
    { ...client, birth_date: '2000-01-01' },
    { ...client, service_requested: 'Psychothérapie' },
    { client_name: client.client_name },
    { ...client, contact_email: 'other@example.invalid', contact_phone: '5145550111' },
  ]) assert.deepEqual(findWaitingListDuplicates(candidate, [client]), [])
  assert.deepEqual(findWaitingListDuplicates({client_name: client.client_name,
    contact_emails: [' FIXTURE@example.invalid ']}, [client]), [client])
})

test('la création vérifie les fiches récentes et ne modifie jamais un dossier existant', async () => {
  const stub = createSupabaseStub({ waiting_list_clients: [client] })
  const result = await createWaitingListClient(stub.client, {
    ...client, consultation_reason: 'Autre demande fictive', internal_notes: 'Autres notes fictives',
  })
  assert.equal(result.created, false)
  assert.deepEqual(stub.rows('waiting_list_clients'), [client])
})

test('une nouvelle identité peut être créée, puis une nouvelle tentative ouvre la même fiche', async () => {
  const stub = createSupabaseStub({ waiting_list_clients: [] })
  const first = await createWaitingListClient(stub.client, { ...client })
  const second = await createWaitingListClient(stub.client, { ...client })
  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(first.client.id, second.client.id)
  assert.equal(stub.rows('waiting_list_clients').length, 1)
})

test('une lecture échouée bloque la création et la recherche dépasse la première page', async () => {
  const failed = createSupabaseStub({ waiting_list_clients: [] }, { 'waiting_list_clients:select': 'fixture-read-failure' })
  await assert.rejects(createWaitingListClient(failed.client, { ...client }))
  assert.equal(failed.rows('waiting_list_clients').length, 0)
  const rows = Array.from({length: 501}, (_, i) => ({ ...client,
    id: `fixture-${i}`, client_name: i === 500 ? client.client_name : `Autre ${i}`, created_at: String(i).padStart(4, '0'),
  }))
  const stub = createSupabaseStub({ waiting_list_clients: rows })
  const result = await createWaitingListClient(stub.client, { ...client })
  assert.equal(result.created, false)
  assert.equal(result.client.id, 'fixture-500')
})
