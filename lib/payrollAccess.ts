import { normalizeEmail, isSuperAdmin } from '@/lib/superAdmin'

export const PAYROLL_ACCESS_EMAILS = [
  'fz.benlahcen@gmail.com',
  'hrahajar@gmail.com',
]

export const ADMINISTRATIVE_PAYROLL_ACCESS_EMAILS = [
  'contact@psychoeducaction.com',
  'hrahajar@gmail.com',
]

export type PayrollAccessUser = {
  email?: string | null
}

export type PayrollAccessProfile = {
  role?: string | null
}

export function isPayrollAuthorized(
  user: PayrollAccessUser | null | undefined,
  profile?: PayrollAccessProfile | null
): boolean {
  if (isSuperAdmin(user, profile)) return true

  const normalizedEmail = normalizeEmail(user?.email)

  return (
    PAYROLL_ACCESS_EMAILS.includes(normalizedEmail) &&
    (!profile || profile.role === 'direction')
  )
}

export function isAdministrativePayrollAuthorized(
  user: PayrollAccessUser | null | undefined,
  profile?: PayrollAccessProfile | null
): boolean {
  if (isSuperAdmin(user, profile)) return true

  return ADMINISTRATIVE_PAYROLL_ACCESS_EMAILS.includes(
    normalizeEmail(user?.email)
  )
}
