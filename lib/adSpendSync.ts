import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  cleanAdsAccountId,
  getAdSpendRange,
  monthKeysBetween,
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
    throw new Error(`${provider} a répondu ${response.status}: ${text.slice(0, 500)}`)
  }
  return text ? JSON.parse(text) as unknown : null
}

async function fetchGoogleSpend(from: string, to: string): Promise<AdSpendRow[]> {
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

  return (batches ?? []).flatMap((batch) => batch.results ?? []).flatMap((row) => {
    const spendDate = row.segments?.date ?? ''
    const campaignId = String(row.campaign?.id ?? '')
    const amount = Number(row.metrics?.costMicros ?? 0) / 1_000_000
    if (!spendDate || !campaignId || !Number.isFinite(amount) || amount <= 0) return []
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
}

async function fetchMetaSpend(from: string, to: string): Promise<AdSpendRow[]> {
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
    for (const item of payload.data ?? []) {
      const amount = Number(item.spend ?? 0)
      if (!item.date_start || !item.campaign_id || !Number.isFinite(amount) || amount <= 0) continue
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
    nextUrl = payload.paging?.next ?? null
  }
  return rows
}

async function replaceSpendRows(platform: AdPlatform, accountId: string, from: string, to: string, rows: AdSpendRow[]) {
  const supabase = getSupabaseAdmin()
  const { error: deleteError } = await supabase
    .from('ad_spend_daily')
    .delete()
    .eq('platform', platform)
    .eq('account_id', accountId)
    .gte('spend_date', from)
    .lte('spend_date', to)
  if (deleteError) throw deleteError

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from('ad_spend_daily').insert(
      rows.map((row) => ({
        platform: row.platform,
        account_id: row.accountId,
        spend_date: row.spendDate,
        campaign_id: row.campaignId,
        campaign_name: row.campaignName,
        amount: row.amount,
        currency: row.currency,
        synced_at: new Date().toISOString(),
      }))
    )
    if (insertError) throw insertError
  }
}

async function refreshMonthlyBudget(platform: AdPlatform, from: string, to: string) {
  const supabase = getSupabaseAdmin()
  const label = platform === 'google_ads' ? 'Google Ads' : 'Meta Ads'

  for (const month of monthKeysBetween(from, to)) {
    const monthStart = `${month}-01`
    const nextMonth = new Date(`${monthStart}T12:00:00Z`)
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
    const nextMonthStart = nextMonth.toISOString().slice(0, 10)
    const { data: spendRows, error: spendError } = await supabase
      .from('ad_spend_daily')
      .select('amount, currency')
      .eq('platform', platform)
      .gte('spend_date', monthStart)
      .lt('spend_date', nextMonthStart)
    if (spendError) throw spendError

    const currencies = new Set((spendRows ?? []).map((row) => row.currency))
    if ([...currencies].some((currency) => currency !== 'CAD')) {
      throw new Error(`${label}: le compte publicitaire doit être facturé en CAD.`)
    }
    const amount = roundCurrency(
      (spendRows ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
    )
    const values = {
      name: `Publicité ${label} – ${month}`,
      category: 'Publicité numérique',
      amount,
      expense_date: monthStart,
      expense_month: monthStart,
      ad_platform: platform,
      notes: `Synchronisé automatiquement depuis ${label}.`,
      updated_at: new Date().toISOString(),
    }
    const { data: existing, error: lookupError } = await supabase
      .from('budget_variable_expenses')
      .select('id')
      .eq('ad_platform', platform)
      .eq('expense_month', monthStart)
      .maybeSingle()
    if (lookupError) throw lookupError
    const query = existing
      ? supabase.from('budget_variable_expenses').update(values).eq('id', existing.id)
      : supabase.from('budget_variable_expenses').insert(values)
    const { error } = await query
    if (error) throw error
  }
}

export async function ingestGoogleAdsSpend(input: {
  accountId: string
  currency: string
  from: string
  to: string
  rows: Array<{ date: string; campaignId: string; campaignName: string; amount: number }>
}) {
  const rows: AdSpendRow[] = input.rows
    .filter((row) => row.amount > 0)
    .map((row) => ({
      platform: 'google_ads',
      accountId: input.accountId,
      spendDate: row.date,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      amount: row.amount,
      currency: input.currency,
    }))

  await replaceSpendRows('google_ads', input.accountId, input.from, input.to, rows)
  await refreshMonthlyBudget('google_ads', input.from, input.to)

  const result: SyncResult = {
    platform: 'google_ads',
    status: 'success',
    rows: rows.length,
    amount: roundCurrency(rows.reduce((sum, row) => sum + row.amount, 0)),
    currency: input.currency,
    message: `${rows.length} ligne(s) synchronisée(s) par Google Ads Script.`,
  }
  await getSupabaseAdmin().from('ad_spend_sync_runs').insert({
    range_start: input.from,
    range_end: input.to,
    status: 'success',
    details: [result],
  })
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

export async function syncAdSpend(lookbackDays = 45) {
  const range = getAdSpendRange(lookbackDays)
  const providers: Array<{
    platform: AdPlatform
    ready: boolean
    fetcher: (from: string, to: string) => Promise<AdSpendRow[]>
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
      const rows = await provider.fetcher(range.from, range.to)
      const accountId = cleanAdsAccountId(requireEnv(provider.accountEnv))
      await replaceSpendRows(provider.platform, accountId, range.from, range.to, rows)
      await refreshMonthlyBudget(provider.platform, range.from, range.to)
      const currencies = [...new Set(rows.map((row) => row.currency))]
      results.push({
        platform: provider.platform,
        status: 'success',
        rows: rows.length,
        amount: roundCurrency(rows.reduce((sum, row) => sum + row.amount, 0)),
        currency: currencies.length === 1 ? currencies[0] : null,
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

  const supabase = getSupabaseAdmin()
  await supabase.from('ad_spend_sync_runs').insert({
    range_start: range.from,
    range_end: range.to,
    status: results.some((result) => result.status === 'error') ? 'partial_error' : 'success',
    details: results,
  })

  return { range, results }
}

