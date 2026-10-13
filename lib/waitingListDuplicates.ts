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
  consultation_reason?: string | null
  first_requester_name?: string | null
  second_requester_name?: string | null
  city?: string | null
  meeting_modality?: string[] | null
  availability?: string | null
  internal_notes?: string | null
}

function normalizedText(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function normalizedSet(values: readonly string[], normalize: (value: string) => string = normalizedText) {
  return [...new Set(values.map(normalize).filter(Boolean))].sort()
}

function emails(client: WaitingListIdentity) {
  return normalizedSet([client.contact_email ?? '', ...(client.contact_emails ?? [])], normalizePublicIntakeEmail)
}

function phones(client: WaitingListIdentity) {
  return normalizedSet([client.contact_phone ?? '', ...(client.contact_phones ?? [])], normalizePublicIntakePhone)
}

const requestFields = [
  'client_name', 'birth_date', 'service_requested', 'consultation_reason',
  'first_requester_name', 'second_requester_name', 'city', 'availability', 'internal_notes',
] as const

function sameSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function findWaitingListDuplicates<T extends WaitingListIdentity>(
  candidate: WaitingListIdentity, clients: readonly T[]
): T[] {
  const candidateEmails = emails(candidate)
  const candidatePhones = phones(candidate)
  // Des champs absents ne prouvent pas une identité. Le nom seul, même avec
  // un contact familial partagé, ne suffit jamais à bloquer une demande.
  if (!normalizedText(candidate.client_name) || !normalizedText(candidate.consultation_reason)
    || (!candidate.birth_date && !candidateEmails.length && !candidatePhones.length)) return []
  return clients.filter((client) => {
    return requestFields.every((field) => normalizedText(client[field]) === normalizedText(candidate[field]))
      && sameSet(candidateEmails, emails(client))
      && sameSet(candidatePhones, phones(client))
      && sameSet(normalizedSet(candidate.meeting_modality ?? []), normalizedSet(client.meeting_modality ?? []))
  })
}

export async function loadWaitingListDuplicateCandidates<T extends WaitingListIdentity>(
  supabase: SupabaseClient, candidate: WaitingListIdentity
): Promise<T[]> {
  const clients: T[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('waiting_list_clients')
      .select('*').order('created_at', { ascending: true }).range(offset, offset + 499)
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
  const matches = await loadWaitingListDuplicateCandidates<T>(supabase, payload)
  if (matches.length) return { created: false, client: matches[0] }
  const { data, error } = await supabase.from('waiting_list_clients')
    .insert(payload).select(columns).limit(1).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('La création du dossier n’a pas été confirmée.')
  return { created: true, client: data as unknown as T }
}
