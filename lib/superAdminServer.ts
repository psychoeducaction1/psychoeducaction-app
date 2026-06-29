import 'server-only'

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isSuperAdmin } from '@/lib/superAdmin'

export type SuperAdminContext = {
  user: {
    id: string
    email?: string | null
  }
  profile: {
    role: string | null
    full_name: string | null
    email: string | null
  }
}

export function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''

  if (!authorization.toLowerCase().startsWith('bearer ')) return ''

  return authorization.slice('bearer '.length).trim()
}

export async function getSuperAdminContext(
  request: NextRequest
): Promise<
  | { context: SuperAdminContext; error?: never }
  | { context?: never; error: { message: string; status: number } }
> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      error: {
        message: 'Configuration Supabase publique manquante côté serveur.',
        status: 500,
      },
    }
  }

  const accessToken = getBearerToken(request)

  if (!accessToken) {
    return { error: { message: 'Non autorisé.', status: 401 } }
  }

  const supabaseServer = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const {
    data: { user },
    error: userError,
  } = await supabaseServer.auth.getUser()

  if (userError || !user) {
    return {
      error: { message: 'Utilisateur connecté introuvable.', status: 401 },
    }
  }

  const { data: profile, error: profileError } = await supabaseServer
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .limit(1)
    .maybeSingle()

  if (profileError) {
    return { error: { message: profileError.message, status: 500 } }
  }

  if (!isSuperAdmin(user, profile)) {
    return { error: { message: 'Action réservée au super administrateur.', status: 403 } }
  }

  return {
    context: {
      user,
      profile: profile ?? {
        role: null,
        full_name: null,
        email: null,
      },
    },
  }
}
