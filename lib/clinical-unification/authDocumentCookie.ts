/** Only a previously validated user token may be passed to unifiedDocumentCookie. */
const cookieName = 'pea_unified_documents'
const cookiePath = '/api/clinical-workspace'
const tokenPattern = /^[A-Za-z0-9._~-]{1,8192}$/
const id = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const contextual = new RegExp(`^/api/clinical-workspace/(?:mandates/(?:documents|preview)/${id}|professionals/${id}/documents/${id}|clients/${id}/documents/${id})/(administration|clinical)(?:/(?:signed/)?download)?$`, 'i')
const note = new RegExp(`^/api/clinical-workspace/notes/${id}/pdf$`, 'i')
const finance = new RegExp(`^/api/clinical-workspace/(?:billing/(?:invoices|receipts)|fees/statements)/${id}/(?:pdf|download)$`, 'i')
const billingDocument = new RegExp(`^/api/clinical-workspace/billing/documents/${id}/administration/download$`, 'i')
const feeDocument = new RegExp(`^/api/clinical-workspace/billing/fees/documents/${id}/(clinical|administration)/download$`, 'i')
const invoicePreview = new RegExp(`^/api/clinical-workspace/billing/invoices/${id}/pdf$`, 'i')

function expiresAt(token: string): number {
  if (!tokenPattern.test(token)) return 0
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return 0
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload && typeof payload === 'object' && 'exp' in payload && Number.isSafeInteger(payload.exp) ? Number(payload.exp) : 0
  } catch { return 0 }
}

function attributes(requestUrl: string): string {
  const url = new URL(requestUrl)
  if (url.protocol !== 'https:' && !['http://127.0.0.1:3102', 'http://127.0.0.1:3103', 'http://127.0.0.1:3110'].includes(url.origin)) throw new Error('DOCUMENT_COOKIE_ORIGIN_REFUSED')
  return `Path=${cookiePath}; HttpOnly; SameSite=Strict${url.protocol === 'https:' ? '; Secure' : ''}`
}

export function unifiedDocumentCookie(validatedUserToken: string, requestUrl: string, now = Date.now()): string {
  const remaining = Math.min(3600, expiresAt(validatedUserToken) - Math.floor(now / 1000))
  if (remaining <= 0) throw new Error('DOCUMENT_COOKIE_TOKEN_EXPIRED')
  return `${cookieName}=${validatedUserToken}; ${attributes(requestUrl)}; Max-Age=${remaining}`
}

export function clearUnifiedDocumentCookie(requestUrl: string): string {
  return `${cookieName}=; ${attributes(requestUrl)}; Max-Age=0`
}

/** This only converts a narrowly scoped document cookie into a bearer header.
 * The normal Supabase authenticate request MUST still validate the token afterward. */
export function withUnifiedDocumentAuthorization(request: Request, now = Date.now()): Request {
  if (request.headers.has('Authorization') || request.method !== 'GET') return request
  const url = new URL(request.url)
  const inlineBillingDocument = (billingDocument.test(url.pathname) || feeDocument.test(url.pathname))
    && url.searchParams.size === 1 && url.searchParams.get('view') === 'inline'
  const pathContext = contextual.exec(url.pathname)?.[1] ?? feeDocument.exec(url.pathname)?.[1]
  const noteContext = note.test(url.pathname) && url.searchParams.size === 1 ? url.searchParams.get('context') : null
  const financeContext = (finance.test(url.pathname) || billingDocument.test(url.pathname)) && (!url.search || inlineBillingDocument) ? 'administration' : null
  const previewContext = invoicePreview.test(url.pathname) && url.searchParams.size === 1
    && ['invoice', 'receipt'].includes(url.searchParams.get('kind') ?? '') ? 'administration' : null
  const context = pathContext ?? noteContext ?? financeContext ?? previewContext
  if (!['administration', 'clinical'].includes(context ?? '') || (pathContext || financeContext) && url.search && !inlineBillingDocument) return request
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return request
  const origin = request.headers.get('Origin')
  const referer = request.headers.get('Referer')
  if (origin && origin !== url.origin) return request
  try { if (referer && new URL(referer).origin !== url.origin) return request } catch { return request }
  const token = request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  if (!token || expiresAt(token) <= Math.floor(now / 1000)) return request
  const declared = request.headers.get('X-Clinical-Context')
  if (declared && declared !== context) return request
  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('X-Clinical-Context', context!)
  return new Request(request, { headers })
}
