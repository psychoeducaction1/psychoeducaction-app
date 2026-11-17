import { CLINICAL_FIXTURE_ACTORS } from '@/lib/clinical-core/actors'
import type { FixtureActor } from './types'

export type ClinicalFixtureEnvironment = { [key: string]: string | undefined; PEA_CLINICAL_FIXTURES?: string; PEA_ISOLATED_DEVELOPMENT?: string; NEXT_PUBLIC_SUPABASE_URL?: string }
export function isClinicalFixtureEnabled(environment: ClinicalFixtureEnvironment = process.env): boolean {
  if (environment.PEA_CLINICAL_FIXTURES !== 'true' || environment.PEA_ISOLATED_DEVELOPMENT !== 'true') return false
  try {
    const url = new URL(environment.NEXT_PUBLIC_SUPABASE_URL ?? '')
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password
  } catch { return false }
}
export function getClinicalFixtureActor(actorId: string | null): FixtureActor | null {
  return structuredClone(CLINICAL_FIXTURE_ACTORS.find(actor => actor.id === actorId) ?? null)
}
