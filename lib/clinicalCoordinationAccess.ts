import { isSuperAdmin } from '@/lib/superAdmin'
import { hasPlatformAccess } from '@/lib/platformAccess'

export type ClinicalCoordinationStaff = {
  id: string
  profile_id: string
  full_name: string
  email: string
  is_active: boolean
}

export function isClinicalCoordinationManager(user: { id?: string; email?: string | null } | null,
  profile: { role?: string | null; platform_access_enabled?: boolean | null } | null) {
  return Boolean(user?.id && profile && hasPlatformAccess(profile) && isSuperAdmin(user, profile))
}

export function canAccessClinicalCoordination(user: { id?: string; email?: string | null } | null,
  profile: { role?: string | null; platform_access_enabled?: boolean | null } | null,
  staff?: ClinicalCoordinationStaff | null) {
  if (!user?.id || !profile || !hasPlatformAccess(profile)) return false
  if (isClinicalCoordinationManager(user, profile)) return true
  return profile.role === 'professionnel' && staff?.is_active === true && staff.profile_id === user.id
}
