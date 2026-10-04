export const PUBLIC_INTAKE_MODALITIES = [
  'telehealth',
  'montreal',
  'longueuil',
  'home',
] as const

export type PublicIntakeModality = (typeof PUBLIC_INTAKE_MODALITIES)[number]
export type PublicIntakeContactType = 'scheduled_call' | 'rapid_callback'
export type PublicIntakeRequestType = 'self' | 'child_or_teen' | 'other'

export type PublicIntakePayload = {
  firstName: string
  lastName: string
  birthDate: string | null
  phone: string
  email: string
  requestType: PublicIntakeRequestType
  requesterNames: string[]
  modalities: PublicIntakeModality[]
  address: string | null
  city: string | null
  postalCode: string | null
  consultationReason: string | null
  contactType: PublicIntakeContactType
  provenance: string
  utm: Record<string, string>
  normalizedEmail: string
  normalizedPhone: string
}

const modalityLabels: Record<PublicIntakeModality, string> = {
  telehealth: 'Visioconférence',
  montreal: 'Présentiel — bureau de Montréal',
  longueuil: 'Présentiel — bureau de Longueuil',
  home: 'À domicile',
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength)
}

export function normalizePublicIntakeEmail(value: string) {
  return value.trim().toLowerCase()
}

export function normalizePublicIntakePhone(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

export function modalityLabelsForDatabase(modalities: PublicIntakeModality[]) {
  return modalities.map((modality) => modalityLabels[modality])
}

export function validatePublicIntakePayload(
  value: unknown,
  expectedContactType?: PublicIntakeContactType
): { data?: PublicIntakePayload; error?: string } {
  if (!value || typeof value !== 'object') {
    return { error: 'Le contenu de la demande est invalide.' }
  }

  const input = value as Record<string, unknown>
  const firstName = cleanText(input.firstName, 80)
  const lastName = cleanText(input.lastName, 80)
  const phone = cleanText(input.phone, 40)
  const email = cleanText(input.email, 254)
  const birthDate = cleanText(input.birthDate, 10) || null
  const requestType = cleanText(input.requestType, 30) as PublicIntakeRequestType
  const contactType = cleanText(input.contactType, 30) as PublicIntakeContactType
  const modalities = Array.isArray(input.modalities)
    ? [...new Set(input.modalities.filter((item): item is PublicIntakeModality =>
        typeof item === 'string' &&
        PUBLIC_INTAKE_MODALITIES.includes(item as PublicIntakeModality)
      ))]
    : []
  const requesterNames = Array.isArray(input.requesterNames)
    ? input.requesterNames
        .map((item) => cleanText(item, 160))
        .filter(Boolean)
        .slice(0, 2)
    : []
  const address = cleanText(input.address, 240) || null
  const city = cleanText(input.city, 100) || null
  const postalCode = cleanText(input.postalCode, 12).toUpperCase() || null
  const consultationReason = cleanText(input.consultationReason, 1000) || null
  const provenance = cleanText(input.provenance, 120) || 'Site web'
  const normalizedEmail = normalizePublicIntakeEmail(email)
  const normalizedPhone = normalizePublicIntakePhone(phone)

  if (!firstName || !lastName) return { error: 'Le prénom et le nom sont requis.' }
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    return { error: 'L’adresse courriel est invalide.' }
  }
  if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    return { error: 'Le numéro de téléphone est invalide.' }
  }
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return { error: 'La date de naissance est invalide.' }
  }
  if (!['self', 'child_or_teen', 'other'].includes(requestType)) {
    return { error: 'Le type de demande est invalide.' }
  }
  if (requestType !== 'self' && requesterNames.length === 0) {
    return { error: 'Le nom du requérant est requis.' }
  }
  if (modalities.length === 0) {
    return { error: 'Sélectionnez au moins une modalité.' }
  }
  if (modalities.includes('home') && (!address || !city || !postalCode)) {
    return { error: 'L’adresse complète est requise pour les rencontres à domicile.' }
  }
  if (!['scheduled_call', 'rapid_callback'].includes(contactType)) {
    return { error: 'Le type de contact est invalide.' }
  }
  if (expectedContactType && contactType !== expectedContactType) {
    return { error: 'Le type de contact ne correspond pas à cette action.' }
  }

  const rawUtm = input.utm && typeof input.utm === 'object'
    ? input.utm as Record<string, unknown>
    : {}
  const utm = Object.fromEntries(
    ['source', 'medium', 'campaign', 'term', 'content']
      .map((key) => [key, cleanText(rawUtm[key], 120)] as const)
      .filter(([, item]) => Boolean(item))
  )

  return {
    data: {
      firstName,
      lastName,
      birthDate,
      phone,
      email: normalizedEmail,
      requestType,
      requesterNames,
      modalities,
      address,
      city,
      postalCode,
      consultationReason,
      contactType,
      provenance,
      utm,
      normalizedEmail,
      normalizedPhone,
    },
  }
}

export function validateIdempotencyKey(value: string | null) {
  const key = value?.trim() ?? ''
  return /^[A-Za-z0-9._:-]{16,128}$/.test(key) ? key : null
}
