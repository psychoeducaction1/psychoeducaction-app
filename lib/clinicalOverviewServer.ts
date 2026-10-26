import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { getBearerToken } from '@/lib/superAdminServer'
import { hasPlatformAccess } from '@/lib/platformAccess'
import { canAccessClinicalCoordination, type ClinicalCoordinationStaff } from '@/lib/clinicalCoordinationAccess'

export async function getClinicalOverviewContext(request: NextRequest) {
  const token = getBearerToken(request)
  if (!token) return { error: 'Session requise.', status: 401 } as const
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return { error: 'Service indisponible.', status: 503 } as const
  const db = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error } = await db.auth.getUser()
  if (error || !user) return { error: 'Session invalide.', status: 401 } as const
  const { data: profile, error: profileError } = await db.from('profiles').select('role, platform_access_enabled').eq('id', user.id).maybeSingle()
  if (profileError) return { error: 'Vérification des accès impossible.', status: 503 } as const
  if (!profile || !hasPlatformAccess(profile)) return { error: 'Accès refusé.', status: 403 } as const
  // Les comptes direction conservent leur consultation habituelle. Aucun rôle
  // direction n'est attribué à la coordinatrice et aucune API de mutation ouverte.
  if (profile.role === 'direction') return { context: { db } } as const
  if (profile.role !== 'professionnel') return { error: 'Accès refusé.', status: 403 } as const
  const { data: staff, error: staffError } = await db.from('clinical_coordination_staff')
    .select('id, profile_id, full_name, email, is_active').eq('profile_id', user.id).eq('is_active', true).maybeSingle()
  if (staffError) return { error: 'Espace temporairement indisponible.', status: 503 } as const
  if (!canAccessClinicalCoordination(user, profile, staff as ClinicalCoordinationStaff | null)) return { error: 'Accès refusé.', status: 403 } as const
  return { context: { db } } as const
}
