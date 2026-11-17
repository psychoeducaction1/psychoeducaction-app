import type { PriorNoteContext } from '@/lib/clinical-workspace/priorNoteContext'

/** The complete latest note, kept outside the current note document. */
export function PriorNoteContextPanel({ context, loading, error }: { context: PriorNoteContext | null; loading: boolean; error: string }) {
  return <details className="mt-4 rounded-xl border border-[#e7d9ca] bg-[#faf7f2] p-4">
    <summary className="cursor-pointer font-semibold text-[#5d402e]">Contenu de la dernière note</summary>
    <div className="mt-3 text-sm leading-6 text-[#5d4a3d]">
      {loading ? <p role="status">Chargement de la dernière note…</p>
        : error ? <p role="alert" className="text-red-700">La dernière note n’a pas pu être chargée : {error} La note reste modifiable.</p>
          : context?.included ? <>
            <p className="mb-3 text-xs text-[#7a6859]">Contenu intégral de la dernière note du même dossier. Il est séparé du texte de la note actuelle.</p>
            <p className="whitespace-pre-wrap break-words">{context.text}</p>
          </> : <p>Aucune note antérieure dans ce dossier.</p>}
    </div>
  </details>
}
