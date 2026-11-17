import type { MandateHttpDependencies } from './mandateHttp'
import { isRealLocalRehearsal } from './runtimeIsolation.ts'
import { documentStorageOperation, finishDocumentRpc } from './documentStorage.ts'

const tokenPattern = /^[A-Za-z0-9._~-]{1,8192}$/
function publicKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) return true
  const parts = key.split('.')
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'anon' }
  catch { return false }
}
export function realClinicalConfiguration() {
  const url = process.env.PEA_CLINICAL_REAL_SUPABASE_URL
  const anonKey = process.env.PEA_CLINICAL_REAL_ANON_KEY
  if (process.env.PEA_CLINICAL_RUNTIME !== 'real-db' || !url || !anonKey
    || (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && !isRealLocalRehearsal(process.env))
    || !tokenPattern.test(anonKey) || !publicKey(anonKey)) throw new Error('REAL_MANDATE_RUNTIME_REFUSED')
  return { url, anonKey }
}
async function fetchJson(url: string, options: RequestInit): Promise<{ response: Response; data: unknown }> {
  const response = await fetch(url, { ...options, cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(15000) })
  let data: unknown = null
  try { data = await response.json() } catch { /* Response validation below. */ }
  return { response, data }
}
export function realMandateDependencies(): MandateHttpDependencies {
  const { url, anonKey } = realClinicalConfiguration()
  return {
    ...((process.env.PEA_UNIFICATION_PILOT === 'true' || process.env.PEA_CONTROLLED_MERGE === 'true') ? { async archiveSignedPdf(source: unknown) {
      const { archiveUnifiedSignedPdf } = await import('../clinical-unification/mandateSignedArchive.ts')
      return archiveUnifiedSignedPdf(source)
    } } : {}),
    signatureBaseUrl: process.env.PEA_REMOTE_SIGNATURE_BASE_URL ?? '',
    async authenticate(request) {
      const match = /^Bearer ([A-Za-z0-9._~-]{1,8192})$/.exec(request.headers.get('authorization') ?? '')
      if (!match) return null
      const token = match[1]
      const { response, data } = await fetchJson(`${url}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      })
      return response.ok && data && typeof data === 'object' && 'id' in data
        && typeof data.id === 'string' ? token : null
    },
    async rpc(name, args, token) {
      const operation = documentStorageOperation()
      const { response, data } = await fetchJson(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json', ...(operation ? { 'x-clinical-pdf-operation': operation } : {}) }, body: JSON.stringify(args),
      })
      if (!response.ok) {
        const failure = data && typeof data === 'object' ? data as Record<string, unknown> : {}
        const error = new Error('REAL_MANDATE_RPC_FAILED') as Error & { code?: string }
        error.code = typeof failure.code === 'string' ? failure.code : undefined
        throw error
      }
      return finishDocumentRpc(data, url, operation, name)
    },
    async rpcPublic(name, args) {
      const operation = documentStorageOperation()
      const { response, data } = await fetchJson(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json', ...(operation ? { 'x-clinical-pdf-operation': operation } : {}) }, body: JSON.stringify(args),
      })
      if (!response.ok) {
        const failure = data && typeof data === 'object' ? data as Record<string, unknown> : {}
        const error = new Error('REAL_MANDATE_PORTAL_FAILED') as Error & { code?: string }
        error.code = typeof failure.code === 'string' ? failure.code : undefined
        throw error
      }
      return finishDocumentRpc(data, url, operation, name)
    },
    async sendInvitation(to, link) {
      const allowed = process.env.PEA_REMOTE_SIGNATURE_TEST_RECIPIENT?.trim().toLowerCase()
      const apiKey = process.env.RESEND_API_KEY
      const from = process.env.RESEND_FROM_EMAIL
      if (process.env.PEA_REMOTE_SIGNATURE_TEST_DELIVERY !== '1'
        || !allowed || to !== allowed || !apiKey || !from
        || !/^https:\/\/[^/?#]+\/signature-convention#jeton=/.test(link))
        throw new Error('REMOTE_SIGNATURE_DELIVERY_REFUSED')
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject: 'Convention de consentement à signer',
          text: `Bonjour,\n\nVeuillez lire et signer votre convention de consentement avec ce lien personnel, valide 24 heures :\n${link}\n\nSi vous n'attendiez pas ce document, ignorez ce message.\n\nClinique PsychoÉducAction` }),
      })
      if (!response.ok) throw new Error('REMOTE_SIGNATURE_DELIVERY_FAILED')
    },
  }
}
