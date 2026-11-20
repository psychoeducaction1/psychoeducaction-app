export type LegacyPdfSource = { documentId: string; pages: readonly string[] }

type Encounter = { documentId: string; date: string; order: number; text: string }

const isoDate = '(\\d{4}-\\d{2}-\\d{2})'
const datedHeading = new RegExp(
  `(?:^|\\n)\\s*(?:date\\s+(?:de\\s+la\\s+rencontre|d[’']intervention|de\\s+l[’']intervention)|rencontre\\s+du|intervention\\s+du|date\\s*:)\\s*[:：]?\\s*${isoDate}\\b`,
  'gimu',
)

function validDate(value: string): boolean {
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Date headings delimit encounters; dates merely mentioned inside prose do not. */
export function recentLegacyEncounters(documents: readonly LegacyPdfSource[]): Encounter[] {
  const encounters: Encounter[] = []
  let order = 0
  for (const document of documents) {
    let current: Encounter | null = null
    for (const page of document.pages) {
      const source = page.replace(/\r\n?/gu, '\n').trim()
      if (!source) continue
      const headings = [...source.matchAll(datedHeading)]
        .map(match => ({ index: match.index ?? 0, date: match[1] }))
        .filter(item => validDate(item.date))
      if (!headings.length) {
        if (current) current.text += `\n${source}`
        continue
      }
      if (current && headings[0].index > 0) current.text += `\n${source.slice(0, headings[0].index).trim()}`
      for (let index = 0; index < headings.length; index++) {
        const heading = headings[index]
        const text = source.slice(heading.index, headings[index + 1]?.index ?? source.length).trim()
        // A repeated date at the start of the next PDF page is a running header,
        // not a fourth encounter.
        if (current && current.date === heading.date && index === 0 && heading.index < 100) {
          current.text += `\n${text}`
          continue
        }
        current = { documentId: document.documentId, date: heading.date, order: order++, text }
        encounters.push(current)
      }
    }
  }
  return encounters.sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order)
}

/** Return the complete most recent dated encounter, without AI or summarization. */
export function latestLegacyEncounter(documents: readonly LegacyPdfSource[]): Encounter | null {
  return recentLegacyEncounters(documents)[0] ?? null
}
