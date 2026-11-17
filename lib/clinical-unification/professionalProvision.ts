import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { assertUnificationPilot } from './isolation.ts'

export type LocalProfessionalAuth = {
  password(actorId: string, key: string, email: string): string
  create(input: { actorId: string; key: string; email: string; fullName: string; password: string }): Promise<string | null>
  invite(email: string, targetId: string, origin: string): Promise<string>
}

/** Construct only AFTER a user-JWT RPC has authorized the administrator.
 * Auth is the sole privileged operation; profile writes still use that user's JWT.
 * No send/invite email operation is exposed by this adapter. */
export function localProfessionalAuth(): LocalProfessionalAuth {
  assertUnificationPilot()
  const url = process.env.PEA_CLINICAL_REAL_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url !== 'http://127.0.0.1:56321' || !key) throw new Error('UNIFICATION_LOCAL_AUTH_REQUIRED')
  const auth = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }) } }).auth.admin
  const fictional = (email: string) => /^[^\s@]+@[^\s@]+\.invalid$/i.test(email)
  return {
    // A retry after the Auth commit uses the same temporary password, without
    // saving a password in SQL, sessionStorage, an artifact or a diagnostic log.
    password(actorId, requestKey, email) { return createHmac('sha256', key).update(JSON.stringify(['professional-provision-v1', actorId, requestKey, email])).digest('base64url') + '!a1' },
    async create(input) {
      if (!fictional(input.email)) throw new Error('FICTIONAL_EMAIL_REQUIRED')
      const result = await auth.createUser({ email: input.email, password: input.password, email_confirm: true,
        user_metadata: { full_name: input.fullName },
        app_metadata: { pea_unification_actor: input.actorId, pea_unification_request: input.key } })
      // An interrupted/concurrent request is resolved by the ownership-checked
      // reservation RPC. Do not print raw Auth errors or delete an existing user.
      return result.error ? null : result.data.user?.id ?? null
    },
    async invite(email, targetId, origin) {
      if (!fictional(email) || origin !== 'http://127.0.0.1:3110') throw new Error('UNIFICATION_LOCAL_AUTH_REQUIRED')
      const { data, error } = await auth.generateLink({ type: 'recovery', email, options: { redirectTo: `${origin}/auth/invitation` } })
      if (error || data.user?.id !== targetId || !data.properties?.action_link) throw new Error('UNIFIED_AUTH_LINK_FAILED')
      const link = new URL(data.properties.action_link)
      if (link.origin !== url || link.pathname !== '/auth/v1/verify') throw new Error('UNIFIED_AUTH_LINK_FAILED')
      return link.href
    },
  }
}
