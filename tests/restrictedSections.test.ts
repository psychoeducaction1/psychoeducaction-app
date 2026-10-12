import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { SUPER_ADMIN_EMAIL } from '../lib/superAdmin.ts'

for (const identity of ['anonymous', 'assistant', 'professional', 'marketing', 'missing_profile', 'wrong_role', 'super_admin']) {
  test(`Acquisition et Satisfaction: autorisation des vraies API pour ${identity}`, () => {
    const result = spawnSync(process.execPath, [
      '--import', new URL('./register-aliases.mjs', import.meta.url).href,
      '--experimental-strip-types', fileURLToPath(new URL('./helpers/restrictedSectionsRoutes.mjs', import.meta.url)),
      identity,
    ], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
  })
}

test('les politiques Satisfaction ferment l’ancien accès direction et limitent aussi les autres politiques permissives', async () => {
  const [initial, correction] = await Promise.all([
    readFile(new URL('../supabase/satisfaction-clients.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/satisfaction-super-admin-access.sql', import.meta.url), 'utf8'),
  ])
  for (const sql of [initial, correction]) {
    assert.match(sql, /public\.is_direction\(\)[\s\S]*auth\.jwt\(\)->>'email'/)
    assert.ok(sql.includes(`= '${SUPER_ADMIN_EMAIL}'`))
    for (const table of ['satisfaction_imports', 'satisfaction_eligibles', 'satisfaction_envois', 'satisfaction_desabonnes', 'satisfaction_reponses']) {
      assert.ok(sql.includes(`drop policy if exists "${table}_direction"`))
      assert.ok(sql.includes(`on public.${table} as restrictive for all to authenticated`))
    }
    assert.doesNotMatch(sql, /using \(public\.is_direction\(\)\)/)
  }
  assert.doesNotMatch(correction, /\b(delete from|update public|truncate|insert into)\b/i)
})
