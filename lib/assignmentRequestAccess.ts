import { isSuperAdmin, normalizeEmail } from '@/lib/superAdmin'

export const ASSIGNMENT_REQUEST_MANAGER_EMAILS = [
  'hrahajar@gmail.com',
  'fz.benlahcen@gmail.com',
]

export function canManageProfessionalAssignmentRequests(
  user: { email?: string | null } | null | undefined,
  profile?: { role?: string | null } | null
): boolean {
  if (isSuperAdmin(user, profile)) return true

  return (
    profile?.role === 'direction' &&
    ASSIGNMENT_REQUEST_MANAGER_EMAILS.includes(normalizeEmail(user?.email))
  )
}
