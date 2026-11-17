import { realClinicalConfiguration } from './mandateTransport.ts'
import { mandateDefaultFailure } from '../clinical-mandates/defaultErrors.ts'
import { documentStorageOperation, finishDocumentRpc } from './documentStorage.ts'

/** JWT utilisateur et clé publique uniquement; les droits demeurent dans les RPC. */
export function realClinicalTransport() {
  const { url, anonKey } = realClinicalConfiguration()
  return {
    async authenticate(request: Request): Promise<string | null> {
      const match = /^Bearer ([A-Za-z0-9._~-]{1,8192})$/.exec(request.headers.get('authorization') ?? '')
      if (!match) return null
      const token = match[1]
      const response = await fetch(`${url}/auth/v1/user`, { cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(15_000), headers: { apikey: anonKey, Authorization: `Bearer ${token}` } })
      if (!response.ok) return null
      const user: unknown = await response.json().catch(() => null)
      return user && typeof user === 'object' && 'id' in user && typeof user.id === 'string' ? token : null
    },
    async rpc(name: string, args: Record<string, unknown>, token: string): Promise<unknown> {
      if (!/^clinical_[a-z_]{1,80}(?:_[0-9]{1,3})?$/.test(name)) throw new Error('REAL_CLINICAL_RPC_REFUSED')
      const operation = documentStorageOperation()
      const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', cache: 'no-store',
        redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(operation ? { 'x-clinical-pdf-operation': operation } : {}) },
        body: JSON.stringify(args) })
      const value: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const prerequisite = mandateDefaultFailure(value)
        const error = new Error(prerequisite?.code ?? 'REAL_CLINICAL_RPC_FAILED') as Error & { code?: string }
        error.code = value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' ? value.code : undefined
        throw error
      }
      return finishDocumentRpc(value, url, operation, name)
    },
  }
}
