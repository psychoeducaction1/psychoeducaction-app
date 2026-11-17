import { motifOptions } from './professionalPreferences.ts'

const heading = 'Motifs exclus : '
const separator = ' ; '

/** Keep the existing text contract readable by older screens and exports. */
export function readProfessionalExclusions(text: string): { motifs: string[]; comment: string } {
  const end = text.indexOf('\n\n')
  const line = end < 0 ? text : text.slice(0, end)
  if (!line.startsWith(heading)) return { motifs: [], comment: text }
  const labels = line.slice(heading.length).split(separator)
  const motifs = labels.map(label => motifOptions.find(option => option.label === label)?.value)
  // Never strip an unrecognized legacy sentence or future option from the comment.
  if (motifs.some(value => value === undefined)) return { motifs: [], comment: text }
  return { motifs: motifs as string[], comment: end < 0 ? '' : text.slice(end + 2) }
}

export function writeProfessionalExclusions(motifs: readonly string[], comment: string): string {
  const labels = motifOptions.filter(option => motifs.includes(option.value)).map(option => option.label)
  if (!labels.length) return comment
  return heading + labels.join(separator) + (comment ? '\n\n' + comment : '')
}
