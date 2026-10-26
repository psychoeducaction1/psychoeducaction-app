import type { ProfessionalStructuredPreferencesRow } from '@/lib/professionalPreferences'
import { getAssignmentRequestMetrics } from '@/app/professionnel/shared'

export const clinicalOverviewViews = ['dashboard', 'waiting-list', 'preferences'] as const
export type ClinicalOverviewView = typeof clinicalOverviewViews[number]
export type OverviewProfessional = ProfessionalStructuredPreferencesRow & {
  id: string
  full_name: string | null
  professional_title: string | null
}
export type OverviewRequest = {
  id: string
  professional_id: string
  is_active: boolean | null
  requested_count: number | null
  request_comment: string | null
  created_at: string | null
  accepted_count: number
  occupied_count: number
}
export type OverviewAssignmentStats = {
  professional_id: string
  active_count: number
  pending_count: number
  refused_count: number
}
export type OverviewWaitingClient = {
  id: string
  created_at: string | null
  contact_date: string | null
  client_name: string | null
  birth_date: string | null
  priority_level: string | null
  service_requested: string | null
  city: string | null
  meeting_modality: string[] | null
  availability: string | null
  consultation_reason: string | null
}
export type ClinicalOverviewData = {
  professionals?: OverviewProfessional[]
  requests?: OverviewRequest[]
  assignmentStats?: OverviewAssignmentStats[]
  waitingList?: OverviewWaitingClient[]
  waitingStats?: { waiting: number; urgent: number }
}

// Même règle que le dashboard direction : seules les confirmations comptent
// comme services pris; les refus et annulations ne consomment pas une place.
export function buildClinicalDashboard(data: ClinicalOverviewData) {
  return (data.professionals ?? []).map(professional => {
    const requests = (data.requests ?? []).filter(r => r.professional_id === professional.id)
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    const metrics = (r: OverviewRequest) => getAssignmentRequestMetrics({
      isActive: r.is_active, requestedCount: r.requested_count,
      acceptedCount: r.accepted_count, occupiedCount: r.occupied_count,
      remainingCount: Math.max((r.requested_count ?? 0) - r.occupied_count, 0),
    })
    const request = requests.find(r => metrics(r).isActive)
      ?? requests.find(r => metrics(r).isCompleted) ?? requests[0]
    const current = request ? metrics(request) : null
    const stats = data.assignmentStats?.find(s => s.professional_id === professional.id)
    return {
      id: professional.id, name: professional.full_name || 'Nom non renseigné',
      requested: current?.requestedCount ?? 0,
      remaining: current?.isActive ? current.remainingCount : 0,
      status: current?.isActive ? 'Demande active' : current?.isCompleted ? 'Complétée' : 'Aucune demande active',
      comment: request?.request_comment?.trim() || '',
      active: Number(stats?.active_count ?? 0), pending: Number(stats?.pending_count ?? 0),
      refused: Number(stats?.refused_count ?? 0),
    }
  })
}
