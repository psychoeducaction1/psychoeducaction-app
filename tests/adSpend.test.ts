import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  cleanAdsAccountId,
  getAdSpendRange,
  monthKeysBetween,
  parseGoogleAdsIngestPayload,
  roundCurrency,
} from '../lib/adSpend.ts'

test('nettoie les identifiants de comptes publicitaires', () => {
  assert.equal(cleanAdsAccountId('act_123-456-7890'), '1234567890')
})

test('calcule une plage terminée à la veille en heure de Toronto', () => {
  const range = getAdSpendRange(3, new Date('2026-10-11T16:00:00Z'))
  assert.deepEqual(range, { from: '2026-10-08', to: '2026-10-10' })
})

test('énumère les mois touchés par une synchronisation', () => {
  assert.deepEqual(monthKeysBetween('2026-08-28', '2026-10-10'), [
    '2026-08',
    '2026-09',
    '2026-10',
  ])
})

test('arrondit les dépenses en cents', () => {
  assert.equal(roundCurrency(12.345), 12.35)
})

test('valide et normalise un envoi Google Ads Script', () => {
  assert.deepEqual(parseGoogleAdsIngestPayload({
    accountId: '669-393-0653',
    currency: 'cad',
    from: '2026-10-01',
    to: '2026-10-10',
    rows: [{ date: '2026-10-09', campaignId: '12', campaignName: 'Prospects', amount: 4.567 }],
  }), {
    accountId: '6693930653',
    currency: 'CAD',
    from: '2026-10-01',
    to: '2026-10-10',
    rows: [{ date: '2026-10-09', campaignId: '12', campaignName: 'Prospects', amount: 4.57 }],
  })
})

test('refuse une ligne Google Ads hors de la plage annoncée', () => {
  assert.throws(() => parseGoogleAdsIngestPayload({
    accountId: '6693930653',
    currency: 'CAD',
    from: '2026-10-01',
    to: '2026-10-10',
    rows: [{ date: '2026-09-30', campaignId: '12', campaignName: 'Prospects', amount: 4 }],
  }), /Date invalide/)
})

test('le cron exige un secret et les fournisseurs utilisent les rapports officiels', async () => {
  const [cron, sync] = await Promise.all([
    readFile(new URL('../app/api/cron/ad-spend-sync/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/adSpendSync.ts', import.meta.url), 'utf8'),
  ])
  assert.match(cron, /Bearer \$\{secret\}/)
  assert.match(sync, /metrics\.cost_micros/)
  assert.match(sync, /level: 'campaign'/)
  assert.match(sync, /time_increment: '1'/)
  assert.doesNotMatch(sync, /NEXT_PUBLIC_GOOGLE|NEXT_PUBLIC_META/)
})

