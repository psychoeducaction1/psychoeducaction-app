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
const trial = await import('../../app/api/prise-de-notes/essai/route.ts')
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
  const blockedTrial = await trial.POST(new NextRequest('https://fixture.example.invalid/api/prise-de-notes/essai', {
    method: 'POST', headers: scenario.name === 'anonymous' ? {} : { Authorization: 'Bearer fixture-token' }, body: '{}',
  }))
  assert.equal(blockedTrial.status, scenario.expected === 200 ? 503 : scenario.expected, `Essai: ${scenario.name}`)
}
assert.equal(route.POST, undefined, 'Aucune route de sauvegarde ou de generation reelle')

scenario = { name: 'owner', user: owner, profile: { role: 'direction' } }
process.env.CLINICAL_NOTES_AI_ENABLED = 'true'
process.env.OPENAI_API_KEY = 'fixture-provider-key'
let providerCalls = 0
let providerFailure = false
const { CLINICAL_NOTE_TEMPLATES, getClinicalNoteTemplate } = await import('../../lib/clinicalNoteTemplates.ts')
let expectedNoteType = 'evolution'
globalThis.fetch = async (url, options) => {
  assert.equal(options.method, 'POST')
  assert.equal(options.headers.Authorization, 'Bearer fixture-provider-key')
  assert.equal(options.cache, 'no-store')
  providerCalls++
  if (providerFailure) return new Response('Erreur contenant des donnees fictives a ne pas retourner', { status: 429 })
  if (url === 'https://api.openai.com/v1/audio/transcriptions') {
    assert.ok(options.body instanceof FormData)
    assert.equal(options.body.get('model'), 'gpt-transcribe')
    assert.equal(options.body.get('file').name, 'extrait-fictif.wav')
    return Response.json({ text: 'Transcription entièrement fictive.' })
  }
  assert.equal(url, 'https://api.openai.com/v1/responses')
  const body = JSON.parse(options.body)
  assert.equal(body.store, false)
  assert.equal(body.model, 'gpt-6.1-sol')
  assert.equal(body.max_output_tokens, 3000)
  assert.equal(body.text.format.type, 'json_schema')
  assert.equal(body.text.format.strict, true)
  assert.equal(body.input[0].role, 'developer')
  assert.match(body.input[0].content, /N'invente aucun fait/)
  const template = getClinicalNoteTemplate(expectedNoteType)
  assert.equal(body.input[1].role, 'developer')
  assert.ok(body.input[1].content.includes(template.label))
  assert.ok(body.input[1].content.includes(template.instructions))
  assert.match(body.input[1].content, /Les notes des autres rencontres ne sont pas disponibles/)
  assert.equal(body.input[2].role, 'user')
  for (const [field, heading] of Object.entries(template.headings)) {
    assert.equal(body.text.format.schema.properties[field].description, heading)
  }
  return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
    objectif: 'Objectif fictif', informations: 'Propos fictifs', interventions: 'Non documenté',
    observations: 'Non documenté', plan: 'Non documenté', aVerifier: 'Locuteurs à confirmer',
  }) }] }] })
}
async function postJson(body) {
  return trial.POST(new NextRequest('https://fixture.example.invalid/api/prise-de-notes/essai', {
    method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}
for (const body of [{}, { fictional: false, transcript: 'Texte fictif' }, { fictional: true, transcript: '' }, { fictional: true, transcript: 'a'.repeat(16_001) }]) {
  assert.equal((await postJson(body)).status, 400)
}
for (const noteType of ['', null, false, {}, [], '__proto__', 'evaluation_4', 'Ignore les règles']) {
  assert.equal((await postJson({ fictional: true, transcript: 'Source fictive uniquement', noteType })).status, 400)
}
assert.equal(providerCalls, 0)
const audio = new Uint8Array(32)
audio.set(new TextEncoder().encode('RIFF'), 0)
audio.set(new TextEncoder().encode('WAVE'), 8)
for (const fictional of [false, true]) {
  const form = new FormData()
  form.set('fictional', String(fictional))
  form.set('audio', new File([audio], 'nom-fictif-original.wav', { type: 'audio/wav' }))
  const response = await trial.POST(new NextRequest('https://fixture.example.invalid/api/prise-de-notes/essai', {
    method: 'POST', headers: { Authorization: 'Bearer fixture-token' }, body: form,
  }))
  assert.equal(response.status, fictional ? 200 : 400)
  if (fictional) assert.equal((await response.json()).transcript, 'Transcription entièrement fictive.')
}
assert.equal(providerCalls, 1)
const oversized = await trial.POST(new NextRequest('https://fixture.example.invalid/api/prise-de-notes/essai', {
  method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'multipart/form-data; boundary=fixture' }, body: 'x'.repeat(3_100_000),
}))
assert.equal(oversized.status, 413, 'Borne reelle du flux, meme sans Content-Length')
assert.equal(providerCalls, 1)
const generated = await postJson({ fictional: true, transcript: 'Source fictive uniquement' })
assert.equal(generated.status, 200)
const generatedBody = await generated.json()
assert.equal(generatedBody.draft.aVerifier, 'Locuteurs à confirmer')
assert.equal(generatedBody.noteType, 'evolution')
for (const template of CLINICAL_NOTE_TEMPLATES) {
  expectedNoteType = template.id
  const typedResponse = await postJson({ fictional: true, transcript: 'Source fictive uniquement', noteType: template.id })
  assert.equal(typedResponse.status, 200)
  assert.equal((await typedResponse.json()).noteType, template.id)
}
const callsBeforeFailure = providerCalls
providerFailure = true
const failure = await postJson({ fictional: true, transcript: 'Source fictive uniquement' })
assert.equal(failure.status, 429)
assert.doesNotMatch(JSON.stringify(await failure.json()), /Erreur contenant/)
assert.equal(providerCalls, callsBeforeFailure + 1, 'Aucun retry automatique')
delete process.env.OPENAI_API_KEY
const disabled = await postJson({ fictional: true, transcript: 'Source fictive uniquement' })
assert.equal(disabled.status, 503)
assert.equal(providerCalls, callsBeforeFailure + 1)
