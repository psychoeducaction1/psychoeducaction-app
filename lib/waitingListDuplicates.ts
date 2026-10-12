import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePublicIntakeEmail, normalizePublicIntakePhone } from '@/lib/publicIntakeValidation'

export type WaitingListIdentity = {
  client_name?: string | null
  birth_date?: string | null
  service_requested?: string | null
  contact_email?: string | null
  contact_emails?: string[] | null
  contact_phone?: string | null
  contact_phones?: string[] | null
}

function normalizedName(value: string | null | undefined) {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function findWaitingListDuplicates<T extends WaitingListIdentity>(
  candidate: WaitingListIdentity, clients: readonly T[]
): T[] {
  const name = normalizedName(candidate.client_name)
  if (!name) return []
  const emails = (client: WaitingListIdentity) =>
    [client.contact_email, ...(client.contact_emails ?? [])].filter(Boolean)
      .map((value) => normalizePublicIntakeEmail(value!)).filter(Boolean)
  const phones = (client: WaitingListIdentity) =>
    [client.contact_phone, ...(client.contact_phones ?? [])].filter(Boolean)
      .map((value) => normalizePublicIntakePhone(value!)).filter((value) => value.length >= 10)
  const candidateEmails = emails(candidate)
  const candidatePhones = phones(candidate)
  return clients.filter((client) => {
    if (normalizedName(client.client_name) !== name) return false
    if (candidate.birth_date && client.birth_date && candidate.birth_date !== client.birth_date) return false
    if (candidate.service_requested && client.service_requested
      && normalizedName(candidate.service_requested) !== normalizedName(client.service_requested)) return false
    return emails(client).some((value) => candidateEmails.includes(value))
      || phones(client).some((value) => candidatePhones.includes(value))
  })
}

export async function loadWaitingListDuplicateCandidates<T extends WaitingListIdentity>(
  supabase: SupabaseClient, candidate: WaitingListIdentity, columns = '*'
): Promise<T[]> {
  const clients: T[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('waiting_list_clients')
      .select(columns).order('created_at', { ascending: true }).range(offset, offset + 499)
    if (error) throw error
    clients.push(...(data ?? []) as unknown as T[])
    if ((data ?? []).length < 500) break
  }
  return findWaitingListDuplicates(candidate, clients)
}

// Les ecritures restent sous la session et les RLS existantes. Une lecture
// fraiche evite de recreer une fiche ajoutee depuis l'ouverture de la page.
export async function createWaitingListClient<T extends WaitingListIdentity & { id: string }>(
  supabase: SupabaseClient, payload: WaitingListIdentity & Record<string, unknown>, columns = '*'
): Promise<{ created: boolean; client: T }> {
  const matches = await loadWaitingListDuplicateCandidates<T>(supabase, payload, columns)
  if (matches.length) return { created: false, client: matches[0] }
  const { data, error } = await supabase.from('waiting_list_clients')
    .insert(payload).select(columns).limit(1).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('La création du dossier n’a pas été confirmée.')
  return { created: true, client: data as unknown as T }
}
