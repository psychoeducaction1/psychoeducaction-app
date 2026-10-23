import assert from 'node:assert/strict'
import test from 'node:test'
import { readBoundedJsonObject } from '../lib/boundedJsonBody.ts'

test('le flux JSON est limité avant parsing, avec ou sans en-tête Content-Length', async () => {
  assert.deepEqual(await readBoundedJsonObject(new Request('https://fixture.invalid', { method: 'POST', body: '{"value":"é"}' }), 20), { value: 'é' })
  for (const length of [undefined, '1', '1000']) {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"secret":"fixture-private-content"}')) },
      cancel() { cancelled = true },
    })
    const request = new Request('https://fixture.invalid', { method: 'POST', body: stream, duplex: 'half', headers: length ? { 'Content-Length': length } : {} } as RequestInit)
    await assert.rejects(readBoundedJsonObject(request, 10), (error: unknown) => {
      assert.equal((error as { status: number }).status, 413)
      assert.doesNotMatch((error as Error).message, /fixture-private-content/)
      return true
    })
    if (length !== '1000') assert.equal(cancelled, true)
  }
})

test('le lecteur JSON refuse corps malformés, null, tableaux et UTF-8 invalide', async () => {
  for (const body of ['null', '[]', '"texte"', '{"invalid":', new Uint8Array([0xff])]) {
    await assert.rejects(readBoundedJsonObject(new Request('https://fixture.invalid', { method: 'POST', body }), 100), { status: 400 })
  }
})
