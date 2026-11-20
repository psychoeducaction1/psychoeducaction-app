import { isStagingClinicalRuntime } from '@/lib/clinical-staging/runtime'

/** Server-only credentials, scoped to the isolated fictional staging project. */
export function stagingNoteAiKey(environment: Record<string, string | undefined> = process.env): string {
  if (!isStagingClinicalRuntime(environment) || environment.PEA_STAGING_NOTE_AI_ENABLED !== 'true') return ''
  const key = environment.PEA_STAGING_OPENAI_API_KEY?.trim() ?? ''
  return /^sk-[A-Za-z0-9_-]{12,}$/.test(key) ? key : ''
}
