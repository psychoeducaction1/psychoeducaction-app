import { createHash } from 'node:crypto'

export const privatePdfBucket = 'clinical-pdf-private'
export type PdfReference = { id: string; caseId: string; path: string; sha256: string; bytes: number; state: 'pending' | 'ready' }
export type PrivatePdfPorts = {
  reserve(caseId: string, operationId: string, hash: string, bytes: number): Promise<PdfReference>
  upload(path: string, bytes: Uint8Array): Promise<'created' | 'exists'>
  download(path: string): Promise<Uint8Array>
  commit(id: string): Promise<PdfReference>
  authorizeRead(id: string): Promise<PdfReference>
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function verifyPdf(bytes: Uint8Array, sha256?: string): string {
  if (bytes.byteLength < 100 || bytes.byteLength > 5_242_880
    || Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') throw new Error('PRIVATE_PDF_INVALID')
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== undefined && hash !== sha256) throw new Error('PRIVATE_PDF_INTEGRITY')
  return hash
}
function reference(r: PdfReference): PdfReference {
  if (!r || !uuid.test(r.id) || !uuid.test(r.caseId) || r.path !== `${r.caseId}/${r.id}.pdf`
    || !/^[a-f0-9]{64}$/.test(r.sha256) || !Number.isInteger(r.bytes) || r.bytes < 100 || r.bytes > 5_242_880
    || !['pending', 'ready'].includes(r.state)) throw new Error('PRIVATE_PDF_REFERENCE_INVALID')
  return r
}
/** Two-phase immutable write. Never deletes a blob or falls back to bytea on failure.
 * Retrying the SAME operation recovers upload/commit response loss. Rights are rechecked by RPC/RLS. */
export async function storePrivatePdf(ports: PrivatePdfPorts, caseId: string, operationId: string, bytes: Uint8Array) {
  if (!uuid.test(caseId) || !uuid.test(operationId)) throw new Error('PRIVATE_PDF_INPUT')
  const hash = verifyPdf(bytes)
  const r = reference(await ports.reserve(caseId, operationId, hash, bytes.byteLength))
  if (r.caseId !== caseId || r.sha256 !== hash || r.bytes !== bytes.byteLength) throw new Error('PRIVATE_PDF_CONFLICT')
  if (r.state !== 'ready') await ports.upload(r.path, bytes)
  else {
    const allowed = reference(await ports.authorizeRead(r.id))
    if (allowed.id !== r.id || allowed.sha256 !== hash || allowed.path !== r.path) throw new Error('PRIVATE_PDF_CONFLICT')
  }
  const saved = await ports.download(r.path)
  verifyPdf(saved, hash)
  if (saved.byteLength !== r.bytes) throw new Error('PRIVATE_PDF_INTEGRITY')
  const committed = reference(await ports.commit(r.id))
  if (committed.id !== r.id || committed.path !== r.path || committed.sha256 !== hash
    || committed.bytes !== r.bytes || committed.state !== 'ready') throw new Error('PRIVATE_PDF_COMMIT_INVALID')
  return committed
}
export async function readPrivatePdf(ports: PrivatePdfPorts, id: string) {
  if (!uuid.test(id)) throw new Error('PRIVATE_PDF_INPUT')
  const r = reference(await ports.authorizeRead(id)) // Audit and current case access before network bytes.
  if (r.id !== id || r.state !== 'ready') throw new Error('PRIVATE_PDF_NOT_READY')
  const bytes = await ports.download(r.path)
  verifyPdf(bytes, r.sha256)
  if (bytes.byteLength !== r.bytes) throw new Error('PRIVATE_PDF_INTEGRITY')
  return bytes
}
