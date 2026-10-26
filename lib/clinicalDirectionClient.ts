import { supabase } from '@/lib/supabaseClient'

export type ClinicalDirectionView = 'direction-dashboard' | 'direction-waiting-list'
export async function loadClinicalDirectionPage<T>(view: ClinicalDirectionView): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Veuillez vous connecter.')
  const response = await fetch(`/api/clinical-overview?view=${view}`, {
    cache: 'no-store', headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Consultation indisponible.')
  return payload as T
}
