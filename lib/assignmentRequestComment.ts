/** Presentation only: keep persisted request history untouched. */
export function assignmentRequestComment(comment: string) {
  const notes = new Set<string>()
  const slots = new Set<string>()
  for (const line of comment.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    if (line.startsWith('Plages proposées :')) {
      for (const slot of line.slice('Plages proposées :'.length).split(',')) {
        if (slot.trim()) slots.add(slot.trim())
      }
    } else if (line !== '-' && line !== '—') notes.add(line)
  }
  return { notes: [...notes], slots: [...slots].sort() }
}
