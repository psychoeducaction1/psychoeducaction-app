export const LOCAL_NOTE_TRANSCRIPT_MAX_CHARS = 250_000
export const TRANSCRIPT_REVIEW_PAGE_SIZE = 25

export const TRANSCRIPT_SPEAKERS = ['Non attribué', 'Professionnel', 'Client', 'Parent 1', 'Parent 2', 'Autre participant'] as const
export type TranscriptSpeaker = typeof TRANSCRIPT_SPEAKERS[number]
export type ReviewedTranscriptSegment = { startMs: number; endMs: number; text: string; speaker: TranscriptSpeaker;
  confidence?: number; signalLevelDb?: number; speechCoverage?: number }

export type TranscriptReviewWarning = { startMs: number; endMs: number; firstIndex: number | null;
  lastIndex: number | null; reason: string }

function normalizedSpeech(text: string) {
  return text.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

function repeatsWithin(text: string) {
  const words = normalizedSpeech(text).split(' ').filter(Boolean)
  for (let size = 3; size <= Math.min(8, Math.floor(words.length / 3)); size++) {
    for (let start = 0; start + size * 3 <= words.length; start++) {
      const phrase = words.slice(start, start + size).join(' ')
      if (phrase === words.slice(start + size, start + size * 2).join(' ')
        && phrase === words.slice(start + size * 2, start + size * 3).join(' ')) return true
    }
  }
  return false
}

/** Review cues only: none of these heuristics delete or certify spoken words. */
export function transcriptReviewWarnings(segments: readonly ReviewedTranscriptSegment[], durationMs?: number): TranscriptReviewWarning[] {
  const warnings: TranscriptReviewWarning[] = []
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    const normalized = normalizedSpeech(segment.text)
    if (segment.confidence !== undefined && segment.confidence < 0.45 && normalized.length >= 8) {
      warnings.push({ startMs: segment.startMs, endMs: segment.endMs, firstIndex: index, lastIndex: index,
        reason: 'Probabilité faible des mots selon Whisper; vérifier à l’écoute.' })
    }
    if (segment.signalLevelDb !== undefined && segment.signalLevelDb < -38 && normalized.length >= 8) {
      warnings.push({ startMs: segment.startMs, endMs: segment.endMs, firstIndex: index, lastIndex: index,
        reason: 'Signal audio faible malgré le texte produit; vérifier à l’écoute.' })
    }
    if (segment.speechCoverage !== undefined && segment.speechCoverage < 0.2 && normalized.length >= 8) {
      warnings.push({ startMs: segment.startMs, endMs: segment.endMs, firstIndex: index, lastIndex: index,
        reason: 'Le détecteur local relève peu de parole sur ce passage; vérifier le texte à l’écoute.' })
    }
    if (segment.endMs - segment.startMs >= 15_000 && normalized.split(' ').length <= 6) {
      warnings.push({ startMs: segment.startMs, endMs: segment.endMs, firstIndex: index, lastIndex: index,
        reason: 'Très peu de mots sur une longue période; une partie peut être non parlée ou mal reconnue.' })
    }
    if (repeatsWithin(segment.text)) {
      warnings.push({ startMs: segment.startMs, endMs: segment.endMs, firstIndex: index, lastIndex: index,
        reason: 'Même suite de mots répétée dans ce passage.' })
    }
    const nextStart = segments[index + 1]?.startMs ?? durationMs
    if (nextStart !== undefined && nextStart - segment.endMs >= 15_000) {
      warnings.push({ startMs: segment.endMs, endMs: nextStart, firstIndex: null, lastIndex: null,
        reason: 'Intervalle sans transcription : vérifier si une parole faible a été omise.' })
    }
  }
  if (segments.length && segments[0].startMs >= 15_000) {
    warnings.unshift({ startMs: 0, endMs: segments[0].startMs, firstIndex: null, lastIndex: null,
      reason: 'Début sans transcription : vérifier si une parole faible a été omise.' })
  }
  for (let start = 0; start < segments.length;) {
    const phrase = normalizedSpeech(segments[start].text)
    if (phrase.length < 12) { start++; continue }
    let end = start + 1
    while (end < segments.length && normalizedSpeech(segments[end].text) === phrase) end++
    if (end - start >= 3) warnings.push({ startMs: segments[start].startMs, endMs: segments[end - 1].endMs,
      firstIndex: start, lastIndex: end - 1, reason: `Même phrase transcrite ${end - start} fois de suite.` })
    start = end
  }
  return warnings.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
}

export function timedTranscript(segments: readonly ReviewedTranscriptSegment[], options: { includeSpeakers?: boolean } = {}) {
  return segments.map(segment => {
    const seconds = Math.floor(segment.startMs / 1000)
    const stamp = [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
      .map(value => String(value).padStart(2, '0')).join(':')
    const speaker = segment.speaker === 'Non attribué' ? 'Locuteur non confirmé' : segment.speaker
    return options.includeSpeakers === false ? `[${stamp}] ${segment.text.trim()}` : `[${stamp}] ${speaker} : ${segment.text.trim()}`
  }).join('\n')
}

export function allTranscriptPagesReviewed(segmentCount: number, reviewedPages: ReadonlySet<number>) {
  const pages = Math.ceil(segmentCount / TRANSCRIPT_REVIEW_PAGE_SIZE)
  return pages > 0 && Array.from({ length: pages }, (_, page) => page).every(page => reviewedPages.has(page))
}
