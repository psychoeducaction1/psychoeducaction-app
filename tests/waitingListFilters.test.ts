import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getActiveAssignmentProcessClientIds,
  getWaitingListClientSections,
  hasSpecialProgramMarker,
} from '../lib/waitingListFilters.ts'

test('les dossiers assignés et classés restent consultables après une démarche', () => {
  const assignedClient = {
    id: 'assigned-fixture', status: 'assigned',
    consultation_reason: 'Motif fictif conservé', internal_notes: 'Notes fictives conservées',
  }
  const closedClient = { ...assignedClient, id: 'closed-fixture', status: 'closed' }
  const activeIds = getActiveAssignmentProcessClientIds([
    { waiting_list_client_id: assignedClient.id, status: 'assigned' },
    { waiting_list_client_id: closedClient.id, status: 'classified' },
  ])
  const sections = getWaitingListClientSections([assignedClient, closedClient], activeIds)

  assert.equal(activeIds.size, 0)
  assert.deepEqual(sections.waiting, [])
  assert.equal('assigned' in sections, false, 'Un dossier assigné ne doit pas être rendu dans deux sections')
  assert.deepEqual(sections.history, [assignedClient, closedClient])
  assert.strictEqual(sections.history[0], assignedClient)
  assert.equal(sections.history[0].consultation_reason, 'Motif fictif conservé')
  assert.equal(sections.history[0].internal_notes, 'Notes fictives conservées')
})

test('une démarche active ou rouverte reste hors des listes même avec une ancienne démarche terminée', () => {
  const client = { id: 'reopened-fixture', status: 'assignment_in_progress' }
  const activeIds = getActiveAssignmentProcessClientIds([
    { waiting_list_client_id: client.id, status: 'assigned' },
    { waiting_list_client_id: client.id, status: 'returned' },
    { waiting_list_client_id: client.id, status: 'to_contact' },
  ])

  assert.equal(activeIds.has(client.id), true)
  assert.deepEqual(getWaitingListClientSections([client], activeIds), {
    waiting: [], history: [],
  })
  // Une ancienne fiche encore marquée waiting ne doit pas pouvoir être assignée deux fois.
  assert.deepEqual(
    getWaitingListClientSections([{ ...client, status: 'waiting' }], activeIds).waiting,
    []
  )
})

test('un retour en attente réaffiche le dossier sans le conserver dans l’historique clients', () => {
  const client = { id: 'returned-fixture', status: 'waiting' }
  const activeIds = getActiveAssignmentProcessClientIds([
    { waiting_list_client_id: client.id, status: 'returned' },
  ])
  assert.deepEqual(getWaitingListClientSections([client], activeIds), {
    waiting: [client], history: [],
  })
})

test('les assignations directes et les autres dossiers historiques restent visibles', () => {
  const clients = ['waiting', 'assigned', 'active', 'closed', 'blacklisted'].map((status) => ({
    id: `${status}-fixture`, status,
  }))
  const sections = getWaitingListClientSections(clients, new Set())
  assert.deepEqual(sections.waiting, [clients[0]])
  assert.equal('assigned' in sections, false)
  assert.deepEqual(sections.history, clients.slice(1))
})

test('détecte IVAC, PAE et CNESST dans les renseignements du dossier', () => {
  assert.equal(hasSpecialProgramMarker({ internal_notes: 'Dossier IVAC' }), true)
  assert.equal(hasSpecialProgramMarker({ consultation_reason: 'Référence PAE' }), true)
  assert.equal(hasSpecialProgramMarker({ service_requested: 'Mandat CNESST' }), true)
})

test('ne masque pas un dossier ordinaire', () => {
  assert.equal(
    hasSpecialProgramMarker({
      consultation_reason: 'Soutien pour des difficultés scolaires',
      internal_notes: 'Disponibilités en soirée',
    }),
    false
  )
})
