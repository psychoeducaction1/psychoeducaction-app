import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLocalTestDatabaseUrl } from '../scripts/test-local-database.mjs'

test('les tests SQL refusent toute adresse distante avant de lancer psql et ne montrent aucun secret', () => {
  for (const url of [
    'postgresql://fixture:never-print-this@example.invalid:5432/postgres',
    'postgresql://fixture:never-print-this@127.0.0.1:5432/postgres?host=example.invalid',
    'postgresql://fixture:never-print-this@127.0.0.1:5432/host%3Dexample.invalid',
    'postgresql://fixture:never-print-this@127.0.0.1:5432/postgresql%3A%2F%2Fexample.invalid',
    'https://fixture:never-print-this@localhost/database',
  ]) {
    assert.throws(() => parseLocalTestDatabaseUrl(url), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /No connection was attempted/)
      assert.doesNotMatch(error.message, /never-print-this/)
      return true
    })
  }
})

test('les tests SQL sans configuration ne reutilisent pas les acces Supabase de l application', () => {
  assert.throws(() => parseLocalTestDatabaseUrl(''), /No connection was attempted/)
  assert.equal(parseLocalTestDatabaseUrl(
    'postgresql://fixture:local-password@127.0.0.1:54322/fixture'
  ).hostname, '127.0.0.1')
})
