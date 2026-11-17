/** Additive rights from the server-owned profiles column; never from user_metadata. */
export type AdministrativeAccessProfile = {
  role?: string | null
  administrative_access?: string | null
  platform_access_enabled?: boolean | null
}
export function hasDirectionAccess<T extends AdministrativeAccessProfile>(profile: T | null | undefined): profile is T & ({ role: 'direction' } | { administrative_access: 'direction' | 'super_admin' }) {
  return Boolean(profile && profile.platform_access_enabled !== false && (
    profile.role === 'direction' || profile.administrative_access === 'direction' || profile.administrative_access === 'super_admin'
  ))
}
export function hasAdditionalSuperAdminAccess(profile: AdministrativeAccessProfile | null | undefined): boolean {
  return Boolean(profile && profile.platform_access_enabled !== false && profile.administrative_access === 'super_admin')
}
