import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { type NextRequest } from 'next/server'
import { getBearerToken } from '@/lib/superAdminServer'
import { canAccessClinicalCoordination, isClinicalCoordinationManager, type ClinicalCoordinationStaff } from '@/lib/clinicalCoordinationAccess'
import { hasPlatformAccess } from '@/lib/platformAccess'

export async function getClinicalCoordinationContext(request: NextRequest) {
  const token = getBearerToken(request)
  if (!token) return { error: 'Session requise.', status: 401 } as const
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return { error: 'Service indisponible.', status: 503 } as const
  // Toujours la session de l'appelant : les RLS restent effectives.
  const db = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error: authError } = await db.auth.getUser()
  if (!user || authError) return { error: 'Session invalide.', status: 401 } as const
  const { data: profile, error: profileError } = await db.from('profiles').select('role, full_name, platform_access_enabled').eq('id', user.id).maybeSingle()
  if (profileError) return { error: 'Vérification des accès impossible.', status: 503 } as const
  if (!profile || !hasPlatformAccess(profile)) return { error: 'Accès refusé.', status: 403 } as const
  const isManager = isClinicalCoordinationManager(user, profile)
  if (!isManager && profile.role !== 'professionnel') return { error: 'Accès refusé.', status: 403 } as const
  let query = db.from('clinical_coordination_staff').select('id, profile_id, full_name, email, is_active').eq('is_active', true)
  if (!isManager) query = query.eq('profile_id', user.id)
  const { data, error } = await query.maybeSingle()
  if (error) return { error: 'Espace temporairement indisponible.', status: 503 } as const
  const staff = data as ClinicalCoordinationStaff | null
  if (!canAccessClinicalCoordination(user, profile, staff)) return { error: 'Accès refusé.', status: 403 } as const
  return { context: { db, user, profile, isManager, staff } } as const
}
