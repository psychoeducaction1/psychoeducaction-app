import assert from 'node:assert/strict'
import test from 'node:test'
import { filterProcedures, validProcedureArticle, type ProcedureArticle } from '../lib/procedures/model.ts'
import { handleProcedureRequest, type ProcedureAuthorization, type ProcedureBackend } from '../lib/procedures/http.ts'

const section = '10000000-0000-4000-8000-000000000001', other = '10000000-0000-4000-8000-000000000002'
const article: ProcedureArticle = { id: '20000000-0000-4000-8000-000000000001', sectionId: section, title: 'Ouverture fictive', body: 'Contacter le payeur après vérification.', keywords: ['Échéance', 'premier rendez-vous'], status: 'review', version: 1, updatedAt: '2026-11-17T12:00:00Z', sourceTitle: null }
const input = { id: article.id, sectionId: section, title: article.title, body: article.body, keywords: article.keywords, status: article.status, expectedVersion: 1 }
const sections = [{ id: section, title: 'Procédures en vigueur', position: 0, version: 1 }, { id: other, title: 'Plaintes', position: 1, version: 1 }]

test('recherche : accents, mots-clés, section et combinaison de plusieurs mots', () => {
  const articles = [article, { ...article, id: other, sectionId: other, title: 'Autre procédure' }]
  assert.equal(filterProcedures(articles, sections, 'echeance payeur', section).length, 1)
  assert.equal(filterProcedures(articles, sections, 'en vigueur', '').length, 1)
  assert.equal(filterProcedures(articles, sections, 'introuvable', '').length, 0)
  assert.equal(filterProcedures(articles, sections, '', other)[0].sectionId, other)
  assert.equal(filterProcedures(articles, sections, '', '').length, 2)
})
test('validation : contraintes et champs d’identité ou de droit forgés refusés', () => {
  assert.equal(validProcedureArticle(input), true)
  assert.equal(validProcedureArticle({ ...input, status: 'current', body: '' }), false)
  assert.equal(validProcedureArticle({ ...input, status: 'draft', body: '' }), true)
  for (const extra of [{ actorId: other }, { canEdit: true }, { expectedVersion: -1 }, { title: '' }, { status: 'unknown' }, { body: 'x'.repeat(40001) }, { keywords: Array(31).fill('mot') }]) assert.equal(validProcedureArticle({ ...input, ...extra }), false)
})

function fixture(canEdit = true) {
  const calls: string[] = []
  const backend: ProcedureBackend = { canEdit, homeHref: '/clinique', load: async () => { calls.push('read'); return { canEdit, sections, articles: [article] } }, saveArticle: async () => { calls.push('article'); return { id: article.id, version: 2 } }, saveSection: async () => { calls.push('section'); return { id: section, version: 1 } } }
  return { backend, calls, authorize: async (): Promise<ProcedureAuthorization> => ({ backend }) }
}
const request = (body?: unknown, origin = 'https://app.example.invalid') => new Request('https://app.example.invalid/api/procedures', body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) } : undefined)

test('HTTP : refus avant tout accès aux documents et accès limité à la lecture', async () => {
  const denied = await handleProcedureRequest(request(), async () => ({ status: 403, error: 'Accès refusé.' }))
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('cache-control'), 'private, no-store')
  const unauthenticated = await handleProcedureRequest(request(), async () => ({ status: 401, error: 'Session requise.' }))
  assert.equal(unauthenticated.status, 401)
  const f = fixture(false)
  assert.equal((await handleProcedureRequest(request({ action: 'article.save', data: input }), f.authorize)).status, 403)
  assert.deepEqual(f.calls, [])
  assert.equal((await handleProcedureRequest(request(), f.authorize)).status, 200)
  assert.deepEqual(f.calls, ['read'])
})
test('HTTP : accès de navigation sans contenu, mutations bornées, conflits conservant la saisie', async () => {
  const f = fixture()
  const access = await handleProcedureRequest(new Request('https://app.example.invalid/api/procedures?access=1'), f.authorize)
  assert.deepEqual(await access.json(), { canRead: true, canEdit: true, homeHref: '/clinique' })
  assert.deepEqual(f.calls, [])
  assert.equal((await handleProcedureRequest(request({ action: 'article.save', data: input }), f.authorize)).status, 200)
  assert.deepEqual(f.calls, ['article'])
  assert.equal((await handleProcedureRequest(request({ action: 'article.save', data: { ...input, actorId: other } }), f.authorize)).status, 400)
  assert.equal((await handleProcedureRequest(request({ action: 'article.save', data: input }, 'https://other.example.invalid'), f.authorize)).status, 403)
  f.backend.saveArticle = async () => { throw { code: '40001' } }
  const conflict = await handleProcedureRequest(request({ action: 'article.save', data: input }), f.authorize)
  assert.equal(conflict.status, 409)
  assert.match((await conflict.json()).error, /saisie est conservée/)
  const huge = new Request('https://app.example.invalid/api/procedures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'a'.repeat(180001) }) })
  assert.equal((await handleProcedureRequest(huge, f.authorize)).status, 413)
})
