import { normalizeEmail } from '@/lib/superAdmin'

export const ADMINISTRATIVE_TASK_NOTIFICATION_EMAIL =
  'contact@psychoeducaction.com'

export const ADMINISTRATIVE_TASK_USERS = {
  hajar: {
    label: 'Hajar',
    emails: ['hrahajar@gmail.com'],
  },
  fatima: {
    label: 'Fatima Zahra',
    emails: ['fz.benlahcen@gmail.com'],
  },
} as const

export type AdministrativeTaskAssignee =
  | keyof typeof ADMINISTRATIVE_TASK_USERS
  | 'both'

export function isAdministrativeTaskAuthorized(
  user: { email?: string | null } | null | undefined,
  profile?: { role?: string | null } | null
) {
  if (profile?.role === 'direction') return true

  const email = normalizeEmail(user?.email)
  return (
    email === ADMINISTRATIVE_TASK_NOTIFICATION_EMAIL ||
    Object.values(ADMINISTRATIVE_TASK_USERS).some((member) =>
      member.emails.some((memberEmail) => memberEmail === email)
    )
  )
}

export function getAdministrativeTaskAssigneesForEmail(
  emailValue: string | null | undefined
): AdministrativeTaskAssignee[] {
  const email = normalizeEmail(emailValue)

  if (email === ADMINISTRATIVE_TASK_NOTIFICATION_EMAIL) {
    return ['hajar', 'fatima', 'both']
  }

  const assignees = Object.entries(ADMINISTRATIVE_TASK_USERS)
    .filter(([, member]) =>
      member.emails.some((memberEmail) => memberEmail === email)
    )
    .map(([key]) => key as AdministrativeTaskAssignee)

  return [...assignees, 'both']
}

export function getAdministrativeTaskAssigneeLabel(
  assignee: AdministrativeTaskAssignee
) {
  if (assignee === 'both') return 'Hajar et Fatima Zahra'
  return ADMINISTRATIVE_TASK_USERS[assignee].label
}
