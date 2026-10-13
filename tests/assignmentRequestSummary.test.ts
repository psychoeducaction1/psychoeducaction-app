import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('la confirmation de suppression reçoit les vrais compteurs, conserve le contrat existant et exige le super administrateur', () => {
  const result = spawnSync(process.execPath, [
    '--import', new URL('./register-aliases.mjs', import.meta.url).href,
    '--experimental-strip-types', fileURLToPath(new URL('./helpers/assignmentRequestSummaryRoutes.mjs', import.meta.url)),
  ], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
})
