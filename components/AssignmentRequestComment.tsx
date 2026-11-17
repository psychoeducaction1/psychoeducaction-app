import { assignmentRequestComment } from '@/lib/assignmentRequestComment'

export function AssignmentRequestComment({ comment }: { comment: string }) {
  const { notes, slots } = assignmentRequestComment(comment)
  if (!notes.length && !slots.length) return null
  return <div className="mt-2 text-sm text-[#7a6859]">
    {slots.length > 0 && <p>{slots.length} plage{slots.length > 1 ? 's' : ''} proposée{slots.length > 1 ? 's' : ''}</p>}
    {slots.length > 0 || notes.join(' ').length > 180 ? <details className="mt-2">
      <summary className="cursor-pointer font-medium text-[#6d3f1f] hover:underline">Voir les disponibilités et commentaires</summary>
      <div className="mt-3 max-h-64 space-y-3 overflow-y-auto rounded-xl border border-[#eadfd2] p-3">
        {notes.map(note => <p key={note} className="whitespace-pre-wrap break-words">{note}</p>)}
        {slots.length > 0 && <ul className="grid gap-2 sm:grid-cols-2">{slots.map(slot => <li key={slot}>{slot}</li>)}</ul>}
      </div>
    </details> : notes.map(note => <p key={note} className="break-words">{note}</p>)}
  </div>
}
