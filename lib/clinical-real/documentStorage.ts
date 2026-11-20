import { createHash, randomUUID } from 'node:crypto'

const marker = /^PEA_STORAGE_V1:([a-f0-9-]{36}):([a-f0-9]{64}):([0-9]{1,7})$/
const byteFields = new Set(['base64', 'bytesBase64', 'documentBase64', 'pdfBase64'])
const maximum = 5 * 1024 * 1024
const pdfReaders = new Set([
  'clinical_billing_document', 'clinical_mandate_pdf', 'clinical_read_legacy_document',
  'clinical_unified_client_document', 'clinical_unified_billing_document', 'clinical_unified_fee_pdf',
  'clinical_unified_invoice_pdf', 'clinical_unified_mandate_document', 'clinical_unified_professional_query',
  'clinical_unified_professional_signed_pdf_query', 'clinical_unified_signed_pdf_source',
  'clinical_unified_mandate_preview_source', 'clinical_unified_store_signed_pdf', 'clinical_mandate_portal',
])
type Pending = { id: string; path: string; sha256: string; bytes: number; base64: string }
export type DocumentStoragePorts = {
  pending(operation: string | null): Promise<Pending[]>;
  upload(path: string, bytes: Uint8Array): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  commit(id: string, hash: string): Promise<void>;
}
function verify(bytes: Uint8Array, hash: string, length: number) {
  if (length < 1 || length > maximum || bytes.length !== length
    || createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('PDF_STORAGE_INTEGRITY')
}
/** Call only on the response of the original, successful, authorized domain RPC. */
export async function hydrateAuthorizedPdf(value: unknown, ports: Pick<DocumentStoragePorts, 'download'>): Promise<unknown> {
  const cache = new Map<string, string>()
  async function walk(v: unknown, key = '', depth = 0): Promise<unknown> {
    if (depth > 30) throw new Error('PDF_RESPONSE_DEPTH')
    if (typeof v === 'string' && v.startsWith('PEA_STORAGE_V1:')) {
      const match = marker.exec(v)
      if (!byteFields.has(key) || !match) throw new Error('PDF_REFERENCE_INVALID')
      if (!cache.has(v)) {
        const bytes = await ports.download(match[1] + '.pdf')
        verify(bytes, match[2], Number(match[3])); cache.set(v, Buffer.from(bytes).toString('base64'))
      }
      return cache.get(v)
    }
    if (Array.isArray(v)) { const result = []; for (const item of v) result.push(await walk(item, key, depth + 1)); return result }
    if (v && typeof v === 'object') { const result: Record<string, unknown> = {}; for (const [k, item] of Object.entries(v)) result[k] = await walk(item, k, depth + 1); return result }
    return v
  }
  return walk(value)
}
/** Failure leaves the original bytea durable and the queue pending. Retry is safe. */
export async function flushDocumentStorage(ports: DocumentStoragePorts, operation: string | null, batches = 1) {
  let committed = 0
  for (let n = 0; n < batches; n++) {
    const items = await ports.pending(operation)
    if (!Array.isArray(items) || items.length > 5) throw new Error('PDF_QUEUE_INVALID')
    for (const item of items) {
      if (!/^[a-f0-9-]{36}$/.test(item.id) || item.path !== item.id + '.pdf') throw new Error('PDF_QUEUE_INVALID')
      const bytes = Buffer.from(item.base64.replace(/\s/g, ''), 'base64')
      verify(bytes, item.sha256, item.bytes)
      await ports.upload(item.path, bytes)
      verify(await ports.download(item.path), item.sha256, item.bytes)
      await ports.commit(item.id, item.sha256); committed++
    }
    if (items.length < 5) break
  }
  return committed
}
export function documentStorageServerPorts(url: string): DocumentStoragePorts {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key || url !== process.env.PEA_CLINICAL_REAL_SUPABASE_URL) throw new Error('PDF_SERVER_CONFIGURATION')
  async function request(path: string, options: RequestInit = {}) {
    return fetch(url + path, { ...options, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { apikey: key!, Authorization: `Bearer ${key}`, ...options.headers } })
  }
  async function rpc(name: string, args: unknown) {
    const r = await request('/rest/v1/rpc/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
    if (!r.ok) throw new Error('PDF_STORAGE_QUEUE_FAILED')
    return r.json()
  }
  return {
    pending: operation => rpc('clinical_pdf_storage_pending', { p_operation: operation }),
    async commit(id, hash) { await rpc('clinical_pdf_storage_commit', { p_id: id, p_sha256: hash }) },
    async upload(path, bytes) {
      const r = await request('/storage/v1/object/clinical-pdf-private/' + path, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: new Uint8Array(bytes) })
      // A duplicate after a lost response is accepted only after the read-back below.
      if (!r.ok) { const error = await r.json().catch(() => null); if (![400,409].includes(r.status) || error?.error !== 'Duplicate') throw new Error('PDF_STORAGE_UPLOAD_FAILED') }
    },
    async download(path) {
      const r = await request('/storage/v1/object/authenticated/clinical-pdf-private/' + path)
      if (!r.ok || !r.body) throw new Error('PDF_STORAGE_READ_FAILED')
      const chunks: Uint8Array[] = []; let size = 0
      const reader = r.body.getReader()
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maximum) throw new Error('PDF_STORAGE_TOO_LARGE'); chunks.push(value) } }
      finally { await reader.cancel() }
      return Buffer.concat(chunks)
    },
  }
}
export function documentStorageOperation() {
  return process.env.PEA_PRIVATE_PDF_STORAGE === 'true' ? randomUUID() : null
}
export async function hydrateDocumentRpc(value: unknown, name: string, ports: Pick<DocumentStoragePorts, 'download'>): Promise<unknown> {
  async function root(v: unknown) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v
    const result = { ...v } as Record<string, unknown>
    for (const key of byteFields) if (typeof result[key] === 'string' && (result[key] as string).startsWith('PEA_STORAGE_V1:')) {
      const hydrated = await hydrateAuthorizedPdf({ [key]: result[key] }, ports) as Record<string, unknown>
      result[key] = hydrated[key]
    }
    return result
  }
  // Only fixed output slots of canonical PDF RPCs may invoke privileged Storage.
  // A user-authored JSON note/preference containing a marker is never a capability.
  if (pdfReaders.has(name)) return root(value)
  if (name === 'clinical_unified_mandate_auto_signature_sources' && Array.isArray(value)) return Promise.all(value.map(root))
  if (['clinical_mandate_portal_sign', 'clinical_mandate_portal_signed_result'].includes(name)
    && value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    return { ...object, archiveSource: await root(object.archiveSource) }
  }
  return value
}
export async function finishDocumentRpc(value: unknown, url: string, operation: string | null, name: string): Promise<unknown> {
  if (operation) {
    try { await flushDocumentStorage(documentStorageServerPorts(url), operation) }
    catch { console.warn('PDF_STORAGE_PENDING_RETRY') } // No patient identifier or provider payload.
  }
  // Disabling NEW offloads must never disable reads of documents already moved.
  // Resolve credentials lazily: legacy RPCs need no privileged key.
  return hydrateDocumentRpc(value, name, { download: path => documentStorageServerPorts(url).download(path) })
}
