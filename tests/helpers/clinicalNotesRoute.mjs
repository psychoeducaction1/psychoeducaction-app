import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { CLINICAL_NOTES_PILOT_USER_ID } from '../../lib/clinicalNotesAccess.ts'
import { SUPER_ADMIN_EMAIL } from '../../lib/superAdmin.ts'

let scenario
let profileReads = 0
let authReads = 0
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.example.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fixture-public-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'forbidden-private-key'

globalThis.__clinicalNotesClient = (url, key, options) => {
  assert.equal(url, 'https://fixture.example.invalid')
  assert.equal(key, 'fixture-public-key', 'Aucune cle privilegiee dans ce pilote')
  assert.equal(options.global.headers.Authorization, 'Bearer fixture-token')
  assert.equal(options.auth.persistSession, false)
  return {
    auth: { async getUser() {
      authReads++
      if (scenario.name === 'network_error') throw Error('Erreur simulee')
      return { data: { user: scenario.user }, error: scenario.name === 'invalid_session' ? {} : null }
    } },
    from(table) {
      assert.equal(table, 'profiles', 'Ne lire aucun dossier ni table clinique')
      assert.ok(scenario.user)
      profileReads++
      return {
        select(fields) { assert.equal(fields, 'role'); return this },
        eq(field, value) { assert.equal(field, 'id'); assert.equal(value, scenario.user.id); return this },
        limit() { return this },
        async maybeSingle() {
          return { data: scenario.profile, error: scenario.name === 'profile_error' ? {} : null }
        },
      }
    },
  }
}
const moduleUrl = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') return { url: moduleUrl('export {}'), shortCircuit: true }
  if (specifier === '@supabase/supabase-js') return {
    url: moduleUrl('export const createClient = globalThis.__clinicalNotesClient'), shortCircuit: true,
  }
  if (specifier === 'next/server') return nextResolve('next/server.js', context)
  return nextResolve(specifier, context)
} })
const { NextRequest } = await import('next/server.js')
const route = await import('../../app/api/prise-de-notes/route.ts')
const ordinary = { id: 'ordinary-fixture', email: 'ordinary@example.invalid' }
const owner = { id: 'owner-fixture', email: SUPER_ADMIN_EMAIL }
const pilot = { id: CLINICAL_NOTES_PILOT_USER_ID, email: 'pilot@example.invalid' }
for (scenario of [
  { name: 'anonymous', expected: 401 },
  { name: 'invalid_session', user: ordinary, expected: 401 },
  { name: 'no_user', user: null, expected: 401 },
  { name: 'missing_profile', user: owner, profile: null, expected: 403 },
  { name: 'assistant', user: ordinary, profile: { role: 'direction', email: SUPER_ADMIN_EMAIL }, expected: 403 },
  { name: 'other_professional_same_name', user: ordinary, profile: { role: 'professionnel', full_name: 'Identite fictive pilote' }, expected: 403 },
  { name: 'owner_wrong_role', user: owner, profile: { role: 'professionnel' }, expected: 403 },
  { name: 'pilot_wrong_role', user: pilot, profile: { role: 'direction' }, expected: 403 },
  { name: 'marketing', user: ordinary, profile: { role: 'marketing' }, expected: 403 },
  { name: 'profile_error', user: owner, profile: { role: 'direction' }, expected: 500 },
  { name: 'network_error', user: owner, expected: 500 },
  { name: 'owner', user: owner, profile: { role: 'direction' }, expected: 200 },
  { name: 'pilot', user: pilot, profile: { role: 'professionnel' }, expected: 200 },
]) {
  profileReads = 0; authReads = 0
  const response = await route.GET(new NextRequest('https://fixture.example.invalid/api/prise-de-notes', {
    headers: scenario.name === 'anonymous' ? {} : { Authorization: 'Bearer fixture-token' },
  }))
  assert.equal(response.status, scenario.expected, scenario.name)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(response.headers.get('Vary'), 'Authorization')
  const body = await response.json()
  if (scenario.expected === 200) {
    assert.equal(body.viewerId, scenario.user.id)
    assert.equal(body.mode, 'demo')
    assert.equal(body.sessions.length, 3)
    assert.ok(body.sessions.every(session => session.id.startsWith('FICT-')))
    assert.equal(profileReads, 1)
  } else {
    assert.equal(body.sessions, undefined, 'Ne pas retourner le pilote aux comptes refuses')
    assert.equal(body.viewerId, undefined)
  }
  if (scenario.expected === 401 || scenario.name === 'network_error') assert.equal(profileReads, 0)
  if (scenario.name === 'anonymous') assert.equal(authReads, 0)
}
assert.equal(route.POST, undefined, 'Aucune route de sauvegarde ou de generation reelle')
