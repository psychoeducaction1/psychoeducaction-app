import { privatePdfBucket, type PdfReference, type PrivatePdfPorts } from './privatePdfStore.ts'

/** Preparation only: caller must have authenticated the user. Uses their JWT, never service_role.
 * Not wired to an HTTP endpoint until the additive SQL and complete document-kind recipe are approved. */
export function privatePdfTransport(url: string, publicKey: string, token: string,
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>, fetcher: typeof fetch = fetch): PrivatePdfPorts {
  let keyAllowed = /^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(publicKey)
  try { keyAllowed ||= JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString()).role === 'anon' } catch { /* Not an anon JWT. */ }
  if ((!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && url !== 'http://127.0.0.1:56321')
    || !/^[A-Za-z0-9._~-]{1,8192}$/.test(token) || !keyAllowed) throw new Error('PRIVATE_PDF_CONFIG')
  const object = async (path: string, bytes?: Uint8Array) => {
    if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.pdf$/.test(path)) throw new Error('PRIVATE_PDF_PATH')
    return fetcher(`${url}/storage/v1/object/${bytes ? '' : 'authenticated/'}${privatePdfBucket}/${path}`, {
      method: bytes ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { apikey: publicKey, Authorization: `Bearer ${token}`, ...(bytes ? { 'Content-Type': 'application/pdf', 'x-upsert': 'false' } : {}) },
      ...(bytes ? { body: new Uint8Array(bytes) } : {}),
    })
  }
  return {
    reserve: async (caseId, operationId, hash, bytes) => await rpc('clinical_private_pdf_reserve', {
      p_case: caseId, p_operation: operationId, p_sha256: hash, p_bytes: bytes,
    }) as PdfReference,
    async upload(path, bytes) {
      const r = await object(path, bytes)
      if (r.ok) return 'created'
      const value = await r.json().catch(() => ({}))
      if ([400, 409].includes(r.status) && ['Duplicate', 'ResourceAlreadyExists'].includes(value.error ?? value.code)) return 'exists'
      throw new Error('PRIVATE_PDF_UPLOAD_FAILED')
    },
    async download(path) {
      const r = await object(path)
      if (!r.ok || !r.body) throw new Error('PRIVATE_PDF_DOWNLOAD_FAILED')
      const reader = r.body.getReader(), chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 5_242_880) throw new Error('PRIVATE_PDF_TOO_LARGE')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      return Buffer.concat(chunks)
    },
    commit: async id => await rpc('clinical_private_pdf_commit', { p_id: id }) as PdfReference,
    authorizeRead: async id => await rpc('clinical_private_pdf_read', { p_id: id }) as PdfReference,
  }
}
