'use client'

import type { ClinicalAlert } from '@/lib/clinicalNoteEngine'
import { groupClinicalAlerts } from '@/lib/clinicalNoteAlerts'

const labels: Record<ClinicalAlert['category'], string> = {
  information_manquante: 'Informations à compléter', attribution: 'Personnes et propos à confirmer',
  ambiguite: 'Ambiguïtés à clarifier', contradiction: 'Contradictions à vérifier', fidelite: 'Fidélité aux sources',
  champ_exercice: 'Champ d’exercice', risque: 'Propos préoccupants à revoir', suggestion: 'Suggestions à examiner',
}

export default function ClinicalNotesAlerts({ alerts }: { alerts: readonly ClinicalAlert[] }) {
  const groups = groupClinicalAlerts(alerts)
  return <section aria-label="Alertes de relecture" className="space-y-3 rounded-xl border border-[#dfd0bf] bg-[#fbf6ef] p-4">
    <h4 className="font-semibold">À revoir — hors du texte clinique</h4>
    <p className="text-xs leading-5">Les alertes portant sur les mêmes passages sont regroupées. Les précisions restent consultables ci-dessous. La détection peut manquer des éléments; un indicateur prioritaire ne constitue ni une évaluation du risque ni un protocole clinique approuvé.</p>
    {groups.map(group => <article key={group.category} aria-label={labels[group.category]} className={group.priority === 'prioritaire' ? 'space-y-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900' : 'space-y-3 rounded-lg border border-[#dfd0bf] bg-white/60 p-3 text-sm leading-6'}>
      <h5 className="font-semibold">{group.priority === 'prioritaire' ? 'Révision prioritaire · ' : ''}{labels[group.category]}</h5>
      {group.points.map((point, index) => <div key={index} className="space-y-2">
        {group.points.length > 1 && <p className="text-xs font-medium">Point {index + 1}{point.priority === 'prioritaire' ? ' · prioritaire' : ''}</p>}
        <p>{point.primary.text}</p>
        {point.factIds.length > 0 && <p className="text-xs">Références : {point.factIds.join(', ')}</p>}
        {point.details.length > 0 && <details className="rounded-lg border border-current/15 p-2">
          <summary className="cursor-pointer text-xs font-medium">Autres formulations et précisions à lire ({point.details.length})</summary>
          <ul className="mt-2 list-disc space-y-2 pl-5">{point.details.map((detail, detailIndex) => <li key={detailIndex}>
            <p>{detail.text}</p>
            {detail.factIds.length > 0 && <p className="text-xs">Références de cette précision : {detail.factIds.join(', ')}</p>}
          </li>)}</ul>
        </details>}
      </div>)}
    </article>)}
    {!groups.length && <p className="text-sm">Aucune alerte retournée; relecture complète toujours nécessaire.</p>}
  </section>
}
