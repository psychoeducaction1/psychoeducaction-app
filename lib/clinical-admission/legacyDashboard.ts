export type LegacyWaitingDashboard = {
  available: boolean
  copiedAt: string | null
  waiting: number
  urgent: number
  inProgress: number
  history: number
  clients: { id: string; name: string; service: string; priority: string | null; contactDate: string | null }[]
}

const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const short = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
export function isLegacyWaitingDashboard(value: unknown): value is LegacyWaitingDashboard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return typeof data.available === 'boolean'
    && (data.copiedAt === null || short(data.copiedAt, 40) && !Number.isNaN(Date.parse(data.copiedAt as string)))
    && count(data.waiting) && count(data.urgent) && count(data.inProgress) && count(data.history)
    && Array.isArray(data.clients) && data.clients.length <= 12 && data.clients.every(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const row = item as Record<string, unknown>
      return short(row.id, 36) && short(row.name, 160) && short(row.service, 160)
        && (row.priority === null || short(row.priority, 60))
        && (row.contactDate === null || short(row.contactDate, 40))
    })
}
