import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildClosureReason,
  getAssignedClientStatus,
  getAssignmentRequestMetrics,
  getFieldsForAssignedClientStatus,
  getNonServiceReasonError,
  getServiceTakenCount,
  getUsedAssignmentCount,
  logAssignedClientStatusChange,
  type AssignedClientStatus,
} from '../app/professionnel/shared.ts'
import {
  createAssignmentFromWaitingListClient,
  getFreshActiveAssignmentRequest,
  type AssignableWaitingListClient,
} from '../lib/waitingListAssignment.ts'
import { createSupabaseStub } from './helpers/supabaseStub.ts'

const request = {
  id: 'request-test', professional_id: 'professional-test', is_active: true,
  requested_count: 2, assigned_count: 99, remaining_count: 99,
  created_at: '2026-01-01T12:00:00Z',
}
const client: AssignableWaitingListClient = {
  id: 'waiting-test', client_name: 'Client Fictif',
  first_requester_name: 'Requerant Fictif', second_requester_name: null,
  contact_email: 'client@example.invalid', contact_phone: '5145550100',
  contact_emails: [' client@example.invalid '], contact_phones: [],
  consultation_reason: 'Demande fictive', meeting_modality: ['Visioconference'], city: null,
}

test('les quatre statuts se convertissent sans perdre le service pris ou refuse', () => {
  for (const status of ['not_contacted', 'pending', 'taken', 'not_taken'] as AssignedClientStatus[]) {
    assert.equal(getAssignedClientStatus(getFieldsForAssignedClientStatus(status)), status)
  }
  assert.equal(getAssignedClientStatus({ contacted: false, is_active: true }), 'taken')
  assert.equal(getAssignedClientStatus({ contacted: false, is_active: false }), 'not_taken')
})

test('une place en attente occupe la demande sans la completer', () => {
  const clients = [{ is_active: true }, { is_active: null }, { is_active: false }]
  assert.equal(getUsedAssignmentCount(clients), 2)
  assert.equal(getServiceTakenCount(clients), 1)
  assert.deepEqual(getAssignmentRequestMetrics({
    isActive: true, requestedCount: 2, acceptedCount: 1, occupiedCount: 2,
  }), {
    requestedCount: 2, acceptedCount: 1, occupiedCount: 2, remainingCount: 0,
    state: 'active', isActive: true, isCompleted: false,
  })
  assert.equal(getAssignmentRequestMetrics({
    isActive: true, requestedCount: 2, acceptedCount: 2, occupiedCount: 3,
  }).state, 'completed')
})

test('les compteurs incoherents ne produisent jamais de places negatives', () => {
  const completed = getAssignmentRequestMetrics({
    isActive: false, requestedCount: 1, acceptedCount: 3, occupiedCount: 4,
  })
  assert.equal(completed.remainingCount, 0)
  assert.equal(completed.isCompleted, true)
  const empty = getAssignmentRequestMetrics({
    isActive: false, requestedCount: null, acceptedCount: -1, remainingCount: -2,
  })
  assert.equal(empty.state, 'inactive')
  assert.equal(empty.remainingCount, 0)
})

test('un refus exige un motif et Autre exige une precision', () => {
  assert.notEqual(getNonServiceReasonError(null), '')
  assert.notEqual(getNonServiceReasonError('Autre'), '')
  assert.notEqual(getNonServiceReasonError('Autre :   '), '')
  const reason = buildClosureReason('Autre', '  Situation fictive  ')
  assert.equal(reason, 'Autre : Situation fictive')
  assert.equal(getNonServiceReasonError(reason), '')
})

test('le choix de demande recalcule les places et ignore les assignations annulees', async () => {
  const stub = createSupabaseStub({
    assignment_requests: [{ ...request, requested_count: 4 }],
    assigned_clients: [
      { assignment_request_id: request.id, is_active: true, canceled_at: null },
      { assignment_request_id: request.id, is_active: null, canceled_at: null },
      { assignment_request_id: request.id, is_active: false, canceled_at: null },
      { assignment_request_id: request.id, is_active: true, canceled_at: '2026-01-01' },
    ],
  })
  const fresh = await getFreshActiveAssignmentRequest(stub.client, request.professional_id)
  assert.equal(fresh?.assigned_count, 1)
  assert.equal(fresh?.occupied_count, 2)
  assert.equal(fresh?.remaining_count, 2)
})

test('une demande entierement occupee par des attentes ne permet pas une nouvelle assignation', async () => {
  const stub = createSupabaseStub({
    assignment_requests: [request],
    assigned_clients: [
      { assignment_request_id: request.id, is_active: null, canceled_at: null },
      { assignment_request_id: request.id, is_active: null, canceled_at: null },
    ],
    waiting_list_clients: [{ ...client, status: 'waiting' }],
  })
  await assert.rejects(createAssignmentFromWaitingListClient({
    supabase: stub.client, client, professionalId: request.professional_id,
  }), /aucune demande active/)
  assert.equal(stub.rows('assigned_clients').length, 2)
  assert.equal(stub.rows('waiting_list_clients')[0].status, 'waiting')
})

test('une assignation en attente lie le dossier et reserve exactement une place', async () => {
  const stub = createSupabaseStub({
    assignment_requests: [request], assigned_clients: [],
    waiting_list_clients: [{ ...client, status: 'waiting' }],
  })
  const result = await createAssignmentFromWaitingListClient({
    supabase: stub.client, client, professionalId: request.professional_id,
  })
  const assigned = stub.rows('assigned_clients')[0]
  assert.equal(assigned.id, result.assignedClientId)
  assert.equal(assigned.waiting_list_client_id, client.id)
  assert.equal(assigned.assignment_request_id, request.id)
  assert.equal(assigned.is_active, null)
  assert.equal(assigned.contacted, false)
  assert.equal(assigned.email, 'client@example.invalid')
  assert.equal(stub.rows('assignment_requests')[0].remaining_count, 1)
  assert.equal(stub.rows('assignment_requests')[0].assigned_count, 0)
  assert.equal(stub.rows('waiting_list_clients')[0].status, 'assigned')
})

test('le service pris direct complete la derniere place sans attendre le professionnel', async () => {
  const stub = createSupabaseStub({
    assignment_requests: [{ ...request, requested_count: 1 }], assigned_clients: [],
    waiting_list_clients: [{ ...client, status: 'waiting' }],
  })
  await createAssignmentFromWaitingListClient({
    supabase: stub.client, client, professionalId: request.professional_id, outcome: 'service_taken',
  })
  assert.equal(stub.rows('assigned_clients')[0].is_active, true)
  assert.equal(stub.rows('assigned_clients')[0].contacted, true)
  assert.equal(stub.rows('assignment_requests')[0].assigned_count, 1)
  assert.equal(stub.rows('assignment_requests')[0].remaining_count, 0)
  assert.equal(stub.rows('assignment_requests')[0].is_active, false)
})

test('un echec de creation ne marque pas la fiche source comme assignee', async () => {
  const stub = createSupabaseStub({
    assignment_requests: [request], assigned_clients: [],
    waiting_list_clients: [{ ...client, status: 'waiting' }],
  }, { 'assigned_clients:insert': 'fixture insert failure' })
  await assert.rejects(createAssignmentFromWaitingListClient({
    supabase: stub.client, client, professionalId: request.professional_id,
  }), { message: 'fixture insert failure' })
  assert.equal(stub.rows('assigned_clients').length, 0)
  assert.equal(stub.rows('waiting_list_clients')[0].status, 'waiting')
})

test('un statut inchange ne cree pas un second evenement dans son historique', async () => {
  const stub = createSupabaseStub({ assigned_client_status_history: [] })
  const actor = { id: 'actor-test', role: 'direction', name: 'Direction fictive' }
  await logAssignedClientStatusChange({
    supabase: stub.client, assignedClientId: 'assignment-test',
    previousStatus: true, newStatus: true, actor,
  })
  assert.equal(stub.rows('assigned_client_status_history').length, 0)
  await logAssignedClientStatusChange({
    supabase: stub.client, assignedClientId: 'assignment-test',
    previousStatus: null, newStatus: true, actor,
  })
  assert.equal(stub.rows('assigned_client_status_history').length, 1)
  assert.equal(stub.rows('assigned_client_status_history')[0].new_status, true)
})
