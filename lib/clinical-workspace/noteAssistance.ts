import { CLINICAL_CONTEXT_MAX_CHARS } from '@/lib/clinicalNoteEngine'
import type { ClinicalEngineResult, ClinicalSources } from '@/lib/clinicalNoteEngine'
import { CLINICAL_TRANSCRIPT_MAX_CHARS } from '@/lib/clinicalNotesAi'
import { LOCAL_NOTE_TRANSCRIPT_MAX_CHARS } from '@/lib/clinical-workspace/transcriptReview'
import { isClinicalNoteType } from '@/lib/clinicalNoteTemplates'
import { CLINICAL_NOTE_BLUEPRINTS } from '@/lib/clinicalNoteBlueprints'
import { deidentifyClinicalSources, parseClinicalIdentifiers, reviewedClinicalSources } from '@/lib/clinical-workspace/deidentify'
import type { ClinicalNoteType } from '@/lib/clinicalNoteTemplates'

/** The lab may send only confirmed fictional sources to the existing v2 engine. */
export function confirmedClinicalAssistanceInput(value: unknown, maxTranscriptChars = CLINICAL_TRANSCRIPT_MAX_CHARS): { noteType: ClinicalNoteType; sources: ClinicalSources } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (body.formatVersion !== 3 || body.fictional !== true || body.reviewedTranscript !== true
    || body.deidentificationReviewed !== true || !isClinicalNoteType(body.noteType)
    || typeof body.transcript !== 'string' || !body.transcript.trim() || body.transcript.length > maxTranscriptChars
    || typeof body.history !== 'string' || body.history.length > CLINICAL_CONTEXT_MAX_CHARS
    || typeof body.metadata !== 'string' || body.metadata.length > 2_000
    || (body.history.trim() && body.sameFictionalCase !== true)
    || (body.metadata.trim() && body.metadataConfirmed !== true)) return null
  const identifiers = parseClinicalIdentifiers(body.identifiers)
  if (!identifiers) return null
  const prepared = deidentifyClinicalSources({ transcript: body.transcript, history: body.history, metadata: body.metadata }, identifiers)
  if (prepared.residualDirectIdentifiers || !prepared.sources.transcript.trim()) return null
  const reviewed = body.preparedSources === undefined ? prepared.sources
    : reviewedClinicalSources(body.preparedSources, identifiers, { transcript: body.transcript, history: body.history, metadata: body.metadata })
  if (!reviewed) return null
  return { noteType: body.noteType, sources: reviewed }
}

/** The browser path has already removed its raw source. The API must never require it. */
export function preparedBrowserAssistanceInput(value: unknown): { noteType: ClinicalNoteType; sources: ClinicalSources; templateId: string | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  const keys = Object.keys(body).sort().join(',')
  if (keys !== 'action,fictional,formatVersion,noteType,sources' && keys !== 'action,fictional,formatVersion,noteType,sources,templateId') return null
  if (body.action !== 'generate-browser' || body.formatVersion !== 1 || body.fictional !== true
    || !isClinicalNoteType(body.noteType) || !body.sources || typeof body.sources !== 'object' || Array.isArray(body.sources)
    || (body.templateId !== undefined && (typeof body.templateId !== 'string' || body.templateId.length > 60
      || !isClinicalNoteType(body.templateId) && !/^personal:[0-9a-f-]{36}$/i.test(body.templateId)))) return null
  const input = body.sources as Record<string, unknown>
  if (Object.keys(input).sort().join(',') !== 'history,metadata,transcript'
    || typeof input.transcript !== 'string' || !input.transcript.trim() || input.transcript.length > LOCAL_NOTE_TRANSCRIPT_MAX_CHARS
    || typeof input.history !== 'string' || input.history.length > CLINICAL_CONTEXT_MAX_CHARS
    || typeof input.metadata !== 'string' || input.metadata.length > 2_000) return null
  const sources = input as ClinicalSources
  const checked = deidentifyClinicalSources(sources, [])
  if (checked.replacementCount || checked.residualDirectIdentifiers) return null
  return { noteType: body.noteType, sources, templateId: typeof body.templateId === 'string' ? body.templateId : null }
}

export function canInsertAssistedDraft({ stale, sourcesConfirmed, checks, draft, busy, needsCorrection, rejectedDraft, correctionsConfirmed }: {
  stale: boolean; sourcesConfirmed: boolean; checks: readonly boolean[]; draft: string; busy: boolean
  needsCorrection: boolean; rejectedDraft: string; correctionsConfirmed: boolean
}) {
  return !stale && sourcesConfirmed && checks.length === 3 && checks.every(Boolean) && Boolean(draft.trim()) && !busy
    && (!needsCorrection || (correctionsConfirmed && draft.trim() !== rejectedDraft.trim()))
}

/** The browser flow keeps its automatic checks but needs no acknowledgement boxes. */
export function canInsertBrowserAssistedDraft({ stale, sourcesReady, draft, busy }: {
  stale: boolean; sourcesReady: boolean; draft: string; busy: boolean
}): boolean {
  return !stale && sourcesReady && Boolean(draft.trim()) && !busy
}

/** Keep evolution notes continuous and expose the selected template's sections for structured notes. */
export function continuousAssistedNote(result: ClinicalEngineResult): string {
  const sections = result.draft.sections
  if (!sections.length) return ''
  if (result.noteType === 'evolution') return sections.flatMap(section => [
    ...section.paragraphs.map(paragraph => paragraph.text.replace(/\s+/g, ' ').trim()).filter(Boolean),
    ...section.rows.map(row => row.cells.map(cell => cell.trim()).filter(Boolean).join(' — ')).filter(Boolean),
  ]).join('\n\n').trim()
  const blueprint = CLINICAL_NOTE_BLUEPRINTS[result.noteType] ?? []
  return sections.flatMap(section => {
    const config = blueprint.find(item => item.id === section.id)
    if (!config) return []
    const paragraphs = section.paragraphs.map(paragraph => paragraph.text.trim()).filter(Boolean)
    const rows = section.rows.map(row => row.cells.flatMap((cell, index) => cell.trim() ? [`${config.columns?.[index] ?? `Colonne ${index + 1}`} : ${cell.trim()}`] : []).join('\n')).filter(Boolean)
    return paragraphs.length || rows.length ? [`${config.title}\n${[...paragraphs, ...rows].join('\n\n')}`] : []
  }).join('\n\n').trim()
}
