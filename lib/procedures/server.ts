import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { getBearerToken } from '@/lib/superAdminServer'
import { hasPlatformAccess } from '@/lib/platformAccess'
import type { ProcedureAuthorization } from './http'
import type { ProcedureLibrary } from './model'

export async function authorizeProcedures(request: NextRequest): Promise<ProcedureAuthorization> {
  const token = getBearerToken(request)
  if (!token) return { status: 401, error: 'Connectez-vous pour accéder aux procédures.' }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return { status: 503, error: 'Bibliothèque indisponible.' }
  const db = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error: authError } = await db.auth.getUser()
  if (!user || authError) return { status: 401, error: 'Session expirée. Reconnectez-vous.' }
  const profile = await db.from('profiles').select('role,platform_access_enabled').eq('id', user.id).maybeSingle()
  if (profile.error) return { status: 503, error: 'Vérification des accès indisponible.' }
  if (!profile.data || !hasPlatformAccess(profile.data)) return { status: 403, error: 'Accès refusé.' }
  const membership = await db.rpc('procedure_library_access')
  if (membership.error) return { status: 503, error: 'La bibliothèque n’est pas disponible. Contactez la direction.' }
  if (membership.data?.canRead !== true) return { status: 403, error: 'Cet espace est réservé aux personnes autorisées.' }
  const canEdit = membership.data.canEdit === true
  const rpc = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await db.rpc(name, args)
    if (result.error) throw result.error
    return result.data as T
  }
  return { backend: {
    canEdit, homeHref: profile.data.role === 'direction' ? '/administration' : '/clinique',
    load: () => rpc<ProcedureLibrary>('procedure_library_snapshot'),
    saveArticle: value => rpc('procedure_library_save_article', { p_id: value.id, p_section_id: value.sectionId, p_title: value.title, p_body: value.body, p_keywords: value.keywords, p_status: value.status, p_expected_version: value.expectedVersion }),
    saveSection: value => rpc('procedure_library_save_section', { p_id: value.id, p_title: value.title, p_expected_version: value.expectedVersion }),
  } }
}
