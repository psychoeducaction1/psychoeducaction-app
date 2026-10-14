import { getTorontoDate, roundCurrency, shiftIsoDate, type AdPlatform } from '@/lib/adSpend'

export const acquisitionPeriods = [
  ['today', 'Aujourd’hui'], ['yesterday', 'Hier'],
  ['this_week', 'Cette semaine'], ['last_week', 'Semaine dernière'],
  ['last_7_days', '7 derniers jours'], ['this_month', 'Ce mois-ci'],
  ['last_month', 'Mois dernier'], ['last_30_days', '30 derniers jours'],
] as const
export type AcquisitionPeriod = (typeof acquisitionPeriods)[number][0]

export function getAcquisitionPeriod(period: AcquisitionPeriod, now = new Date()) {
  const today = getTorontoDate(now)
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  const monday = shiftIsoDate(today, -((weekday + 6) % 7))
  switch (period) {
    case 'today': return { from: today, to: today }
    case 'yesterday': return { from: shiftIsoDate(today, -1), to: shiftIsoDate(today, -1) }
    case 'this_week': return { from: monday, to: today }
    case 'last_week': return { from: shiftIsoDate(monday, -7), to: shiftIsoDate(monday, -1) }
    case 'last_7_days': return { from: shiftIsoDate(today, -6), to: today }
    case 'this_month': return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'last_month': {
      const end = shiftIsoDate(`${today.slice(0, 7)}-01`, -1)
      return { from: `${end.slice(0, 7)}-01`, to: end }
    }
    case 'last_30_days': return { from: shiftIsoDate(today, -29), to: today }
  }
}

export type DailyAdExpense = {
  platform: AdPlatform
  spend_date: string
  amount: number | string
  currency: string
}
export type AdSpendSyncRun = {
  range_start: string
  range_end: string
  started_at: string
  details: unknown
}
export type AcquisitionSpend = {
  platform: AdPlatform
  amount: number | null
  complete: boolean
  syncedAt: string | null
  through: string | null
}

// Seul un rapport réussi couvre une journée sans dépense. L'absence de lignes
// n'est pas une preuve de zéro, et un total mensuel n'est jamais un substitut.
export function summarizeAcquisitionSpend(
  rows: DailyAdExpense[], runs: AdSpendSyncRun[], from: string, to: string
): AcquisitionSpend[] {
  return (['google_ads', 'meta_ads'] as const).map((platform) => {
    const reports = runs.filter((run) => Array.isArray(run.details) && run.details.some(
      (detail: { platform?: unknown; status?: unknown }) => detail?.platform === platform && detail.status === 'success'
    ))
    const periods = reports.map((run) => ({ from: run.range_start, to: run.range_end }))
      .filter((range) => range.to >= from && range.from <= to)
      .sort((a, b) => a.from.localeCompare(b.from))
    let cursor = from
    for (const range of periods) {
      if (range.from > cursor) break
      if (range.to >= cursor) cursor = shiftIsoDate(range.to, 1)
    }
    const selected = rows.filter((row) => row.platform === platform && row.spend_date >= from && row.spend_date <= to)
    const valid = selected.every((row) => row.currency === 'CAD' && Number.isFinite(Number(row.amount)) && Number(row.amount) >= 0)
    const complete = cursor > to && valid
    const through = reports.map((run) => run.range_end).sort().at(-1) ?? null
    const syncedAt = reports.map((run) => run.started_at).sort().at(-1) ?? null
    return {
      platform, complete, syncedAt, through,
      amount: valid && (selected.length > 0 || complete)
        ? roundCurrency(selected.reduce((sum, row) => sum + Number(row.amount), 0)) : null,
    }
  })
}
