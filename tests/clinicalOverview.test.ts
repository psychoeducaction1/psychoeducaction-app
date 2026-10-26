import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { buildClinicalDashboard, type ClinicalOverviewData } from '../lib/clinicalOverview.ts'

test('dashboard de consultation : demande active prioritaire, refus sans place occupée, service pris confirmé seulement', () => {
  const data = {
    professionals: [{ id: 'p', full_name: 'Professionnelle fictive' }, { id: 'q', full_name: null }],
    requests: [
      { id: 'old', professional_id: 'p', is_active: false, requested_count: 8, accepted_count: 0, occupied_count: 0, created_at: '2026-10-26', request_comment: 'Historique' },
      { id: 'active', professional_id: 'p', is_active: true, requested_count: 4, accepted_count: 1, occupied_count: 2, created_at: '2026-10-25', request_comment: 'Enfants' },
    ],
    assignmentStats: [{ professional_id: 'p', active_count: 1, pending_count: 1, refused_count: 2 }],
  } as ClinicalOverviewData
  const [row, empty] = buildClinicalDashboard(data)
  assert.deepEqual([row.requested, row.remaining, row.active, row.pending, row.refused, row.comment], [4, 2, 1, 1, 2, 'Enfants'])
  assert.equal(empty.status, 'Aucune demande active')
  data.requests![1].is_active = false
  assert.equal(buildClinicalDashboard(data)[0].remaining, 0)
  data.requests![1].accepted_count = 4
  assert.equal(buildClinicalDashboard(data)[0].status, 'Complétée')
})

test('API de consultation : identité, appartenance explicite, panne et vues bornées avant RPC', () => {
  const r = spawnSync(process.execPath, ['--import', './tests/register-aliases.mjs', '--experimental-strip-types', 'tests/helpers/clinicalOverviewRoutes.mjs'], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
})

test('les vrais composants direction partagés rendent la consultation complète sans action pour Ève', () => {
  const r = spawnSync(process.execPath, ['--import', './tests/register-aliases.mjs', '--experimental-strip-types', 'tests/helpers/directionReadonlyRender.mjs'], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
})
