import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createSupabaseStub } from './supabaseStub.ts'
import { SUPER_ADMIN_EMAIL } from '../../lib/superAdmin.ts'
let allowed = true
let fail = false
const daily = Array.from({ length: 1101 }, (_, i) => ({ id: String(i).padStart(4, '0'), platform: 'google_ads', spend_date: '2026-10-14', amount: 1, currency: 'CAD' }))
const tables = {
  public_intake_prospects: [
    { id: 'before', created_at: '2026-10-14T03:59:59Z' },
    { id: 'included', created_at: '2026-10-14T04:00:00Z' },
    { id: 'after', created_at: '2026-10-15T04:00:00Z' },
  ], public_acquisition_events: [],
  budget_variable_expenses: [{ id: 'monthly', ad_platform: 'google_ads', expense_month: '2026-10-01', amount: 1173 }],
  ad_spend_daily: [...daily, { id: 'outside', platform: 'google_ads', spend_date: '2026-10-13', amount: 900, currency: 'CAD' }],
  ad_spend_sync_runs: [{ id: 'report', started_at: '2026-10-14T16:00:00Z', range_start: '2026-10-01', range_end: '2026-10-14', details: [{ platform: 'google_ads', status: 'success' }] }],
}
globalThis.acquisitionFixtureContext = async () => ({ context: { user: { id: 'fixture-owner', email: allowed ? SUPER_ADMIN_EMAIL : 'assistant@example.invalid' }, profile: { role: 'direction' } } })
globalThis.acquisitionFixtureAdmin = () => {
  assert.equal(allowed, true, 'Privileged access before authorization')
  return createSupabaseStub(tables, fail ? { 'ad_spend_daily:select': 'fixture report error' } : {}).client
}
const moduleUrl = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/lib/directionServer') return { url: moduleUrl('export const getDirectionContext = globalThis.acquisitionFixtureContext'), shortCircuit: true }
  if (specifier === '@/lib/supabaseAdmin') return { url: moduleUrl('export const getSupabaseAdmin = globalThis.acquisitionFixtureAdmin'), shortCircuit: true }
  if (specifier === 'next/server') return next('next/server.js', context)
  return next(specifier, context)
} })
const { GET } = await import('../../app/api/direction/acquisition/route.ts')
const { NextRequest } = await import('next/server.js')
const request = () => new NextRequest('https://fixture.example.invalid/api/direction/acquisition?from=2026-10-14&to=2026-10-14')
const response = await GET(request())
assert.equal(response.status, 200)
const body = await response.json()
assert.deepEqual(body.prospects.map(x => x.id), ['included'])
assert.equal(body.expenses[0].amount, 1173)
assert.equal(body.spend[0].amount, 1101)
assert.equal(body.spend[0].complete, true)
assert.equal(body.spend[1].amount, null)
fail = true
assert.equal((await GET(request())).status, 500)
fail = false
assert.equal((await GET(new NextRequest('https://fixture.example.invalid/api/direction/acquisition?from=2026-02-30&to=2026-03-01'))).status, 400)
allowed = false
assert.equal((await GET(request())).status, 403)
