// Les hooks sont confines a un sous-processus: aucune connexion ni vrai courriel.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { SUPER_ADMIN_EMAIL } from '../../lib/superAdmin.ts'

const identity = process.argv[2]
const superAdminEmail = identity === 'super_admin' || identity === 'missing_profile' || identity === 'wrong_role'
const user = { id: 'fixture-user', email: superAdminEmail ? SUPER_ADMIN_EMAIL : 'assistant@example.invalid' }
const profile = identity === 'missing_profile' ? null : {
  role: identity === 'professional' || identity === 'wrong_role' ? 'professionnel'
    : identity === 'marketing' ? 'marketing' : 'direction',
  full_name: 'Identité fictive',
  // Une adresse dans le profil ne doit jamais remplacer celle de l'identite authentifiee.
  email: SUPER_ADMIN_EMAIL,
}
const allowed = identity === 'super_admin'
let privateAccesses = 0
let synchronizations = 0

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.example.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fixture-public-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-private-key'
globalThis.fetch = async () => { assert.fail('Aucun acces reseau autorise dans ce test') }

globalThis.__restrictedSectionsCreateClient = (_url, key) => {
  if (key === 'fixture-private-key') {
    assert.equal(allowed, true, 'Acces privilegie avant autorisation')
    privateAccesses++
    return {
      from(table) {
        assert.ok(['satisfaction_eligibles', 'satisfaction_imports'].includes(table))
        return {
          select() { return this }, eq() { return this },
          maybeSingle() { return Promise.resolve({ data: { id: 'fixture-import', analysis: null }, error: null }) },
          order() { return Promise.resolve({ data: [], error: null }) },
        }
      },
    }
  }
  assert.equal(key, 'fixture-public-key')
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table) {
      assert.equal(table, 'profiles', 'Donnees metier lues avant autorisation')
      return {
        select() { return this }, eq() { return this }, limit() { return this },
        maybeSingle: async () => ({ data: profile, error: null }),
      }
    },
  }
}
globalThis.__restrictedSectionsSync = async () => {
  assert.equal(allowed, true, 'Synchronisation avant autorisation')
  synchronizations++
  return { results: [] }
}

const moduleUrl = (code) => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: moduleUrl('export {}'), shortCircuit: true }
    if (specifier === '@supabase/supabase-js') return {
      url: moduleUrl('export const createClient = globalThis.__restrictedSectionsCreateClient'), shortCircuit: true,
    }
    if (specifier === '@/lib/adSpendSync') return {
      url: moduleUrl('export const syncAdSpend = globalThis.__restrictedSectionsSync'), shortCircuit: true,
    }
    if (specifier === 'next/server') return nextResolve('next/server.js', context)
    return nextResolve(specifier, context)
  },
})

const { NextRequest } = await import('next/server.js')
const satisfactionImport = await import('../../app/api/satisfaction/import/route.ts')
const satisfactionSend = await import('../../app/api/satisfaction/send/route.ts')
const satisfactionTest = await import('../../app/api/satisfaction/test/route.ts')
const acquisition = await import('../../app/api/direction/acquisition/route.ts')
const acquisitionSync = await import('../../app/api/direction/acquisition/sync/route.ts')

for (const [path, method, handler, allowedStatus] of [
  ['/api/satisfaction/import?importId=fixture-import', 'GET', satisfactionImport.GET, 200],
  ['/api/satisfaction/import', 'POST', satisfactionImport.POST, 400],
  ['/api/satisfaction/import', 'PATCH', satisfactionImport.PATCH, 400],
  ['/api/satisfaction/send', 'POST', satisfactionSend.POST, 400],
  ['/api/satisfaction/test', 'POST', satisfactionTest.POST, 400],
  ['/api/direction/acquisition', 'GET', acquisition.GET, 400],
  ['/api/direction/acquisition', 'POST', acquisition.POST, 400],
  ['/api/direction/acquisition/sync', 'POST', acquisitionSync.POST, 200],
]) {
  const response = await handler(new NextRequest(`https://fixture.example.invalid${path}`, {
    method,
    headers: identity === 'anonymous' ? {} : { Authorization: 'Bearer fixture-token' },
    ...(method === 'GET' ? {} : { body: '{}' }),
  }))
  assert.equal(response.status, allowed ? allowedStatus : identity === 'anonymous' ? 401 : 403,
    `${identity}: ${method} ${path}`)
}

assert.equal(privateAccesses, allowed ? 1 : 0)
assert.equal(synchronizations, allowed ? 1 : 0)
