import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { getAcquisitionPeriod, summarizeAcquisitionSpend, type AdSpendSyncRun } from '../lib/acquisitionReporting.ts'
import { buildDefaultTimeEntry, buildPayrollRow, getAdministrativeHourlyRate, getDatesInRange, getPlannedHours, type AdministrativeStaff } from '../lib/administrativePayroll.ts'

test('raccourcis de période : Toronto, lundi, mois précédent et année bissextile', () => {
  const now = new Date('2026-10-14T16:00:00Z')
  assert.deepEqual(getAcquisitionPeriod('today', now), { from: '2026-10-14', to: '2026-10-14' })
  assert.deepEqual(getAcquisitionPeriod('yesterday', now), { from: '2026-10-13', to: '2026-10-13' })
  assert.deepEqual(getAcquisitionPeriod('this_week', now), { from: '2026-10-12', to: '2026-10-14' })
  assert.deepEqual(getAcquisitionPeriod('last_week', now), { from: '2026-10-05', to: '2026-10-11' })
  assert.deepEqual(getAcquisitionPeriod('this_month', now), { from: '2026-10-01', to: '2026-10-14' })
  assert.deepEqual(getAcquisitionPeriod('last_month', now), { from: '2026-09-01', to: '2026-09-30' })
  assert.deepEqual(getAcquisitionPeriod('last_7_days', now), { from: '2026-10-08', to: '2026-10-14' })
  assert.deepEqual(getAcquisitionPeriod('last_30_days', now), { from: '2026-09-15', to: '2026-10-14' })
  assert.deepEqual(getAcquisitionPeriod('today', new Date('2026-10-15T02:00:00Z')), { from: '2026-10-14', to: '2026-10-14' })
  assert.deepEqual(getAcquisitionPeriod('last_month', new Date('2024-03-01T17:00:00Z')), { from: '2024-02-01', to: '2024-02-29' })
  assert.deepEqual(getAcquisitionPeriod('last_week', new Date('2026-01-05T17:00:00Z')), { from: '2025-12-29', to: '2026-01-04' })
})

const report = (from: string, to: string, platform = 'google_ads', status = 'success'): AdSpendSyncRun => ({
  range_start: from, range_end: to, started_at: '2026-10-14T10:00:00Z', details: [{ platform, status }],
})
test('le coût journalier ignore les jours hors période, distingue zéro confirmé et rapport absent', () => {
  const spend = summarizeAcquisitionSpend([
    { platform: 'google_ads', spend_date: '2026-10-13', amount: 1173, currency: 'CAD' },
    { platform: 'google_ads', spend_date: '2026-10-14', amount: '12.34', currency: 'CAD' },
  ], [report('2026-10-01', '2026-10-14')], '2026-10-14', '2026-10-14')
  assert.equal(spend[0].amount, 12.34)
  assert.equal(spend[0].complete, true)
  assert.equal(spend[1].amount, null)
  assert.equal(spend[1].complete, false)
  assert.equal(summarizeAcquisitionSpend([], [report('2026-10-01', '2026-10-14')], '2026-10-14', '2026-10-14')[0].amount, 0)
})
test('une période trouée, la journée non synchronisée et les devises différentes restent incomplètes', () => {
  for (const runs of [
    [report('2026-10-01', '2026-10-13')],
    [report('2026-10-01', '2026-10-12'), report('2026-10-14', '2026-10-14')],
    [report('2026-10-01', '2026-10-14', 'google_ads', 'skipped')],
  ]) assert.equal(summarizeAcquisitionSpend([], runs, '2026-10-12', '2026-10-14')[0].complete, false)
  assert.equal(summarizeAcquisitionSpend([], [report('2026-10-12', '2026-10-13'), report('2026-10-14', '2026-10-14')], '2026-10-12', '2026-10-14')[0].complete, true)
  assert.equal(summarizeAcquisitionSpend([{ platform: 'google_ads', spend_date: '2026-10-14', amount: 10, currency: 'USD' }], [report('2026-10-14', '2026-10-14')], '2026-10-14', '2026-10-14')[0].amount, null)
})

test('horaire daté : jours antérieurs et taux inchangés, heure supplémentaire payée dès le 14', () => {
  const original: AdministrativeStaff = { id: 'staff-fixture', profile_id: null, full_name: 'Adjointe fictive', email: null,
    hourly_rate: 35.8, monthly_salary: 3100, vacation_days_per_year: 10,
    default_schedule: [1, 2, 3, 4, 5].map(weekday => ({ weekday, startTime: '08:00', endTime: '12:00' })) }
  const updated = { ...original, default_schedule: [...original.default_schedule!,
    ...[1, 2, 3, 4, 5].map(weekday => ({ weekday, startTime: '08:00', endTime: '13:00', effectiveFrom: '2026-10-14' }))] }
  assert.equal(getPlannedHours(updated, '2026-10-13'), 4)
  assert.equal(getPlannedHours(updated, '2026-10-14'), 5)
  assert.equal(getPlannedHours(updated, '2026-10-17'), 0)
  assert.equal(getPlannedHours(updated, '2026-11-02'), 5)
  const rate = getAdministrativeHourlyRate(updated, '2026-10')
  assert.equal(rate, getAdministrativeHourlyRate(original, '2026-10'))
  const total = getDatesInRange('2026-10-01', '2026-10-31').reduce((sum, dateValue) => {
    const entry = buildDefaultTimeEntry({ staff: updated, dateValue, holidayName: null })
    return sum + buildPayrollRow({ staff: updated, entry, holidayName: null, hourlyRateOverride: rate }).amount
  }, 0)
  assert.ok(Math.abs(total - (3100 + 13 * rate)) < 0.000001)
  const custom = buildDefaultTimeEntry({ staff: updated, dateValue: '2026-10-15', holidayName: null })
  assert.equal(buildPayrollRow({ staff: updated, entry: { ...custom, hours: 2 }, holidayName: null, hourlyRateOverride: rate }).payableHours, 2)
  const novemberHours = getDatesInRange('2026-11-01', '2026-11-30').reduce((sum, date) => sum + getPlannedHours(updated, date), 0)
  assert.equal(Math.round(novemberHours * getAdministrativeHourlyRate(updated, '2026-11')), 3875)
})

test('vraie API Acquisition : pagination, journée Toronto, coût sélectionné et erreur de rapport', () => {
  const child = spawnSync(process.execPath, ['--import', './tests/register-aliases.mjs', '--experimental-strip-types', './tests/helpers/acquisitionReportingRoutes.mjs'], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr || child.stdout)
})
