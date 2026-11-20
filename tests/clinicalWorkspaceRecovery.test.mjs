import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../lib/clinical-workspace/api.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function workspaceRequest(responses) {
  const calls = []
  const intents = new Map()
  const exports = {}
  runInNewContext(source, {
    exports, crypto, TextEncoder,
    window: { sessionStorage: {
      getItem: key => intents.get(key), setItem: (key, value) => intents.set(key, value), removeItem: key => intents.delete(key),
    } },
    require: name => name.includes('authClient') ? { clinicalSessionHeaders: async () => ({}) } : { clinicalUiText: (_, real) => real },
    fetch: async (_, init) => { calls.push(init); return responses.shift() },
  })
  return { request: exports.clinicalRequest, calls, intents }
}

const actor = { actorId: 'fixture', context: 'administration' }
const accepted = value => value?.saved === true

test('une réponse de lecture invalide demande une actualisation sans conserver d’opération', async () => {
  const workspace = workspaceRequest([Response.json({ unrelated: true })])
  await assert.rejects(workspace.request(actor, '/admission', undefined, 'GET', undefined, undefined, accepted), /assignations.*Actualisez la section/)
  assert.equal(workspace.intents.size, 0)
})

test('une réponse d’enregistrement invalide conserve la saisie et permet de reprendre avec la même clé', async () => {
  const workspace = workspaceRequest([
    Response.json({ unrelated: true }),
    Response.json({ error: 'Confirmation indisponible.', code: 'RESULT_UNCONFIRMED' }, { status: 409 }),
    Response.json({ saved: true }),
  ])
  const save = () => workspace.request(actor, '/admission', { action: 'fictitious' }, 'POST', undefined, undefined, accepted)
  await assert.rejects(save(), /reste à vérifier.*saisie/)
  assert.equal(workspace.calls.length, 1)
  await assert.rejects(save(), /Confirmation indisponible/)
  assert.equal(workspace.calls.length, 2)
  assert.equal(workspace.intents.size, 1)
  assert.deepEqual(await save(), { saved: true })
  assert.equal(new Set(workspace.calls.map(call => call.headers['Idempotency-Key'])).size, 1)
  assert.equal(workspace.intents.size, 0)
})

test('un refus explicite termine l’intention tandis qu’une erreur sans réponse métier garde la clé', async () => {
  const workspace = workspaceRequest([
    new Response('<html></html>', { status: 409 }),
    Response.json({ error: 'Accès refusé.', code: 'FORBIDDEN' }, { status: 403 }),
  ])
  const save = () => workspace.request(actor, '/admission', { action: 'fictitious' }, 'POST')
  await assert.rejects(save(), /n’a pas pu être confirmée/)
  assert.equal(workspace.intents.size, 1)
  await assert.rejects(save(), /Accès refusé/)
  assert.equal(workspace.intents.size, 0)
  assert.equal(workspace.calls[0].headers['Idempotency-Key'], workspace.calls[1].headers['Idempotency-Key'])
})
