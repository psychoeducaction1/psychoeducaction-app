import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { isSuperAdmin } from '@/lib/superAdmin'
import { torontoLocalToUtc } from '@/lib/publicIntakeSchedule'
import { summarizeAcquisitionSpend } from '@/lib/acquisitionReporting'

const platforms = ['google_ads', 'meta_ads'] as const
type AdPlatform = (typeof platforms)[number]

function isDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

async function readReportRows<T>(page: (offset: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = []
  for (let offset = 0; ; offset += 500) {
    const result = await page(offset)
    if (result.error) return { data: [], error: result.error }
    rows.push(...(result.data ?? []))
    if ((result.data?.length ?? 0) < 500) return { data: rows, error: null }
  }
}

async function authorize(request: NextRequest) {
  const direction = await getDirectionContext(request)
  if (direction.error) return direction
  if (!isSuperAdmin(direction.context.user, direction.context.profile)) {
    return { error: { message: 'Accès réservé à la super administration.', status: 403 } }
  }
  return direction
}

export async function GET(request: NextRequest) {
  const direction = await authorize(request)
  if (direction.error) {
    return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  }

  const from = request.nextUrl.searchParams.get('from')
  const to = request.nextUrl.searchParams.get('to')
  if (!isDate(from) || !isDate(to) || from! > to!) {
    return NextResponse.json({ error: 'Période invalide.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const fromUtc = torontoLocalToUtc(from!, 0, 0).toISOString()
  const dayAfterTo = new Date(`${to}T12:00:00Z`)
  dayAfterTo.setUTCDate(dayAfterTo.getUTCDate() + 1)
  const toExclusiveUtc = torontoLocalToUtc(
    dayAfterTo.toISOString().slice(0, 10),
    0,
    0
  ).toISOString()
  const [
    { data: prospects, error: prospectError },
    { data: events, error: eventError },
    { data: expenses, error: expenseError },
    { data: dailySpend, error: dailySpendError },
    { data: syncRuns, error: syncError },
  ] =
    await Promise.all([
      readReportRows((offset) => supabase
        .from('public_intake_prospects')
        .select('created_at, status, contact_request_type, source, utm, conversion_event_id')
        .gte('created_at', fromUtc)
        .lt('created_at', toExclusiveUtc)
        .order('created_at', { ascending: false }).order('id').range(offset, offset + 499)),
      readReportRows((offset) => supabase
        .from('public_acquisition_events')
        .select('created_at, event_type, source, utm, conversion_event_id')
        .gte('created_at', fromUtc)
        .lt('created_at', toExclusiveUtc)
        .order('created_at', { ascending: false }).order('id').range(offset, offset + 499)),
      supabase
        .from('budget_variable_expenses')
        .select('id, name, amount, expense_date, notes, ad_platform, expense_month')
        .not('ad_platform', 'is', null)
        .gte('expense_month', `${from!.slice(0, 7)}-01`)
        .lte('expense_month', `${to!.slice(0, 7)}-01`)
        .order('expense_month', { ascending: false }),
      readReportRows((offset) => supabase.from('ad_spend_daily')
        .select('platform, spend_date, amount, currency')
        .gte('spend_date', from!).lte('spend_date', to!)
        .order('spend_date').order('id').range(offset, offset + 499)),
      readReportRows((offset) => supabase.from('ad_spend_sync_runs')
        .select('range_start, range_end, started_at, details')
        .order('started_at', { ascending: false }).order('id').range(offset, offset + 499)),
    ])

  if (prospectError || eventError || expenseError || dailySpendError || syncError) {
    return NextResponse.json(
      { error: prospectError?.message ?? eventError?.message ?? expenseError?.message ?? dailySpendError?.message ?? syncError?.message ?? 'Chargement impossible.' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    prospects: prospects ?? [], events: events ?? [], expenses: expenses ?? [],
    spend: summarizeAcquisitionSpend(dailySpend ?? [], syncRuns ?? [], from!, to!),
  })
}

export async function POST(request: NextRequest) {
  const direction = await authorize(request)
  if (direction.error) {
    return NextResponse.json({ error: direction.error.message }, { status: direction.error.status })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const platform = typeof body?.platform === 'string' ? body.platform as AdPlatform : null
  const month = typeof body?.month === 'string' ? body.month : ''
  const amount = Number(body?.amount)
  const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 500) : ''

  if (!platforms.includes(platform as AdPlatform) || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Plateforme ou mois invalide.' }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: 'Le montant doit être positif.' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const expenseMonth = `${month}-01`
  const { data: existing, error: lookupError } = await supabase
    .from('budget_variable_expenses')
    .select('id')
    .eq('ad_platform', platform)
    .eq('expense_month', expenseMonth)
    .maybeSingle()
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 })

  const label = platform === 'google_ads' ? 'Google Ads' : 'Meta Ads'
  const values = {
    name: `Publicité ${label} – ${month}`,
    category: 'Publicité numérique',
    amount,
    expense_date: expenseMonth,
    expense_month: expenseMonth,
    ad_platform: platform,
    notes: notes || 'Montant mensuel saisi depuis le suivi d’acquisition.',
    created_by: direction.context.user.id,
    updated_at: new Date().toISOString(),
  }

  const query = existing
    ? supabase.from('budget_variable_expenses').update(values).eq('id', existing.id)
    : supabase.from('budget_variable_expenses').insert(values)
  const { data, error } = await query
    .select('id, name, amount, expense_date, notes, ad_platform, expense_month')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ expense: data, replaced: Boolean(existing) })
}
