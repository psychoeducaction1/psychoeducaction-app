export const PROFESSIONAL_CIVILITIES = ['M.', 'Mme'] as const
export type ProfessionalCivility = (typeof PROFESSIONAL_CIVILITIES)[number]

export function isProfessionalCivility(value: unknown): value is ProfessionalCivility {
  return value === 'M.' || value === 'Mme'
}

export function formatProfessionalName(name: string, civility?: ProfessionalCivility | null) {
  return `${civility ? `${civility} ` : ''}${name.trim()}`
}
