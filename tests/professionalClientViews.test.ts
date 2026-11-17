import assert from 'node:assert/strict'
import test from 'node:test'
import type { AdmissionAssignment } from '../lib/clinical-admission/types.ts'
import type { ClientAdminProjection, ClinicalRecordSummary, WorkspaceView } from '../lib/clinical-core/types.ts'
import { professionalClientViewRows } from '../lib/clinical-admission/professionalClients.ts'

const professionalId = 'professional-fictional'
const workspace = (clients: ClientAdminProjection[] = [], records: ClinicalRecordSummary[] = []): WorkspaceView => ({ context: 'clinical', clients, records, managedRecords: [] } as unknown as WorkspaceView)
const assignment = (id: string, outcome: AdmissionAssignment['outcome'], extra: Partial<AdmissionAssignment> = {}): AdmissionAssignment => ({ id, professionalId, clientId: id, episodeId: null, status: 'active', outcome, canceledAt: null, clientSnapshot: { firstName: 'Client fictif', lastName: id }, ...extra } as AdmissionAssignment)
const client = (id: string): ClientAdminProjection => ({ id, firstName: 'Client fictif', lastName: id, assignments: [{ professionalId, status: 'active' }] } as ClientAdminProjection)
const record = (clientId: string, status: 'open' | 'closed', canRead = true): ClinicalRecordSummary => ({ clientId, episodeId: 'episode-fictional', status, members: [{ actorId: professionalId, canRead }] } as ClinicalRecordSummary)

test('vues : seuls les contacts à traiter restent dans les assignations, sans mutation ni autre professionnel', () => {
  const data = [assignment('new', 'not_contacted'), assignment('waiting', 'pending'), assignment('active', 'taken'), assignment('refused', 'not_taken'), assignment('cancelled', 'pending', { canceledAt: '2026-11-16T12:00:00Z' }), assignment('closed', 'taken', { status: 'closed' }), assignment('other', 'not_contacted', { professionalId: 'other-professional' })]
  const ws = workspace(data.map(item => client(item.clientId!)))
  const original = JSON.stringify({ ws, data })
  const pending = professionalClientViewRows(ws, data, professionalId, 'assignments')
  assert.deepEqual(pending.map(row => row.key), ['new', 'waiting'])
  const clients = professionalClientViewRows(workspace(), data, professionalId, 'clients')
  assert.deepEqual(clients.map(row => row.key).sort(), ['active', 'cancelled', 'closed', 'refused'])
  assert.equal(clients.find(row => row.key === 'active')?.status, 'taken')
  assert.ok(clients.filter(row => row.key !== 'active').every(row => row.status === 'archived'))
  assert.equal(JSON.stringify({ ws, data }), original)
})

test('vues : nouvelle assignation et suivi existant du même client restent visibles séparément', () => {
  const data = [assignment('new', 'not_contacted', { clientId: 'same' }), assignment('existing', 'taken', { clientId: 'same' })]
  const ws = workspace([client('same')], [record('same', 'open')])
  const pending = professionalClientViewRows(ws, data, professionalId, 'assignments')
  const clients = professionalClientViewRows(ws, data, professionalId, 'clients')
  assert.deepEqual(pending[0].assignments.map(item => item.id), ['new'])
  assert.equal(pending[0].status, 'not_contacted')
  assert.deepEqual(clients[0].assignments.map(item => item.id), ['existing'])
  assert.equal(clients[0].status, 'taken')
})

test('vues : dossiers importés conservés, dossier fermé archivé et client seulement à contacter non dupliqué', () => {
  const data = [assignment('new', 'not_contacted')]
  const ws = workspace([client('new'), client('imported'), client('closed')], [record('imported', 'open'), record('closed', 'closed')])
  const rows = professionalClientViewRows(ws, data, professionalId, 'clients')
  assert.deepEqual(rows.map(row => [row.key, row.status]), [['imported', 'taken'], ['closed', 'archived']])
  const inaccessible = workspace([client('new')], [record('new', 'open', false)])
  assert.deepEqual(professionalClientViewRows(inaccessible, data, professionalId, 'clients'), [])
})
