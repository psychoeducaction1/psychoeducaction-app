import type { SupabaseClient } from '@supabase/supabase-js'

export type MessageSenderRole = 'direction' | 'professionnel'

export type InternalMessage = {
  id: string
  professional_id: string
  sender_id: string
  sender_role: MessageSenderRole
  sender_name: string | null
  body: string
  created_at: string
  read_at: string | null
}

export const internalMessageSelect =
  'id, professional_id, sender_id, sender_role, sender_name, body, created_at, read_at'

export async function getUnreadCountForProfessional(
  supabase: SupabaseClient,
  professionalId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('internal_messages')
    .select('id', { count: 'exact', head: true })
    .eq('professional_id', professionalId)
    .eq('sender_role', 'direction')
    .is('read_at', null)

  if (error) {
    console.error('[internal-messages] Échec du comptage des non-lus:', error.message)
    return 0
  }

  return count ?? 0
}

export async function getUnreadCountForDirection(
  supabase: SupabaseClient
): Promise<number> {
  const { count, error } = await supabase
    .from('internal_messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender_role', 'professionnel')
    .is('read_at', null)

  if (error) {
    console.error('[internal-messages] Échec du comptage des non-lus:', error.message)
    return 0
  }

  return count ?? 0
}
