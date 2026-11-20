import type { AssignedClient, AssignmentRequest } from '@/app/professionnel/shared'
import type { ProfessionalStructuredPreferencesRow } from '@/lib/professionalPreferences'

export type ProfessionalPreview = {
  professional: ProfessionalStructuredPreferencesRow & { id: string; full_name: string | null; email: string | null; platform_access_enabled: boolean | null }
  assignments: AssignedClient[]
  requests: (AssignmentRequest & { created_at: string | null })[]
}
export const professionalPreviewSections = [
  ['dashboard', 'Tableau de bord'], ['assignments', 'Mes assignations'],
  ['request', 'Ma demande'], ['history', 'Historique'], ['preferences', 'Mes préférences'],
] as const
export type ProfessionalPreviewSection = typeof professionalPreviewSections[number][0]
