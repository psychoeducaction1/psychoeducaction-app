import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getBearerToken } from '@/lib/superAdminServer'
import { canAccessClinicalNotes } from '@/lib/clinicalNotesAccess'
import { createDemoSessions } from '@/lib/clinicalNotesDemo'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }

// Lecture du profil avec le JWT utilisateur et les RLS. Aucune cle privilegiee,
// table clinique, sauvegarde, requete IA ou transmission audio dans ce pilote.
export async function GET(request: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers })
  const token = getBearerToken(request)
  if (!token) return reply({ error: 'Connexion requise.' }, 401)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return reply({ error: 'Configuration indisponible.' }, 500)

  try {
    const db = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error } = await db.auth.getUser()
    if (error || !user) return reply({ error: 'Session invalide. Reconnectez-vous.' }, 401)

    const { data: profile, error: profileError } = await db.from('profiles')
      .select('role').eq('id', user.id).limit(1).maybeSingle()
    if (profileError) return reply({ error: 'Impossible de vérifier les droits.' }, 500)
    if (!canAccessClinicalNotes(user, profile)) {
      return reply({ error: 'Cette section est réservée aux deux comptes du pilote.' }, 403)
    }
    return reply({ viewerId: user.id, mode: 'demo', sessions: createDemoSessions() })
  } catch {
    return reply({ error: 'Section temporairement indisponible. Réessayez.' }, 500)
  }
}
