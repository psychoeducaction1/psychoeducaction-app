export const SUPER_ADMIN_EMAIL = 'contact@psychoeducaction.com'

export type SuperAdminUser = {
  email?: string | null
}

export type SuperAdminProfile = {
  role?: string | null
}

export function normalizeEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

export function isSuperAdmin(
  user: SuperAdminUser | null | undefined,
  profile?: SuperAdminProfile | null
): boolean {
  return (
    normalizeEmail(user?.email) === SUPER_ADMIN_EMAIL &&
    (!profile || profile.role === 'direction')
  )
}
