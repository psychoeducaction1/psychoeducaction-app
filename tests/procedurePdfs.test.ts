import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { PDFDocument, PDFName } from 'pdf-lib'
import { checkedProcedurePdf, handleProcedurePdfRequest, type ProcedurePdfBackend } from '../lib/procedures/pdfHttp.ts'
import type { ProcedurePdfInput } from '../lib/procedures/pdfModel.ts'

const articleId = '20000000-0000-4000-8000-000000000001', id = '30000000-0000-4000-8000-000000000001'
async function fixture() {
  const pdf = await PDFDocument.create(); pdf.addPage()
  const bytes = Buffer.from(await pdf.save())
  const input: ProcedurePdfInput = { id, articleId, documentId: id, expectedVersion: 0, label: 'Guide fictif', fileName: 'Guide fictif.pdf', mediaType: 'application/pdf', bytesBase64: bytes.toString('base64') }
  return { pdf, bytes, input }
}
const request = (body: unknown) => new Request('https://example.test/api/procedures/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
test('PDF statiques : validation réelle, fichiers corrompus et actions directes imbriquées refusés', async () => {
  const { pdf, bytes } = await fixture()
  assert.deepEqual(await checkedProcedurePdf(bytes.toString('base64')), bytes)
  await assert.rejects(checkedProcedurePdf(Buffer.from('Faux PDF').toString('base64')))
  await assert.rejects(checkedProcedurePdf('A'.repeat(4194308)))
  pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj([pdf.getPages()[0].ref, PDFName.of('Fit')]))
  await checkedProcedurePdf(Buffer.from(await pdf.save()).toString('base64'))
  pdf.catalog.set(PDFName.of('Nested'), pdf.context.obj({ Action: { S: 'JavaScript', JS: 'fictif' } }))
  await assert.rejects(checkedProcedurePdf(Buffer.from(await pdf.save()).toString('base64')))
})
test('API PDF : droits avant contenu, métadonnées privées, intégrité et enregistrement borné', async () => {
  const { bytes, input } = await fixture(); let saved = 0, read = 0
  const metadata = { id, articleId, documentId: id, version: 1, label: input.label, fileName: input.fileName, byteLength: bytes.length, createdAt: '2026-11-17T12:00:00Z' }
  const stored = { ...metadata, bytesBase64: input.bytesBase64, sha256: createHash('sha256').update(bytes).digest('hex'), mediaType: 'application/pdf' as const }
  const backend: ProcedurePdfBackend = { canEdit: true, list: async () => [metadata], read: async () => { read++; return stored }, save: async () => { saved++; return { id, version: 1 } } }
  const auth = async () => ({ backend })
  assert.equal((await handleProcedurePdfRequest(request(input), undefined, async () => ({ status: 403, error: 'Refusé' }))).status, 403)
  assert.equal(saved, 0)
  assert.equal((await handleProcedurePdfRequest(request(input), undefined, async () => ({ backend: { ...backend, canEdit: false } }))).status, 403)
  assert.equal((await handleProcedurePdfRequest(request({ ...input, uploaded_by: id }), undefined, auth)).status, 400)
  assert.equal((await handleProcedurePdfRequest(request({ ...input, fileName: '../guide.pdf' }), undefined, auth)).status, 400)
  assert.equal((await handleProcedurePdfRequest(request(input), undefined, auth)).status, 200); assert.equal(saved, 1)
  const listing = await handleProcedurePdfRequest(new Request('https://example.test/api/procedures/files?article=' + articleId), undefined, auth)
  assert.match(listing.headers.get('cache-control')!, /private, no-store/)
  assert.doesNotMatch(await listing.text(), /bytesBase64|sha256/)
  const download = await handleProcedurePdfRequest(new Request('https://example.test/api/procedures/files/' + id), id, auth)
  assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'application/pdf')
  assert.match(download.headers.get('content-disposition')!, /attachment;.*filename\*/)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes)
  stored.sha256 = '0'.repeat(64)
  assert.equal((await handleProcedurePdfRequest(new Request('https://example.test/api/procedures/files/' + id), id, auth)).status, 502)
  const readCount = read
  assert.equal((await handleProcedurePdfRequest(new Request('https://example.test/api/procedures/files/' + id), id, async () => ({ status: 403, error: 'Révoqué' }))).status, 403)
  assert.equal(read, readCount)
  assert.equal((await handleProcedurePdfRequest(request(input), undefined, async () => ({ backend: { ...backend, save: async () => { throw { code: '40001' } } } }))).status, 409)
})
