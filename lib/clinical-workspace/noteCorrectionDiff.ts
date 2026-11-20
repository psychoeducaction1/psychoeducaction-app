export type NoteCorrectionPart = { kind: 'unchanged' | 'removed' | 'added'; text: string }

/** Compare the signed source with its separate correction. Neither document is mutated. */
export function noteCorrectionDiff(original: string, corrected: string): NoteCorrectionPart[] {
  if (original === corrected) return original ? [{ kind: 'unchanged', text: original }] : []
  const before = original.match(/\S+\s*|\s+/gu) ?? []
  const after = corrected.match(/\S+\s*|\s+/gu) ?? []
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const left = before.slice(prefix, before.length - suffix)
  const right = after.slice(prefix, after.length - suffix)
  const result: NoteCorrectionPart[] = []
  const add = (kind: NoteCorrectionPart['kind'], text: string) => {
    if (!text) return
    const last = result[result.length - 1]
    if (last?.kind === kind) last.text += text
    else result.push({ kind, text })
  }
  add('unchanged', before.slice(0, prefix).join(''))

  const compare = (a: string[], b: string[], depth: number): void => {
    let commonStart = 0
    while (commonStart < a.length && commonStart < b.length && a[commonStart] === b[commonStart]) commonStart++
    let commonEnd = 0
    while (commonEnd < a.length - commonStart && commonEnd < b.length - commonStart && a[a.length - 1 - commonEnd] === b[b.length - 1 - commonEnd]) commonEnd++
    const suffixText = a.slice(a.length - commonEnd).join('')
    add('unchanged', a.slice(0, commonStart).join(''))
    a = a.slice(commonStart, a.length - commonEnd)
    b = b.slice(commonStart, b.length - commonEnd)
    if (!a.length || !b.length) { add('removed', a.join('')); add('added', b.join('')) }
    else if ((a.length + 1) * (b.length + 1) <= 1_000_000) {
      // Exact, bounded longest-common-subsequence for ordinary local edits.
      const columns = b.length + 1
      const scores = new Uint16Array((a.length + 1) * columns)
      for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
        const at = i * columns + j
        scores[at] = a[i] === b[j] ? scores[at + columns + 1] + 1 : Math.max(scores[at + columns], scores[at + 1])
      }
      let i = 0, j = 0
      while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { add('unchanged', a[i]); i++; j++ }
        else if (scores[(i + 1) * columns + j] >= scores[i * columns + j + 1]) add('removed', a[i++])
        else add('added', b[j++])
      }
      add('removed', a.slice(i).join('')); add('added', b.slice(j).join(''))
    } else {
      // A unique shared word splits long notes without expensive quadratic work.
      const countsA = new Map<string, number>(), countsB = new Map<string, number>()
      for (const token of a) countsA.set(token, (countsA.get(token) ?? 0) + 1)
      for (const token of b) countsB.set(token, (countsB.get(token) ?? 0) + 1)
      const middle = a.length / 2
      const anchor = depth < 16 ? a.reduce<{ i: number; j: number } | null>((best, token, i) => {
        if (token.trim().length < 5 || countsA.get(token) !== 1 || countsB.get(token) !== 1) return best
        const j = b.indexOf(token)
        return !best || Math.abs(i - middle) < Math.abs(best.i - middle) ? { i, j } : best
      }, null) : null
      if (anchor) {
        compare(a.slice(0, anchor.i), b.slice(0, anchor.j), depth + 1)
        add('unchanged', a[anchor.i])
        compare(a.slice(anchor.i + 1), b.slice(anchor.j + 1), depth + 1)
      } else { add('removed', a.join('')); add('added', b.join('')) }
    }
    add('unchanged', suffixText)
  }
  compare(left, right, 0)
  add('unchanged', before.slice(before.length - suffix).join(''))
  return result
}
