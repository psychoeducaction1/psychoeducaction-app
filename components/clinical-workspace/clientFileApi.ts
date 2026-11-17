import type { ClinicalActorInput } from '@/lib/clinical-core/types'
import { clinicalRequest, isClinicalAccessDenied } from '@/lib/clinical-workspace/api'

/** The current view is purged on an authoritative permission refusal, before retrying any read. */
export async function clientFileMutation(actor: ClinicalActorInput, path: string, values: Record<string, unknown>, method: 'POST' | 'PATCH' | 'DELETE', onAccessDenied: (cause: unknown) => void): Promise<void> {
  try { await clinicalRequest(actor, path, values, method) }
  catch (cause) { if (isClinicalAccessDenied(cause)) onAccessDenied(cause); throw cause }
}
