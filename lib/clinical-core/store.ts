import type { ClinicalState, ClinicalStore } from './types'

export function emptyClinicalState(): ClinicalState {
  return { actors: [], clients: [], administrativeRecords: [], contacts: [], representatives: [], payers: [], requests: [], episodes: [], assignmentLinks: [], assignments: [], records: [], notes: [], audit: [] }
}
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b) }
function prefix(previous: unknown[], next: unknown[]) { return previous.length <= next.length && previous.every((entry, index) => same(entry, next[index])) }

// Process-local fixture storage. A failed operation never partially commits, and callers
// never receive mutable references into the store. No persistence or remote fallback.
export function createMemoryClinicalStore(initial: ClinicalState = emptyClinicalState()): ClinicalStore {
  let current = structuredClone(initial)
  let writing = false
  return {
    read() { return structuredClone(current) },
    transaction<T>(operation: (draft: ClinicalState) => T): T {
      if (writing) throw new Error('Nested clinical fixture transaction is forbidden.')
      writing = true
      try {
        const draft = structuredClone(current)
        const result = operation(draft)
        if (!prefix(current.audit, draft.audit)) throw new Error('Clinical audit is append-only.')
        const assignmentIds = new Set<string>(), assignedRequests = new Set<string>(), assignedEpisodes = new Set<string>()
        for (const assignment of draft.assignments) {
          const request = draft.requests.find(entry => entry.id === assignment.requestId)
          const episode = draft.episodes.find(entry => entry.id === assignment.episodeId)
          const professional = draft.actors.find(entry => entry.id === assignment.professionalId)
          if (!draft.clients.some(entry => entry.id === assignment.clientId) || !request || !episode || !professional
            || request.clientId !== assignment.clientId || episode.clientId !== assignment.clientId || episode.requestId !== request.id
            || request.status !== 'closed') throw new Error('Assignment patient, request and episode references must remain consistent.')
          if (assignmentIds.has(assignment.id) || assignedRequests.has(assignment.requestId) || assignedEpisodes.has(assignment.episodeId)) throw new Error('Assignment identities, requests and episodes must remain unique.')
          assignmentIds.add(assignment.id); assignedRequests.add(assignment.requestId); assignedEpisodes.add(assignment.episodeId)
          const previous = current.assignments.find(entry => entry.id === assignment.id)
          if (!previous && !professional.capabilities.includes('practice')) throw new Error('A new assignment requires an explicit practice capability.')
          if (!Number.isFinite(Date.parse(assignment.assignedAt)) || new Date(assignment.assignedAt).toISOString() !== assignment.assignedAt
            || (assignment.status !== 'active' && assignment.status !== 'closed')
            || (assignment.status === 'active' && assignment.closedAt !== null)
            || (assignment.status === 'closed' && (!assignment.closedAt || !Number.isFinite(Date.parse(assignment.closedAt))
              || new Date(assignment.closedAt).toISOString() !== assignment.closedAt || assignment.closedAt < assignment.assignedAt))) throw new Error('Assignment lifecycle dates must remain consistent.')
          if (previous) {
            for (const field of ['id', 'clientId', 'requestId', 'episodeId', 'professionalId', 'assignedAt'] as const) {
              if (previous[field] !== assignment[field]) throw new Error('Assignment identity and original linkage are immutable.')
            }
            if (previous.status === 'closed' && !same(previous, assignment)) throw new Error('A closed assignment is immutable.')
          }
        }
        if (current.assignments.some(previous => !draft.assignments.some(entry => entry.id === previous.id))) throw new Error('Assignments cannot be deleted.')
        for (const note of draft.notes) {
          const latest = note.versions.at(-1)
          if (note.note.version !== note.versions.length || !note.versions.every((entry, index) => entry.version === index + 1) || !latest
            || !same(latest.content, note.content) || latest.title !== note.note.title || latest.encounterDate !== note.note.encounterDate
            || latest.noteType !== note.note.noteType || latest.status !== note.note.status || latest.appointmentId !== note.note.appointmentId || !same(latest.appointmentSnapshot, note.note.appointmentSnapshot)) throw new Error('Clinical head must match its append-only version snapshot.')
        }
        for (const previous of current.notes) {
          const next = draft.notes.find(entry => entry.note.id === previous.note.id)
          if (!next || !prefix(previous.versions, next.versions) || !prefix(previous.signatures, next.signatures)) throw new Error('Clinical versions and signatures are immutable.')
          for (const field of ['createdAt', 'authorId', 'recordId', 'noteType', 'amendsNoteId', 'amendmentReason', 'appointmentId', 'appointmentSnapshot', 'requiresCosignature', 'supervisorId'] as const) {
            if (!same(previous.note[field], next.note[field])) throw new Error('Clinical note identity and supervision snapshots are immutable.')
          }
          if (!previous.note.removedAt && next.note.removedAt && next.note.removedBy) {
            const newHead = { ...next.note }, oldHead = { ...previous.note }
            delete newHead.removedAt; delete newHead.removedBy
            delete oldHead.removedAt; delete oldHead.removedBy
            if (same(newHead, oldHead) && same(previous.content, next.content) && same(previous.versions, next.versions)
              && same(previous.signatures, next.signatures) && draft.audit.slice(current.audit.length).some(entry =>
                entry.action === 'note.delete' && entry.resourceId === next.note.id && entry.actorId === next.note.removedBy)) continue
          }
          if (previous.note.status === 'awaiting_cosignature' && !same(previous, next)
            && (next.note.status !== 'signed' || next.note.version !== previous.note.version + 1 || next.signatures.length !== previous.signatures.length + 1 || next.versions.at(-1)?.kind !== 'cosign')) throw new Error('A pending clinical note can only be cosigned.')
          if (previous.note.status !== 'draft') {
            for (const field of ['content'] as const) if (!same(previous[field], next[field])) throw new Error('A signed clinical body is immutable.')
            for (const field of ['title', 'encounterDate', 'authorId', 'recordId', 'noteType', 'amendsNoteId', 'amendmentReason', 'requiresCosignature', 'supervisorId'] as const) {
              if (!same(previous.note[field], next.note[field])) throw new Error('A signed clinical snapshot is immutable.')
            }
            if (previous.note.status === 'signed' && !same(previous, next)) throw new Error('A fully signed clinical note is immutable.')
          }
        }
        for (const client of current.clients) if (!draft.clients.some(entry => entry.id === client.id)) throw new Error('Patient identities cannot be deleted.')
        const publicResult = structuredClone(result)
        current = draft
        return publicResult
      } finally { writing = false }
    },
  }
}
