import 'server-only'
import { analyzeClinicalSources } from '@/lib/clinicalNoteAnalysisServer'
import { writeClinicalDraft } from '@/lib/clinicalNoteWritingServer'
import { reviewClinicalDraft } from '@/lib/clinicalNoteValidationServer'
import type { ClinicalSources } from '@/lib/clinicalNoteEngine'
import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import { ClinicalNotesAiError } from '@/lib/clinicalNotesAiServer'

export async function generateClinicalEngine(sources: ClinicalSources, type: ClinicalNoteType, requestSignal: AbortSignal) {
  // Trois étapes, délai TOTAL borné et annulation transmise à chaque appel. Aucune relance automatique.
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(50_000)])
  try {
    const analysis = await analyzeClinicalSources(sources, signal)
    signal.throwIfAborted()
    const draft = await writeClinicalDraft(analysis, type, signal)
    signal.throwIfAborted()
    return await reviewClinicalDraft(sources, analysis, draft, type, signal)
  } catch (error) {
    if (error instanceof ClinicalNotesAiError) throw error
    throw new ClinicalNotesAiError('Traitement interrompu ou délai dépassé. Votre brouillon est conservé, sans nouvelle tentative automatique.', 502)
  }
}
