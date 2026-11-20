import { actorIdOf, canAdmin, hasCapability, resolveActor } from '@/lib/clinical-core/capabilities'
import type { ClinicalActorInput } from '@/lib/clinical-core/types'
import { BillingError } from './types.ts'
import { CLINICAL_FIXTURE_ACTORS, getClinicalFixtureService } from '@/lib/clinical-core/fixtures'
import { getCalendarFixtureServiceForActor } from '@/lib/clinical-calendar/fixtures'
import { calculateProfessionalCompensation } from '@/lib/professionalCompensation'
import { createBillingStore, createClinicalFinanceService } from './service.ts'
import type { BillingDirectory, BillingStore, FeeQuote } from './types.ts'

const now = () => new Date('2026-10-17T12:00:00.000Z')

function directoryFor(actorId: ClinicalActorInput): BillingDirectory {
  const core = getClinicalFixtureService()
  const actor = CLINICAL_FIXTURE_ACTORS.find(value => value.id === actorIdOf(actorId))
  if (!actor) throw new BillingError('FORBIDDEN', 'Compte de démonstration non autorisé.', 403)
  let active: ReturnType<typeof resolveActor<typeof actor>>
  try { active = resolveActor(actor, actorId) } catch { throw new BillingError('FORBIDDEN', 'Contexte de démonstration non autorisé.', 403) }
  const administrative = canAdmin(active)
  // Une lecture sous l'acteur courant seulement; aucun emprunt d'identité pour calculer les honoraires.
  const clients = administrative ? core.listClients(actorId).map(value => ({ id: value.id, name: `${value.firstName} ${value.lastName}`,
    payers: value.payers.map(payer => ({ id: payer.id, clientId: payer.clientId, name: payer.fullName, email: payer.email, type: payer.payerType })) }))
    : core.getSchedulingDirectory(actorId).clients.map(value => ({ id: value.id, name: `${value.firstName} ${value.lastName}`, payers: [] }))
  const appointments = getCalendarFixtureServiceForActor(actorId).getBillingAppointments(actorId)
  return { actors: () => CLINICAL_FIXTURE_ACTORS.map(value => ({ id: value.id, role: value.role, name: value.displayName, capabilities: value.capabilities })), clientsFor: () => clients, appointmentsFor: () => appointments }
}
const quoteFee: FeeQuote = input => {
  const actor = CLINICAL_FIXTURE_ACTORS.find(value => value.id === input.professionalId)
  if (!actor || !hasCapability(actor, 'practice')) throw new Error('Contrat fictif absent.')
  const quote = calculateProfessionalCompensation({ professional: { id: actor.id, fullName: actor.displayName, email: null,
    payrollCategory: hasCapability(actor, 'supervision') ? 'psychotherapeute' : 'psychoeducateur_membre_ordre', professionalAddress: null, professionalPhone: null, professionalTitle: null },
    lineType: 'rencontre', clientAmount: input.clientAmountCents / 100, durationHours: input.durationMinutes / 60, weeklyMeetingCount: input.weeklyCompletedMeetings })
  return Math.round((quote.professionalPay + Number.EPSILON) * 100)
}
/** Simulation sans paie réelle, sans facture envoyée ni moyen de paiement. Appeler après le triple verrou. */
export function getFinanceFixtureServiceForActor(actorId: ClinicalActorInput) {
  const runtime = globalThis as typeof globalThis & { __peaClinicalBillingStoreV1?: BillingStore }
  const store = runtime.__peaClinicalBillingStoreV1 ??= createBillingStore({ rates: [{ id: '72000000-0000-4000-8000-000000000001', serviceCode: 'consultation', effectiveFrom: '2026-01-01', hourlyClientCents: 18_000, currency: 'CAD', createdAt: now().toISOString() }] })
  return createClinicalFinanceService({ store, directory: directoryFor(actorId), quoteFee, now })
}
