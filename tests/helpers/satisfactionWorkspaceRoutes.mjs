import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createSupabaseStub } from './supabaseStub.ts'
let current
globalThis.fetch = async () => assert.fail('Aucun réseau réel')
globalThis.__satisfactionAuthorize = async () => {
  current.authorized = true
  return current.denied ? { error: { status: current.denied, message: 'Interdit' } }
    : { context: { user: { id: 'fixture-admin' }, profile: { role: 'direction', full_name: 'Direction fictive' } } }
}
globalThis.__satisfactionAdmin = () => { assert.ok(current.authorized && !current.denied); current.privateAccess++; return current.stub.client }
globalThis.__satisfactionSend = async message => { assert.ok(current.authorized && !current.denied); current.emails.push(message) }
const moduleUrl = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({ resolve(s, c, next) {
  if (s === '@/lib/superAdminServer') return { url: moduleUrl('export const getSuperAdminContext=globalThis.__satisfactionAuthorize'), shortCircuit: true }
  if (s === '@/lib/supabaseAdmin') return { url: moduleUrl('export const getSupabaseAdmin=globalThis.__satisfactionAdmin'), shortCircuit: true }
  if (s === '@/lib/resendEmail') return { url: moduleUrl('export const sendResendEmail=globalThis.__satisfactionSend'), shortCircuit: true }
  if (s === 'next/server') return next('next/server.js', c)
  return next(s, c)
} })
const { NextRequest } = await import('next/server.js')
const importApi = await import('../../app/api/satisfaction/import/route.ts')
const testApi = await import('../../app/api/satisfaction/test/route.ts')
const respondApi = await import('../../app/api/satisfaction/respond/route.ts')
const fresh = tables => current = { authorized: false, privateAccess: 0, emails: [], stub: createSupabaseStub(tables) }
const encounters = Array.from({ length: 4 }, (_, i) => ({ clientNom: 'Camille Fictive', clientNomNormalise: 'forged',
  requerantNom: null, professionnel: 'Professionnel fictif', date: `2026-03-${10 + i}` }))
fresh({ waiting_list_clients: [{ client_name: 'Camille Fictive', contact_email: 'fixture@example.invalid' }], satisfaction_eligibles: [], satisfaction_desabonnes: [] })
let response = await importApi.POST(new NextRequest('https://fixture.example.invalid/api/satisfaction/import', { method: 'POST', body: JSON.stringify({ encounters, fileName: 'fixture.xlsx' }) }))
assert.equal(response.status, 200)
let body = await response.json()
assert.equal(body.import.period_start, '2026-03-10'); assert.equal(body.import.period_end, '2026-03-13')
assert.equal(body.analysis.rows[0].eligible, true)
assert.equal(body.eligibles.length, 1); assert.equal(current.emails.length, 0)
assert.equal(current.stub.rows('satisfaction_imports')[0].analysis.version, 1)
response = await importApi.GET(new NextRequest(`https://fixture.example.invalid/api/satisfaction/import?importId=${body.import.id}`))
assert.equal(response.status, 200); assert.equal((await response.json()).analysis.rows.length, 1)

fresh({ waiting_list_clients: [], satisfaction_eligibles: [], satisfaction_desabonnes: [] })
response = await importApi.POST(new NextRequest('https://fixture.example.invalid/api/satisfaction/import', { method: 'POST', body: JSON.stringify({ encounters: encounters.slice(0, 1) }) }))
body = await response.json(); assert.equal(response.status, 200); assert.equal(body.eligibles.length, 0)
response = await importApi.GET(new NextRequest(`https://fixture.example.invalid/api/satisfaction/import?importId=${body.import.id}`))
body = await response.json(); assert.equal(response.status, 200); assert.equal(body.eligibles.length, 0); assert.match(body.analysis.rows[0].reasons[0], /Moins de 4/)
assert.equal(current.emails.length, 0)

fresh({ satisfaction_imports: [{ id: 'old', row_count: 30 }], satisfaction_eligibles: [] })
response = await importApi.GET(new NextRequest('https://fixture.example.invalid/api/satisfaction/import?importId=old'))
assert.equal(response.status, 200); assert.equal((await response.json()).analysis, null)
response = await importApi.GET(new NextRequest('https://fixture.example.invalid/api/satisfaction/import?importId=absent'))
assert.equal(response.status, 404)

fresh({ satisfaction_imports: [{ id: 'with-response' }], satisfaction_eligibles: [{ id: 'eligible', import_id: 'with-response' }],
  satisfaction_reponses: [{ eligible_id: 'eligible', note: 5, commentaire: 'Commentaire fictif' }],
  satisfaction_envois: [{ eligible_id: 'eligible', statut: 'envoye', envoye_le: '2026-03-13' }] })
response = await importApi.GET(new NextRequest('https://fixture.example.invalid/api/satisfaction/import?importId=with-response'))
body = await response.json(); assert.equal(body.eligibles[0].reponse.note, 5); assert.equal(body.eligibles[0].dernier_envoi.statut, 'envoye')

for (const denied of [401, 403]) {
  fresh({}); current.denied = denied
  response = await testApi.POST(new NextRequest('https://fixture.example.invalid/api/satisfaction/test', { method: 'POST', body: JSON.stringify({ email: 'fixture@example.invalid', name: 'Exemple', confirm: true }) }))
  assert.equal(response.status, denied); assert.equal(current.privateAccess, 0); assert.equal(current.emails.length, 0)
}
for (const payload of [{}, { email: 'fixture@example.invalid', name: 'Exemple' }, { email: 'invalid', name: 'Exemple', confirm: true }]) {
  fresh({}); response = await testApi.POST(new NextRequest('https://fixture.example.invalid/api/satisfaction/test', { method: 'POST', body: JSON.stringify(payload) }))
  assert.equal(response.status, 400); assert.equal(current.emails.length, 0)
}
fresh({})
process.env.NEXT_PUBLIC_APP_URL = 'https://fixture.example.invalid'
response = await testApi.POST(new NextRequest('https://fixture.example.invalid/api/satisfaction/test', { method: 'POST', body: JSON.stringify({ email: 'fixture@example.invalid', name: 'Exemple Fictif', professionnel: 'Professionnel fictif', confirm: true }) }))
assert.equal(response.status, 200); assert.equal(current.privateAccess, 0); assert.equal(current.emails.length, 1)
assert.equal(current.emails[0].to, 'fixture@example.invalid'); assert.match(current.emails[0].subject, /^\[TEST\]/)
assert.match(current.emails[0].html, /href="https:\/\/fixture.example.invalid\/satisfaction\/test"/)
assert.doesNotMatch(current.emails[0].html, /satisfaction\/reponse\/|api\/satisfaction\/unsubscribe|g.page/)
assert.doesNotMatch(current.emails[0].html, /Votre suivi avec/)
assert.deepEqual(current.stub.rows('satisfaction_eligibles'), [])
assert.deepEqual(current.stub.rows('satisfaction_imports'), [])

// Le vrai sondage conserve note/commentaire en privé; un jeton invalide ou un retry ne crée rien.
fresh({ satisfaction_eligibles: [{ id: 'fixture-eligible', jeton_reponse: 'fixture-response-token', destinataire_nom: 'Exemple Fictif' }], satisfaction_reponses: [] })
current.authorized = true // accès serveur simulé pour les routes publiques par jeton
response = await respondApi.GET(new NextRequest('https://fixture.example.invalid/api/satisfaction/respond?token=fixture-response-token'))
assert.equal(response.status, 200); assert.equal((await response.json()).alreadyResponded, false)
response = await respondApi.POST(new NextRequest('https://fixture.example.invalid/api/satisfaction/respond', { method: 'POST', body: JSON.stringify({ token: 'fixture-response-token', note: 2, commentaire: 'Commentaire fictif' }) }))
assert.equal(response.status, 200)
assert.equal(current.stub.rows('satisfaction_reponses')[0].note, 2)
assert.equal(current.stub.rows('satisfaction_reponses')[0].commentaire, 'Commentaire fictif')
for (const [token, status] of [['fixture-response-token', 409], ['invalid-fixture-token', 404]]) {
  response = await respondApi.POST(new NextRequest('https://fixture.example.invalid/api/satisfaction/respond', { method: 'POST', body: JSON.stringify({ token, note: 5 }) }))
  assert.equal(response.status, status)
}
assert.equal(current.stub.rows('satisfaction_reponses').length, 1)
assert.equal(current.emails.length, 0)
