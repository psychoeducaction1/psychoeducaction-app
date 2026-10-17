import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getBearerToken } from '@/lib/superAdminServer'
import { canAccessClinicalNotes } from '@/lib/clinicalNotesAccess'

export async function getClinicalNotesContext(request: NextRequest) {
  const token = getBearerToken(request)
  if (!token) return { error: { message: 'Connexion requise.', status: 401 } } as const
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return { error: { message: 'Configuration indisponible.', status: 500 } } as const
  try {
    const db = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error } = await db.auth.getUser()
    if (error || !user) return { error: { message: 'Session invalide. Reconnectez-vous.', status: 401 } } as const
    const { data: profile, error: profileError } = await db.from('profiles')
      .select('role').eq('id', user.id).limit(1).maybeSingle()
    if (profileError) return { error: { message: 'Impossible de vérifier les droits.', status: 500 } } as const
    if (!canAccessClinicalNotes(user, profile)) {
      return { error: { message: 'Cette section est réservée aux deux comptes du pilote.', status: 403 } } as const
    }
    return { user }
  } catch {
    return { error: { message: 'Section temporairement indisponible. Réessayez.', status: 500 } } as const
  }
}
