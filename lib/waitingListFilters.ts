type SpecialProgramClient = {
  service_requested?: string | null
  consultation_reason?: string | null
  internal_notes?: string | null
  availability?: string | null
  first_requester_name?: string | null
  second_requester_name?: string | null
}

export function hasSpecialProgramMarker(client: SpecialProgramClient) {
  const searchableText = [
    client.service_requested,
    client.consultation_reason,
    client.internal_notes,
    client.availability,
    client.first_requester_name,
    client.second_requester_name,
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return /\b(ivac|pae|cnesst)\b/.test(searchableText)
}
