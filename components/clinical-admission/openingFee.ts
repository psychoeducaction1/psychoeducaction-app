import type { AdmissionUi } from './shared'
import { loadOpeningFeePolicy, saveOpeningFeePolicy } from '@/lib/clinical-finance/durableClient'

export const openingFeeOptions = [
  { value: 'charge', label: 'Nouveau dossier — ajouter 60 $ à la première rencontre' },
  { value: 'waive', label: 'Dossier existant — aucuns frais d’ouverture' },
]

export async function recordOpeningFeeChoice(ui: AdmissionUi, patientId: string, choice: string, reason: string) {
  const actor = { actorId: ui.data.actorId, context: 'administration' as const }
  const current = await loadOpeningFeePolicy(actor, patientId)
  if (current.prepared) return // Une ouverture déjà préparée n'est jamais refacturée à la réassignation.
  const charge = choice === 'charge'
  await saveOpeningFeePolicy(actor, patientId, charge, charge ? '' : reason.trim() || 'Dossier existant confirmé à l’assignation.')
}
