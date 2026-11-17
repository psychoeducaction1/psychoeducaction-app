import type { ClinicalActorInput } from '../clinical-core/types'
import { commandAdmission } from '../clinical-admission/client'
import { clinicalRequest } from '../clinical-workspace/api'
import { isUnifiedClinicalClient } from './authClient'

export type CapacityOfferInput = {
  requestedCount: number
  offerSlots: { day: string; startMinute: number; endMinute: number }[]
  schedulePreference: 'grouped' | 'spread' | 'flexible' | 'other'
  comment: string
}

/** The original dialog keeps its UI; the unified pilot writes the existing
 * assignment_requests flow, never the laboratory admission mirror. */
export async function submitCapacityOffer(actor: ClinicalActorInput, input: CapacityOfferInput): Promise<void> {
  if (!isUnifiedClinicalClient()) { await commandAdmission(actor, 'capacities.create', null, input); return }
  await clinicalRequest(actor, '/capacity-offers', input, 'POST', undefined, 'clinical', value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const data = value as Record<string, unknown>
    const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
    return Object.keys(data).length === 3 && typeof data.id === 'string' && uuid.test(data.id)
      && typeof data.assignmentRequestId === 'string' && uuid.test(data.assignmentRequestId)
      && data.requestedCount === input.requestedCount
  })
}
