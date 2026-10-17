import type { ClinicalAlert } from '@/lib/clinicalNoteEngine'

const normalizedText = (text: string) => text.normalize('NFC').replace(/[’‘ʼ]/g, "'").replace(/\s+/g, ' ').trim()

// Seuls les doublons textuels (espaces/apostrophes) avec les mêmes références
// et catégorie sont retirés. Aucune approximation sémantique d'un contenu clinique.
export function deduplicateClinicalAlerts(alerts: readonly ClinicalAlert[]): ClinicalAlert[] {
  const unique = new Map<string, ClinicalAlert>()
  for (const alert of alerts) {
    const factIds = [...new Set(alert.factIds)].sort()
    const key = JSON.stringify([alert.category, factIds, normalizedText(alert.text)])
    const previous = unique.get(key)
    unique.delete(key)
    unique.set(key, { ...alert, factIds, priority: alert.category === 'risque' || alert.priority === 'prioritaire' || previous?.priority === 'prioritaire' ? 'prioritaire' : 'normal' })
  }
  return [...unique.values()]
}

export type ClinicalAlertPoint = {
  category: ClinicalAlert['category']; priority: ClinicalAlert['priority']; factIds: string[]
  primary: ClinicalAlert; details: ClinicalAlert[]
}
export type ClinicalAlertGroup = {
  category: ClinicalAlert['category']; priority: ClinicalAlert['priority']; points: ClinicalAlertPoint[]
}

// Les références communes servent à REGROUPER l'affichage, jamais à supprimer
// une formulation différente. Les alertes sans référence ne sont pas rapprochées.
export function groupClinicalAlerts(alerts: readonly ClinicalAlert[]): ClinicalAlertGroup[] {
  const byCategory = new Map<ClinicalAlert['category'], ClinicalAlert[][]>()
  const ordered = deduplicateClinicalAlerts(alerts)
  const positions = new Map(ordered.map((alert, index) => [alert, index]))
  for (const alert of ordered) {
    const clusters = byCategory.get(alert.category) ?? []
    const overlaps = clusters.filter(cluster => alert.factIds.length > 0 && cluster.some(item => item.factIds.some(id => alert.factIds.includes(id))))
    const merged = [...overlaps.flat(), alert].sort((a, b) => positions.get(a)! - positions.get(b)!)
    byCategory.set(alert.category, [...clusters.filter(cluster => !overlaps.includes(cluster)), merged])
  }
  return [...byCategory].map(([category, clusters]) => {
    const points = clusters.map(cluster => {
      const priority = category === 'risque' || cluster.some(alert => alert.priority === 'prioritaire') ? 'prioritaire' as const : 'normal' as const
      // La dernière étape fournit la formulation principale. Si une alerte est
      // prioritaire, elle reste visible même si une formulation ultérieure ne l'est pas.
      const candidates = cluster.filter(alert => alert.priority === priority || category === 'risque')
      const primary = candidates[candidates.length - 1]
      return { category, priority, primary, details: cluster.filter(alert => alert !== primary), factIds: [...new Set(cluster.flatMap(alert => alert.factIds))].sort() }
    }).sort((a, b) => Number(b.priority === 'prioritaire') - Number(a.priority === 'prioritaire'))
    return { category, priority: points.some(point => point.priority === 'prioritaire') ? 'prioritaire' as const : 'normal' as const, points }
  }).sort((a, b) => Number(b.priority === 'prioritaire') - Number(a.priority === 'prioritaire'))
}
