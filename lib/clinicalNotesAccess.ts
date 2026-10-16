import { isSuperAdmin } from '@/lib/superAdmin'

// Compte professionnel pilote verifie dans Auth; jamais une correspondance de nom.
export const CLINICAL_NOTES_PILOT_USER_ID = '3c514611-b530-4f48-84e4-32871b32f320'

export function canAccessClinicalNotes(
  user: { id?: string; email?: string | null } | null | undefined,
  profile: { role?: string | null } | null | undefined
) {
  if (!user || !profile) return false
  return isSuperAdmin(user, profile) || (
    user.id === CLINICAL_NOTES_PILOT_USER_ID && profile.role === 'professionnel'
  )
}
