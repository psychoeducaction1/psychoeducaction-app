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

export type GoogleAdsIngestPayload = {
  accountId: string
  currency: string
  from: string
  to: string
  rows: Array<{
    date: string
    campaignId: string
    campaignName: string
    amount: number
  }>
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function parseGoogleAdsIngestPayload(value: unknown): GoogleAdsIngestPayload {
  if (!value || typeof value !== 'object') throw new Error('Corps JSON invalide.')
  const payload = value as Partial<GoogleAdsIngestPayload>
  const accountId = cleanAdsAccountId(String(payload.accountId ?? ''))
  const currency = String(payload.currency ?? '').trim().toUpperCase()
  const from = String(payload.from ?? '')
  const to = String(payload.to ?? '')
  if (!accountId) throw new Error('Identifiant Google Ads manquant.')
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Devise Google Ads invalide.')
  if (!ISO_DATE_PATTERN.test(from) || !ISO_DATE_PATTERN.test(to) || from > to) {
    throw new Error('Plage de dates invalide.')
  }
  if (!Array.isArray(payload.rows) || payload.rows.length > 10000) {
    throw new Error('Lignes Google Ads invalides.')
  }

  const rows = payload.rows.map((raw, index) => {
    const date = String(raw?.date ?? '')
    const campaignId = String(raw?.campaignId ?? '').trim()
    const campaignName = String(raw?.campaignName ?? '').trim()
    const amount = Number(raw?.amount)
    if (!ISO_DATE_PATTERN.test(date) || date < from || date > to) {
      throw new Error(`Date invalide à la ligne ${index + 1}.`)
    }
    if (!campaignId || !campaignName || !Number.isFinite(amount) || amount < 0) {
      throw new Error(`Donnée invalide à la ligne ${index + 1}.`)
    }
    return { date, campaignId, campaignName, amount: roundCurrency(amount) }
  })

  return { accountId, currency, from, to, rows }
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

export function getAdSpendRange(lookbackDays: number, now = new Date(), includeToday = false) {
  const safeDays = Math.min(366, Math.max(2, Math.trunc(lookbackDays)))
  const today = getTorontoDate(now)
  const to = includeToday ? today : shiftIsoDate(today, -1)
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

