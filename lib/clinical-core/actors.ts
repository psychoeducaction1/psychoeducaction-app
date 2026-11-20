import type { FixtureActor } from './types'

export const CLINICAL_FIXTURE_ACTORS: readonly FixtureActor[] = [
  { id: '11111111-1111-4111-8111-111111111111', displayName: 'Direction fictive', role: 'admin', permissions: ['manage_clinical_access'], capabilities: ['administration'] },
  { id: '22222222-2222-4222-8222-222222222222', displayName: 'Adjointe fictive', role: 'assistant', permissions: ['manage_clinical_access'], capabilities: ['administration'] },
  { id: '33333333-3333-4333-8333-333333333333', displayName: 'Camille — professionnelle fictive', role: 'professional', permissions: [], capabilities: ['practice'] },
  { id: '44444444-4444-4444-8444-444444444444', displayName: 'Sam — supervision fictive', role: 'supervisor', permissions: [], capabilities: ['practice', 'supervision'] },
  { id: '55555555-5555-4555-8555-555555555555', displayName: 'Compte à double fonction fictif', role: 'admin', permissions: ['manage_clinical_access'], capabilities: ['administration', 'practice'] },
]
