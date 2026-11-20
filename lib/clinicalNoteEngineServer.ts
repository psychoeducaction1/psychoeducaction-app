import 'server-only'
import { analyzeClinicalSources, recoverMissingClinicalFacts } from '@/lib/clinicalNoteAnalysisServer'
import { reviseClinicalDraft, writeClinicalDraft } from '@/lib/clinicalNoteWritingServer'
import { ClinicalFidelityError, reviewClinicalDraft } from '@/lib/clinicalNoteValidationServer'
import type { ClinicalSources } from '@/lib/clinicalNoteEngine'
import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import { ClinicalNotesAiError } from '@/lib/clinicalNotesAiServer'
import { CLINICAL_TRANSCRIPT_MAX_CHARS } from '@/lib/clinicalNotesAi'
import { requestPrivateClinicalStructured } from '@/lib/clinical-local/privateNoteEngine'
import type { ClinicalStructuredRequester } from '@/lib/clinicalNoteAnalysisServer'
import type { ClinicalNoteDiscipline } from '@/lib/clinicalNoteDiscipline'

export async function generateClinicalEngine(sources: ClinicalSources, type: ClinicalNoteType, requestSignal: AbortSignal,
  mode: 'fictional' | 'real-private' = 'fictional', requesterOverride?: ClinicalStructuredRequester,
  discipline: ClinicalNoteDiscipline = 'unspecified', templateFocus: readonly string[] = []) {
  // Un seul cycle de révision ciblée si le premier contrôle clinique refuse le brouillon.
  const longTimeout = sources.transcript.length > 80_000 ? 1_800_000 : 540_000
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(sources.transcript.length > CLINICAL_TRANSCRIPT_MAX_CHARS ? longTimeout : 170_000)])
  const requester: ClinicalStructuredRequester | undefined = requesterOverride ?? (mode === 'real-private' ? requestPrivateClinicalStructured : undefined)
  const grounding = mode === 'real-private' ? 'real' : 'fictional'
  try {
    let analysis = await analyzeClinicalSources(sources, signal, requester, grounding)
    signal.throwIfAborted()
    if (!analysis.facts.some(fact => fact.source === 'transcript')) throw new ClinicalNotesAiError('La transcription ne contient aucun fait clinique exploitable pour cette rencontre. Vérifiez la source avant de générer un brouillon.', 422)
    const draft = await writeClinicalDraft(analysis, type, signal, requester, grounding, discipline, templateFocus)
    signal.throwIfAborted()
    try {
      return await reviewClinicalDraft(sources, analysis, draft, type, signal, requester, grounding, discipline)
    } catch (firstError) {
      if (!(firstError instanceof ClinicalFidelityError)) throw firstError
      let revised
      try {
        analysis = await recoverMissingClinicalFacts(sources, analysis, firstError.alerts, signal, requester, grounding)
        revised = await reviseClinicalDraft(analysis, draft, firstError.alerts, type, signal, requester, grounding, discipline, templateFocus)
      } catch (revisionError) {
        if (signal.aborted) throw revisionError
        throw new ClinicalFidelityError([...firstError.alerts, { category: 'fidelite', priority: 'normal',
          text: 'La révision automatique n’a pas abouti. Corrigez la première version à partir des sources.', factIds: [] }], firstError.candidate)
      }
      const revision = { initialDraft: draft, initialAlerts: firstError.alerts }
      try {
        const checked = await reviewClinicalDraft(sources, analysis, revised, type, signal, requester, grounding, discipline)
        return { ...checked, revision }
      } catch (secondError) {
        if (secondError instanceof ClinicalFidelityError) {
          throw new ClinicalFidelityError(secondError.alerts, { ...secondError.candidate, revision })
        }
        if (signal.aborted) throw secondError
        throw new ClinicalFidelityError([...firstError.alerts, { category: 'fidelite', priority: 'normal',
          text: 'Le deuxième contrôle n’a pas abouti. La première version reste consultable et doit être corrigée à partir des sources.', factIds: [] }], firstError.candidate)
      }
    }
  } catch (error) {
    if (error instanceof ClinicalNotesAiError) throw error
    throw new ClinicalNotesAiError('Traitement interrompu ou délai dépassé. Votre brouillon est conservé, sans nouvelle tentative automatique.', 502)
  }
}
