'use client'
import { matchesSatisfactionSearch, satisfactionContactIssueLabel, type SatisfactionAnalysis } from '@/lib/satisfactionWorkspace'
import { Badge, EmptyState, SectionCard, tableCellClass, tableHeadCellClass, tableHeaderClass, tableRowClass, tableShellClass } from '@/components/ui/index'

export function ImportAnalysis({ analysis, query, professional }: { analysis: SatisfactionAnalysis | null; query: string; professional: string }) {
  if (!analysis) return <div className="mt-4"><EmptyState title="Détail de l’analyse non disponible pour cet ancien import"
    description="Les raisons de non-éligibilité n’étaient pas conservées lors de cet import. Réimportez le fichier pour obtenir le détail ; aucun courriel ne sera envoyé automatiquement." /></div>
  const rows = analysis.rows.filter(row => matchesSatisfactionSearch(query, [row.clientNom, row.destinataireNom, row.professionnel])
    && (!professional || row.professionnel === professional))
  return <div className="mt-4"><SectionCard title="Pourquoi les clients sont retenus ou non retenus">
    <p className="mb-3 text-sm text-[#6c5a4d]">{analysis.rows.length} client(s) analysé(s), {analysis.rows.filter(r => r.eligible).length} éligible(s).
      Les courriels manquants et les correspondances ambiguës doivent être vérifiés avant l’envoi.</p>
    <div className={tableShellClass}><table className="w-full min-w-[700px] text-sm">
      <thead className={tableHeaderClass}><tr>{['Client', 'Destinataire', 'Professionnel', 'Rencontres', 'Décision', 'Explication'].map(label => <th key={label} className={tableHeadCellClass}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i} className={tableRowClass}>
        <td className={tableCellClass}>{row.clientNom}</td><td className={tableCellClass}>{row.destinataireNom}</td>
        <td className={tableCellClass}>{row.professionnel ?? '—'}</td><td className={tableCellClass}>{row.nbRencontres}</td>
        <td className={tableCellClass}><Badge tone={row.eligible ? 'success' : 'muted'}>{row.eligible ? 'Éligible' : 'Non retenu'}</Badge></td>
        <td className={tableCellClass}>{row.reasons.join(' · ') || 'Au moins quatre rencontres, pas encore sollicité et non désabonné'}
          {row.contactIssue && <p className="mt-1 text-[#8a5633]">{satisfactionContactIssueLabel(row.contactIssue)}</p>}</td>
      </tr>)}</tbody>
    </table></div>{rows.length === 0 && <p className="mt-3 text-sm">Aucun client ne correspond à la recherche.</p>}
  </SectionCard></div>
}
