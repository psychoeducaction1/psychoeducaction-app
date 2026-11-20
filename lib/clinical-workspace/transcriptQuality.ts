/** Detect a decoder loop without treating ordinary repeated words as an error. */
export function likelyTranscriptionLoop(text: string): boolean {
  const words = text.normalize('NFD').toLocaleLowerCase('fr')
    .replace(/[\u0300-\u036f]/g, '').replace(/\[[0-9:]+\]/g, ' ')
    .match(/[a-z0-9]+/g) ?? []
  if (words.length < 40) return false
  const width = 5
  const counts = new Map<string, number>()
  for (let index = 0; index <= words.length - width; index++) {
    const phrase = words.slice(index, index + width).join(' ')
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1)
  }
  const repeated = [...counts.values()].reduce((total, count) => total + (count >= 4 ? count : 0), 0)
  return repeated / (words.length - width + 1) >= 0.9
}

export const UNCERTAIN_TRANSCRIPT_PASSAGE = '[Passage répétitif à vérifier dans l’audio]'

/** Remove obvious decoder stutters before display, leaving negations and risk language untouched. */
export function cleanWhisperPassage(text: string): { text: string; changed: boolean } {
  if (likelyTranscriptionLoop(text)) return { text: UNCERTAIN_TRANSCRIPT_PASSAGE, changed: true }
  const words = [...text.matchAll(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)]
  const protectedWords = new Set(['non', 'pas', 'jamais', 'aucun', 'aucune', 'suicide', 'suicidaire'])
  let output = ''
  let cursor = 0
  let changed = false
  for (let index = 0; index < words.length;) {
    const first = words[index]
    const normalized = first[0].normalize('NFD').toLocaleLowerCase('fr').replace(/[\u0300-\u036f]/g, '')
    let end = index + 1
    while (end < words.length
      && words[end][0].normalize('NFD').toLocaleLowerCase('fr').replace(/[\u0300-\u036f]/g, '') === normalized
      && /^[\s,;.!?…-]*$/u.test(text.slice(words[end - 1].index! + words[end - 1][0].length, words[end].index!))) end++
    if (end - index >= 3 && !protectedWords.has(normalized)) {
      const firstEnd = first.index! + first[0].length
      const lastEnd = words[end - 1].index! + words[end - 1][0].length
      output += text.slice(cursor, firstEnd)
      cursor = lastEnd
      changed = true
    }
    index = end
  }
  return { text: changed ? `${output}${text.slice(cursor)}`.replace(/\s+([,;.!?…])/g, '$1') : text, changed }
}

/** Keep a visible review marker out of the external drafting source. */
export function prepareTranscriptForDraft(transcript: string): { text: string; suspectPassages: string[] } {
  const suspectPassages: string[] = []
  const lines = transcript.split(/\r?\n/)
  const text = lines.filter(line => {
    // Untimed pasted text may contain useful speech after a loop; keep it for human correction.
    if (!/^\s*\[[0-9:]+\]/.test(line)) return true
    if (!line.includes(UNCERTAIN_TRANSCRIPT_PASSAGE) && !likelyTranscriptionLoop(line)) return true
    suspectPassages.push(line.match(/^\s*\[([0-9:]+)\]/)?.[1] ?? 'sans horodatage')
    return false
  }).join('\n').trim()
  return { text, suspectPassages }
}
