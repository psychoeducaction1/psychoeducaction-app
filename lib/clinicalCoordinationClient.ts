import { supabase } from '@/lib/supabaseClient'
import type { ClinicalCoordinationStaff } from '@/lib/clinicalCoordinationAccess'

type AccessContext = { isManager: boolean; name: string; staff: ClinicalCoordinationStaff | null }
export async function loadClinicalCoordinationAccess(): Promise<{ context?: AccessContext; error: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return { error: 'Veuillez vous connecter.' }
    const response = await fetch('/api/coordination-clinique/context', { cache: 'no-store', headers: { Authorization: `Bearer ${session.access_token}` } })
    const payload = await response.json()
    return response.ok ? { context: payload, error: '' } : { error: payload.error ?? 'Accès refusé.' }
  } catch { return { error: 'Espace temporairement indisponible. Réessayez.' } }
}
