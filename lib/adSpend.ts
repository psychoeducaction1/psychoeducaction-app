export type AdPlatform = 'google_ads' | 'meta_ads'

export type AdSpendRow = {
  platform: AdPlatform
  accountId: string
  spendDate: string
  campaignId: string
  campaignName: string
  amount: number
  currency: string
}

export function cleanAdsAccountId(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

export function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function getTorontoDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function getAdSpendRange(lookbackDays: number, now = new Date()) {
  const safeDays = Math.min(366, Math.max(2, Math.trunc(lookbackDays)))
  const today = getTorontoDate(now)
  const to = shiftIsoDate(today, -1)
  return { from: shiftIsoDate(to, -(safeDays - 1)), to }
}

export function monthKeysBetween(from: string, to: string): string[] {
  const keys: string[] = []
  const cursor = new Date(`${from.slice(0, 7)}-01T12:00:00Z`)
  const end = `${to.slice(0, 7)}-01`

  while (cursor.toISOString().slice(0, 10) <= end) {
    keys.push(cursor.toISOString().slice(0, 7))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return keys
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

