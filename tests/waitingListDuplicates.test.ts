import assert from 'node:assert/strict'
import test from 'node:test'
import { createWaitingListClient, findWaitingListDuplicates } from '../lib/waitingListDuplicates.ts'
import { createSupabaseStub } from './helpers/supabaseStub.ts'

const client = {
  id: 'client-fixture', client_name: 'Camille Fictive', birth_date: '1990-01-01',
  contact_email: 'fixture@example.invalid', contact_phone: '5145550100',
  status: 'waiting', consultation_reason: 'Motif fictif original', internal_notes: 'Notes fictives originales',
  service_requested: 'Psychoéducation',
  first_requester_name: 'Requérante fictive', second_requester_name: null,
  city: 'Ville fictive', meeting_modality: ['Visioconférence', 'Présentiel'],
  availability: 'Le matin',
}

test('une demande identique est détectée malgré la casse, les espaces et le format des contacts', () => {
  assert.deepEqual(findWaitingListDuplicates({
    ...client, client_name: ' CAMILLE   Fictive ', contact_phone: '+1 (514) 555-0100',
    contact_email: null, contact_emails: [' FIXTURE@example.invalid ', 'fixture@example.invalid'],
    consultation_reason: '  MOTIF fictif\noriginal ',
    meeting_modality: ['Présentiel', 'Visioconférence', 'Visioconférence'],
  }, [client]), [client])
})

test('les homonymes avec un renseignement différent peuvent être créés même avec un contact commun', async () => {
  for (const difference of [
    { client_name: 'Autre Fictive' }, { birth_date: '2000-01-01' }, { birth_date: null },
    { consultation_reason: 'Autre motif fictif' }, { service_requested: 'Psychothérapie' },
    { contact_email: 'other@example.invalid' }, { contact_phone: '5145550111' },
    { contact_emails: ['other@example.invalid'] }, { contact_phones: ['5145550111'] },
    { first_requester_name: 'Autre requérant fictif' }, { second_requester_name: 'Deuxième fictif' },
    { city: 'Autre ville fictive' }, { meeting_modality: ['Présentiel'] },
    { availability: 'Le soir' }, { internal_notes: 'Autres notes fictives' },
  ]) {
    const candidate = { ...client, ...difference, id: 'new-fixture' }
    const stub = createSupabaseStub({ waiting_list_clients: [client] })
    const result = await createWaitingListClient(stub.client, candidate)
    assert.equal(result.created, true, JSON.stringify(difference))
    assert.equal(stub.rows('waiting_list_clients').length, 2)
    assert.deepEqual(stub.rows('waiting_list_clients')[0], client)
  }
})

test('un nom ou des champs absents ne suffisent pas à identifier un doublon', () => {
  for (const candidate of [
    { client_name: client.client_name },
    { client_name: client.client_name, contact_phone: client.contact_phone },
    { ...client, consultation_reason: null },
    { ...client, birth_date: null, contact_email: null, contact_phone: null },
  ]) assert.deepEqual(findWaitingListDuplicates(candidate, [candidate]), [])
  assert.deepEqual(findWaitingListDuplicates({ ...client, birth_date: null }, [{ ...client, birth_date: null }]), [{ ...client, birth_date: null }])
})

test('une demande identique ouvre la fiche conservée sans modifier son historique ou ses notes', async () => {
  const stub = createSupabaseStub({ waiting_list_clients: [client] })
  const result = await createWaitingListClient(stub.client, {
    ...client, status: 'waiting', priority_level: 'urgent', contact_date: '2026-10-13',
  })
  assert.equal(result.created, false)
  assert.deepEqual(stub.rows('waiting_list_clients'), [client])
})

test('le téléphone familial partagé ne confond pas deux demandes et tous les contacts sont comparés', () => {
  const candidate = { ...client, contact_emails: ['family@example.invalid'], contact_phones: ['5145550111'] }
  assert.deepEqual(findWaitingListDuplicates(candidate, [client]), [])
  assert.deepEqual(findWaitingListDuplicates({ ...client, client_name: 'Camille-Fictive' }, [client]), [])
  assert.deepEqual(findWaitingListDuplicates(candidate, [{ ...candidate,
    contact_email: ' FAMILY@example.invalid ', contact_emails: [client.contact_email],
    contact_phone: '5145550111', contact_phones: ['+1 (514) 555-0100'],
  }]).length, 1)
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
