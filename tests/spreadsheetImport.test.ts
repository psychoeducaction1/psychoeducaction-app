import assert from 'node:assert/strict'
import test from 'node:test'
import * as XLSX from 'xlsx'
import { parseSpreadsheetRows } from '../lib/spreadsheetRows.ts'
import { readSpreadsheetRows } from '../lib/spreadsheetImport.ts'
import { MAX_SPREADSHEET_BYTES } from '../lib/spreadsheetImportLimits.ts'

function workbook(rows: unknown[][], format: 'xlsx' | 'xls' = 'xlsx', reference?: string) {
  const book = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  if (reference) sheet['!ref'] = reference
  XLSX.utils.book_append_sheet(book, sheet, 'Activités')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Feuille ignorée']]), 'Autre')
  return XLSX.write(book, { type: 'array', bookType: format }) as ArrayBuffer
}

test('le lecteur isolé conserve dates, montants et première feuille des exports xlsx/xls', () => {
  for (const format of ['xlsx', 'xls'] as const) {
    const buffer = workbook([['Date', 'Montant'], [new Date('2026-10-14T00:00:00Z'), 125.5]], format)
    const raw = parseSpreadsheetRows(buffer, { raw: true, cellDates: true })
    assert.equal(raw.length, 2)
    assert.ok(raw[1][0] instanceof Date)
    assert.equal(raw[1][1], 125.5)
    const formatted = parseSpreadsheetRows(buffer, { raw: false })
    assert.equal(typeof formatted[1][0], 'string')
    assert.equal(formatted[1][1], '125.5')
  }
})

test('le parseur refuse format déguisé, fichier corrompu et dimensions excessives sans tronquer les activités', () => {
  assert.throws(() => parseSpreadsheetRows(new TextEncoder().encode('contenu non Excel').buffer, { raw: true }), /contenu/)
  assert.throws(() => parseSpreadsheetRows(new Uint8Array([80, 75, 3, 4, 0]).buffer, { raw: true }), /ne peut pas/)
  for (const reference of ['A1:A20002', 'A1:BM2', 'A1:Z20000']) {
    assert.throws(() => parseSpreadsheetRows(workbook([['Données fictives']], 'xlsx', reference), { raw: true }), /dépasse les limites/)
  }
  assert.throws(() => parseSpreadsheetRows(workbook([['x'.repeat(5001)]]), { raw: true }), /5 000/)
})

function workerFixture(response?: unknown) {
  let terminated = 0
  let posted = 0
  const worker = {
    onmessage: null, onerror: null,
    terminate() { terminated++ },
    postMessage() {
      posted++
      if (response !== undefined) queueMicrotask(() => worker.onmessage?.call(worker, { data: response } as MessageEvent))
    },
  } as unknown as Worker
  return { worker, counts: () => ({ terminated, posted }) }
}
const file = () => ({ name: 'fixture.xlsx', size: 4, arrayBuffer: async () => new Uint8Array([80, 75, 3, 4]).buffer })

test('les limites de fichier sont contrôlées avant lecture et création du worker', async () => {
  let reads = 0
  const bad = { name: 'fixture.xlsx', size: MAX_SPREADSHEET_BYTES + 1, arrayBuffer: async () => { reads++; return new ArrayBuffer(4) } }
  await assert.rejects(readSpreadsheetRows(bad, { raw: true }), /10 Mo/)
  await assert.rejects(readSpreadsheetRows({ ...bad, name: 'fixture.csv', size: 4 }, { raw: true }), /\.xlsx/)
  assert.equal(reads, 0)
})

test('le worker est terminé après succès, erreur, annulation et dépassement de temps', async () => {
  const success = workerFixture({ ok: true, rows: [['Données fictives']] })
  assert.deepEqual(await readSpreadsheetRows(file(), { raw: true }, undefined, { createWorker: () => success.worker }), [['Données fictives']])
  assert.deepEqual(success.counts(), { posted: 1, terminated: 1 })
  const invalid = workerFixture({ ok: true, rows: ['invalide'] })
  await assert.rejects(readSpreadsheetRows(file(), { raw: true }, undefined, { createWorker: () => invalid.worker }), /invalide/)
  assert.equal(invalid.counts().terminated, 1)
  const slow = workerFixture()
  await assert.rejects(readSpreadsheetRows(file(), { raw: true }, undefined, { createWorker: () => slow.worker, timeoutMs: 5 }), /trop de temps/)
  assert.equal(slow.counts().terminated, 1)
  const cancelled = workerFixture()
  const controller = new AbortController()
  const promise = readSpreadsheetRows(file(), { raw: true }, controller.signal, { createWorker: () => cancelled.worker })
  await Promise.resolve()
  controller.abort()
  await assert.rejects(promise, { name: 'AbortError' })
  assert.equal(cancelled.counts().terminated, 1)
})
