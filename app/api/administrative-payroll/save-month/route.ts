import { hasDirectionAccess } from '@/lib/administrativeAccess'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getBearerToken } from '@/lib/superAdminServer'
import { hasPlatformAccess } from '@/lib/platformAccess'
import { isSuperAdmin, normalizeEmail } from '@/lib/superAdmin'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { computeAdministrativePayrollTotals, parseAdministrativePayrollRequest } from '@/lib/administrativePayrollPersistence'
import { getMonthDateRange, roundMoney } from '@/lib/administrativePayroll'
import type { AdministrativeStaff, AdministrativeTimeEntry, MoroccoHoliday } from '@/lib/administrativePayroll'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }
type StaffRow = Omit<AdministrativeStaff, 'default_schedule' | 'hourly_rate' | 'monthly_salary'> & {
  default_schedule: unknown; hourly_rate: number | string; monthly_salary: number | string | null
}
type Rate = { rate: number; date: string; source: string; verifiedAt: string; verifiedBy: string }
type SavedRate = { staff_id: string; mad_to_cad_rate: number | string; rate_date: string; rate_source: string; rate_verified_at: string | null; rate_verified_by: string | null }

function normalizeStaff(row: StaffRow): AdministrativeStaff {
  const schedule = Array.isArray(row.default_schedule) ? row.default_schedule.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const weekday = Number(item.weekday)
    const startTime = String(item.startTime ?? item.start_time ?? '')
    const endTime = String(item.endTime ?? item.end_time ?? '')
    if (!Number.isFinite(weekday) || !startTime || !endTime) return []
    return [{ weekday, startTime, endTime, ...(typeof item.effectiveFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.effectiveFrom) ? { effectiveFrom: item.effectiveFrom } : {}) }]
  }) : null
  return { ...row, hourly_rate: Number(row.hourly_rate), monthly_salary: row.monthly_salary == null ? null : Number(row.monthly_salary), default_schedule: schedule }
}
function savedRate(row: SavedRate | undefined): Rate | null {
  if (!row?.rate_verified_at || !row.rate_verified_by || !Number.isFinite(Date.parse(row.rate_verified_at))
    || !Number.isFinite(Number(row.mad_to_cad_rate)) || Number(row.mad_to_cad_rate) <= 0
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.rate_date) || !row.rate_source?.trim()) return null
  return { rate: Number(row.mad_to_cad_rate), date: row.rate_date, source: row.rate_source, verifiedAt: row.rate_verified_at, verifiedBy: row.rate_verified_by }
}
async function readRequest(request: Request) {
  const reader = request.body?.getReader()
  if (!reader || Number(request.headers.get('content-length')) > 2_048) throw new Error('Requête trop volumineuse.')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 2_048) { await reader.cancel(); throw new Error('Requête trop volumineuse.') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown
}

export async function POST(request: NextRequest) {
  const json = (body: object, status = 200) => NextResponse.json(body, { status, headers })
  const token = getBearerToken(request)
  if (!token) return json({ error: 'Connexion requise.' }, 401)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return json({ error: 'Configuration indisponible.' }, 500)
  const db = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const { data: { user }, error: authError } = await db.auth.getUser()
    if (authError || !user) return json({ error: 'Session invalide.' }, 401)
    const { data: profile, error: profileError } = await db.from('profiles').select('role, platform_access_enabled, administrative_access').eq('id', user.id).limit(1).maybeSingle()
    if (profileError) return json({ error: 'Impossible de vérifier les droits.' }, 500)
    if (!profile || !hasPlatformAccess(profile) || !['direction', 'professionnel'].includes(profile.role ?? '')) return json({ error: 'Accès refusé.' }, 403)
    let body
    try { body = parseAdministrativePayrollRequest(await readRequest(request)) } catch { return json({ error: 'Requête invalide.' }, 400) }
    if (!body) return json({ error: 'Transmettez uniquement un mois et les identifiants du personnel, sans montants ni taux.' }, 400)
    const { data: staffData, error: staffError } = await db.from('administrative_staff')
      .select('id, profile_id, full_name, email, hourly_rate, monthly_salary, monthly_salary_history, vacation_days_per_year, default_schedule')
      .eq('is_active', true)
    if (staffError) return json({ error: 'Personnel indisponible.' }, 500)
    const own = (row: StaffRow) => row.profile_id === user.id || (Boolean(row.email) && normalizeEmail(row.email) === normalizeEmail(user.email))
    const staffRows = (staffData ?? []) as StaffRow[]
    const manager = hasDirectionAccess(profile) && (isSuperAdmin(user, profile) || !staffRows.some(own))
    const selected = body.staffIds.map(id => staffRows.find(row => row.id === id && (manager || own(row))))
    if (selected.some(row => !row)) return json({ error: 'Personnel non autorisé.' }, 403)
    const people = (selected as StaffRow[]).map(normalizeStaff)
    const { startDate, endDate } = getMonthDateRange(body.month)
    const [entriesResult, holidaysResult, monthsResult] = await Promise.all([
      db.from('administrative_time_entries').select('staff_id, work_date, start_time, end_time, break_minutes, entry_type, hours, note').in('staff_id', body.staffIds).gte('work_date', startDate).lte('work_date', endDate),
      db.from('morocco_holidays').select('holiday_date, name').gte('holiday_date', startDate).lte('holiday_date', endDate),
      db.from('administrative_payroll_months').select('staff_id, mad_to_cad_rate, rate_date, rate_source, rate_verified_at, rate_verified_by').in('staff_id', body.staffIds).eq('payroll_month', `${body.month}-01`),
    ])
    if (entriesResult.error || holidaysResult.error || monthsResult.error) return json({ error: 'Lecture de la paie impossible. Vérifiez le schéma et la migration des permissions avant publication.' }, 500)
    const totals = computeAdministrativePayrollTotals(people, (entriesResult.data ?? []) as AdministrativeTimeEntry[], (holidaysResult.data ?? []) as MoroccoHoliday[], body.month)
    const previous = (monthsResult.data ?? []) as SavedRate[]
    const rates = new Map(totals.map(total => [total.staffId, manager ? null : savedRate(previous.find(row => row.staff_id === total.staffId))]))
    if ([...rates.values()].some(rate => !rate)) {
      let rate: Rate
      try {
        const response = await fetch('https://api.frankfurter.dev/v2/rate/MAD/CAD', { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
        if (!response.ok) throw new Error('Taux indisponible')
        const result = await response.json()
        if (!Number.isFinite(Number(result.rate)) || Number(result.rate) <= 0 || typeof result.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) throw new Error('Taux invalide')
        rate = { rate: Number(result.rate), date: result.date, source: 'Frankfurter', verifiedAt: new Date().toISOString(), verifiedBy: user.id }
      } catch { return json({ error: 'Taux MAD/CAD indisponible. Aucun montant mensuel modifié; vos heures restent sauvegardées.' }, 502) }
      for (const [id, existing] of rates) if (!existing) rates.set(id, rate)
    }
    const paymentDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const rows = totals.map(total => {
      const rate = rates.get(total.staffId)!
      return { staff_id: total.staffId, payroll_month: `${body.month}-01`, payable_hours: total.payableHours,
        total_mad: total.totalMad, mad_to_cad_rate: rate.rate, total_cad: roundMoney(total.totalMad * rate.rate),
        rate_date: rate.date, payment_date: paymentDate, rate_source: rate.source,
        rate_verified_at: rate.verifiedAt, rate_verified_by: rate.verifiedBy, updated_by: user.id }
    })
    // Dernière lecture avec JWT: une révocation pendant la préparation bloque l'écriture privilégiée.
    const { data: current, error: currentError } = await db.from('profiles').select('role, platform_access_enabled, administrative_access').eq('id', user.id).limit(1).maybeSingle()
    if (currentError || !hasPlatformAccess(current) || current?.role !== profile.role) return json({ error: 'Vos droits ont changé. Aucun montant mensuel enregistré.' }, 403)
    const { error: saveError } = await getSupabaseAdmin().from('administrative_payroll_months').upsert(rows, { onConflict: 'staff_id,payroll_month' })
    if (saveError) return json({ error: 'Enregistrement des montants impossible. Vos heures sont conservées; vérifiez la migration avant publication.' }, 500)
    return json({ totalCad: roundMoney(rows.reduce((sum, row) => sum + row.total_cad, 0)), rateDates: [...new Set(rows.map(row => row.rate_date))] })
  } catch { return json({ error: 'Impossible de sauvegarder les montants mensuels. Aucun nouvel essai automatique.' }, 500) }
}
