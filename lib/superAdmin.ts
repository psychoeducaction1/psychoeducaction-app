import { hasAdditionalSuperAdminAccess, type AdministrativeAccessProfile } from './administrativeAccess.ts'
export const SUPER_ADMIN_EMAIL = 'contact@psychoeducaction.com'

export type SuperAdminUser = {
  email?: string | null
}

export type SuperAdminProfile = AdministrativeAccessProfile

export function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

export function isSuperAdmin(
  user: SuperAdminUser | null | undefined,
  profile?: SuperAdminProfile | null
): boolean {
  if (!user || profile?.platform_access_enabled === false) return false
  if (hasAdditionalSuperAdminAccess(profile)) return true
  return (
    normalizeEmail(user?.email) === SUPER_ADMIN_EMAIL &&
    (!profile || profile.role === 'direction')
  )
}
