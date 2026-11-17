import { noteCorrectionDiff } from '@/lib/clinical-workspace/noteCorrectionDiff'

export function ClinicalNoteCorrectionDiff({ original, corrected, signedAt }: { original: string; corrected: string; signedAt: string | null }) {
  const changes = noteCorrectionDiff(original, corrected)
  const changed = changes.some(part => part.kind !== 'unchanged')
  const date = signedAt ? new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Toronto' }).format(new Date(signedAt)) : null
  const tooltip = date ? `Correction ou complément signé le ${date}` : 'Projet de correction ou de complément non signé'
  const tooltipClass = 'pointer-events-none absolute bottom-full left-0 z-20 mb-1 w-max max-w-72 whitespace-normal rounded-md bg-[#3f332b] px-2 py-1 text-xs leading-5 text-white opacity-0 shadow-lg group-hover:opacity-100 group-focus:opacity-100'
  return <section aria-label="Comparaison avec la note signée" className="rounded-xl border border-[#dfd0bf] bg-white p-5">
    <div className="mb-3 space-y-1 text-sm text-[#5d4a3d]">
      <p className="font-semibold">Correction ou complément à la note signée</p>
      <p>Le texte original reste conservé. <span className="rounded bg-red-100 px-1 text-red-800 line-through">Texte retiré</span> · <span className="rounded bg-green-100 px-1 text-green-800">Texte ajouté</span></p>
      {date ? <p>Validé le <time dateTime={signedAt!}>{date}</time>. Survolez un changement pour revoir sa date.</p> : <p>Projet non signé : les changements seront datés lors de la signature.</p>}
    </div>
    {changed ? <div className="whitespace-pre-wrap break-words text-sm leading-7 text-[#3f332b]">{changes.map((part, index) => {
      if (part.kind === 'unchanged') return <span key={index}>{part.text}</span>
      const tooltipId = `note-correction-date-${index}`
      return <span key={index} tabIndex={0} aria-describedby={tooltipId} className="group relative inline cursor-help rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#805738]">
        {part.kind === 'removed'
          ? <del className="rounded bg-red-100 px-0.5 text-red-800 decoration-red-700 decoration-2">{part.text}</del>
          : <ins className="rounded bg-green-100 px-0.5 text-green-800 no-underline">{part.text}</ins>}
        <span id={tooltipId} role="tooltip" className={tooltipClass}>{tooltip}</span>
      </span>
    })}</div> : <p className="text-sm text-amber-800">Aucun changement par rapport à la note signée.</p>}
  </section>
}
