import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  cleanAdsAccountId,
  getAdSpendRange,
  validateSpendReplacement,
  roundCurrency,
  type AdPlatform,
  type AdSpendRow,
} from '@/lib/adSpend'

type SyncResult = {
  platform: AdPlatform
  status: 'success' | 'skipped' | 'error'
  rows: number
  amount: number
  currency: string | null
  message: string
}

function configured(name: string) {
  return Boolean(process.env[name]?.trim())
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} est manquant.`)
  return value
}

async function responseJson(response: Response, provider: string) {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${provider} a répondu ${response.status}. La synchronisation est interrompue.`)
  }
  try { return text ? JSON.parse(text) as unknown : null } catch {
    throw new Error(`${provider} a retourné une réponse illisible.`)
  }
}

type FetchedSpend = { rows: AdSpendRow[]; currency: string }

type GoogleReportBatch<T> = { results?: T[]; fieldMask?: string; requestId?: string; error?: unknown }
function googleReportRows<T>(value: unknown): T[] {
  if (!Array.isArray(value) || value.some((batch: GoogleReportBatch<T> | null) =>
    !batch || batch.error !== undefined || (!Array.isArray(batch.results) && !(
      // Protobuf peut omettre la collection vide; le serveur doit alors accuser
      // explicitement le rapport avec ses métadonnées, jamais un simple objet {}.
      batch.results === undefined && typeof batch.fieldMask === 'string' && batch.fieldMask.trim()
      && typeof batch.requestId === 'string' && batch.requestId.trim()
    )))) throw new Error('Rapport Google Ads incomplet ou invalide.')
  return (value as GoogleReportBatch<T>[]).flatMap(batch => batch.results ?? [])
}

async function fetchGoogleSpend(from: string, to: string): Promise<FetchedSpend> {
  const customerId = cleanAdsAccountId(requireEnv('GOOGLE_ADS_CUSTOMER_ID'))
  const clientId = requireEnv('GOOGLE_ADS_CLIENT_ID')
  const clientSecret = requireEnv('GOOGLE_ADS_CLIENT_SECRET')
  const refreshToken = requireEnv('GOOGLE_ADS_REFRESH_TOKEN')
  const developerToken = requireEnv('GOOGLE_ADS_DEVELOPER_TOKEN')
  const apiVersion = process.env.GOOGLE_ADS_API_VERSION?.trim() || 'v25'

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
  })
  const tokenPayload = await responseJson(tokenResponse, 'Google OAuth') as {
    access_token?: string
  }
  if (!tokenPayload.access_token) throw new Error("Google OAuth n'a retourné aucun jeton.")

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokenPayload.access_token}`,
    'Content-Type': 'application/json',
    'developer-token': developerToken,
  }
  const loginCustomerId = cleanAdsAccountId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '')
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId

  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      customer.currency_code,
      metrics.cost_micros
    FROM campaign
    WHERE segments.date BETWEEN '${from}' AND '${to}'
  `
  const reportResponse = await fetch(
    `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
      cache: 'no-store',
    }
  )
  const batches = await responseJson(reportResponse, 'Google Ads') as Array<{
    results?: Array<{
      campaign?: { id?: string; name?: string }
      customer?: { currencyCode?: string }
      metrics?: { costMicros?: string }
      segments?: { date?: string }
    }>
  }>

  const rows = googleReportRows<NonNullable<typeof batches[number]['results']>[number]>(batches).flatMap((row) => {
    const spendDate = row.segments?.date ?? ''
    const campaignId = String(row.campaign?.id ?? '')
    const amount = Number(row.metrics?.costMicros ?? 0) / 1_000_000
    if (!spendDate || !campaignId || !Number.isFinite(amount) || amount < 0) throw new Error('Rapport Google Ads invalide.')
    return [{
      platform: 'google_ads' as const,
      accountId: customerId,
      spendDate,
      campaignId,
      campaignName: row.campaign?.name?.trim() || `Campagne ${campaignId}`,
      amount: roundCurrency(amount),
      currency: row.customer?.currencyCode?.trim().toUpperCase() || 'UNKNOWN',
    }]
  })
  // Le rapport vide doit aussi confirmer la devise, avant de remplacer les anciens chiffres.
  const currencyResponse = await fetch(
    `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:searchStream`,
    { method: 'POST', headers, body: JSON.stringify({ query: 'SELECT customer.currency_code FROM customer' }), cache: 'no-store' },
  )
  const currencyBatches = await responseJson(currencyResponse, 'Google Ads') as Array<{ results?: Array<{ customer?: { currencyCode?: string } }> }>
  const currencies = [...new Set(googleReportRows<{ customer?: { currencyCode?: string } }>(currencyBatches)
    .map(row => row.customer?.currencyCode?.trim().toUpperCase()))]
  return { rows, currency: currencies.length === 1 ? currencies[0] ?? 'UNKNOWN' : 'UNKNOWN' }

}

async function fetchMetaSpend(from: string, to: string): Promise<FetchedSpend> {
  const rawAccountId = requireEnv('META_AD_ACCOUNT_ID')
  const accountId = cleanAdsAccountId(rawAccountId)
  const accessToken = requireEnv('META_ADS_ACCESS_TOKEN')
  const apiVersion = process.env.META_GRAPH_API_VERSION?.trim() || 'v24.0'
  const accountResponse = await fetch(
    `https://graph.facebook.com/${apiVersion}/act_${accountId}?${new URLSearchParams({
      access_token: accessToken,
      fields: 'currency',
    })}`,
    { cache: 'no-store' }
  )
  const account = await responseJson(accountResponse, 'Meta Ads') as {
    currency?: string
  }
  const accountCurrency = account.currency?.trim().toUpperCase() || 'UNKNOWN'
  const rows: AdSpendRow[] = []
  let nextUrl: string | null = `https://graph.facebook.com/${apiVersion}/act_${accountId}/insights?${new URLSearchParams({
    access_token: accessToken,
    fields: 'date_start,campaign_id,campaign_name,spend',
    level: 'campaign',
    time_increment: '1',
    time_range: JSON.stringify({ since: from, until: to }),
    limit: '500',
  })}`

  for (let page = 0; nextUrl && page < 50; page += 1) {
    const pageUrl = new URL(nextUrl)
    if (pageUrl.protocol !== 'https:' || pageUrl.hostname !== 'graph.facebook.com') throw new Error('Pagination Meta invalide.')
    const response = await fetch(nextUrl, { cache: 'no-store' })
    const payload = await responseJson(response, 'Meta Ads') as {
      data?: Array<{
        date_start?: string
        campaign_id?: string
        campaign_name?: string
        spend?: string
      }>
      paging?: { next?: string }
    }
    if (!payload || !Array.isArray(payload.data)) throw new Error('Rapport Meta incomplet ou invalide.')
    for (const item of payload.data) {
      const amount = Number(item.spend ?? 0)
      if (!item.date_start || !item.campaign_id || !Number.isFinite(amount) || amount < 0) throw new Error('Rapport Meta invalide.')
      rows.push({
        platform: 'meta_ads',
        accountId,
        spendDate: item.date_start,
        campaignId: item.campaign_id,
        campaignName: item.campaign_name?.trim() || `Campagne ${item.campaign_id}`,
        amount: roundCurrency(amount),
        currency: accountCurrency,
      })
    }
    if (payload.paging?.next !== undefined && (typeof payload.paging.next !== 'string' || !payload.paging.next.trim())) {
      throw new Error('Pagination Meta invalide.')
    }
    nextUrl = payload.paging?.next ?? null
  }
  if (nextUrl) throw new Error('Rapport Meta incomplet : limite de pagination atteinte. Réduisez la période.')
  return { rows, currency: accountCurrency }
}

async function replaceSpendRows(platform: AdPlatform, accountId: string, from: string, to: string, currency: string, rows: AdSpendRow[]) {
  validateSpendReplacement(platform, accountId, from, to, currency, rows)
  // Une seule transaction remplace les lignes, recalcule le budget et confirme la couverture.
  // Si la migration manque ou échoue, aucune suppression de secours n'est permise.
  const { error } = await getSupabaseAdmin().rpc('replace_ad_spend', {
    p_platform: platform, p_account_id: accountId, p_from: from, p_to: to, p_currency: currency,
    p_rows: rows.map(row => ({ spend_date: row.spendDate, campaign_id: row.campaignId,
      campaign_name: row.campaignName, amount: row.amount })),
  })
  if (error) throw new Error('La sauvegarde transactionnelle des dépenses a échoué. Les données précédentes sont conservées.')
}

export async function ingestGoogleAdsSpend(input: {
  accountId: string
  currency: string
  from: string
  to: string
  rows: Array<{ date: string; campaignId: string; campaignName: string; amount: number }>
}) {
  const rows: AdSpendRow[] = input.rows
    .map((row) => ({
      platform: 'google_ads',
      accountId: input.accountId,
      spendDate: row.date,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      amount: row.amount,
      currency: input.currency,
    }))

  await replaceSpendRows('google_ads', input.accountId, input.from, input.to, input.currency, rows)

  const result: SyncResult = {
    platform: 'google_ads',
    status: 'success',
    rows: rows.length,
    amount: roundCurrency(rows.reduce((sum, row) => sum + row.amount, 0)),
    currency: input.currency,
    message: `${rows.length} ligne(s) synchronisée(s) par Google Ads Script.`,
  }
  return result
}

function isGoogleConfigured() {
  return [
    'GOOGLE_ADS_CUSTOMER_ID',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
  ].every(configured)
}

function isMetaConfigured() {
  return ['META_AD_ACCOUNT_ID', 'META_ADS_ACCESS_TOKEN'].every(configured)
}

export async function syncAdSpend(lookbackDays = 45, includeToday = false) {
  const range = getAdSpendRange(lookbackDays, new Date(), includeToday)
  const providers: Array<{
    platform: AdPlatform
    ready: boolean
    fetcher: (from: string, to: string) => Promise<FetchedSpend>
    accountEnv: string
  }> = [
    { platform: 'google_ads', ready: isGoogleConfigured(), fetcher: fetchGoogleSpend, accountEnv: 'GOOGLE_ADS_CUSTOMER_ID' },
    { platform: 'meta_ads', ready: isMetaConfigured(), fetcher: fetchMetaSpend, accountEnv: 'META_AD_ACCOUNT_ID' },
  ]
  const results: SyncResult[] = []

  for (const provider of providers) {
    if (!provider.ready) {
      results.push({ platform: provider.platform, status: 'skipped', rows: 0, amount: 0, currency: null, message: 'Identifiants non configurés.' })
      continue
    }
    try {
      const { rows, currency } = await provider.fetcher(range.from, range.to)
      const accountId = cleanAdsAccountId(requireEnv(provider.accountEnv))
      await replaceSpendRows(provider.platform, accountId, range.from, range.to, currency, rows)
      results.push({
        platform: provider.platform,
        status: 'success',
        rows: rows.length,
        amount: roundCurrency(rows.reduce((sum, row) => sum + row.amount, 0)),
        currency,
        message: `${rows.length} ligne(s) synchronisée(s).`,
      })
    } catch (error) {
      results.push({
        platform: provider.platform,
        status: 'error',
        rows: 0,
        amount: 0,
        currency: null,
        message: error instanceof Error ? error.message : 'Erreur inconnue.',
      })
    }
  }

  return { range, results }
}

