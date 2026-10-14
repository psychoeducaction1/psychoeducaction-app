import assert from 'node:assert/strict'
import test from 'node:test'
import { buildEligibleList, getSatisfactionRecencyWindow, groupEncountersByClient, isRecentSatisfactionEncounter, shouldShowSatisfactionInvitation } from '../lib/satisfaction.ts'
import { analyzeSatisfactionImport, getSatisfactionPage, refreshSatisfactionAnalysisRecency, type SatisfactionAnalysis } from '../lib/satisfactionWorkspace.ts'

const now = new Date('2026-10-14T16:00:00Z')
test('récence : 30 jours Toronto, dates futures admises, anciennes/absentes/impossibles refusées', () => {
  assert.deepEqual(getSatisfactionRecencyWindow(now), { from: '2026-09-15', to: '2026-10-14' })
  for (const date of ['2026-09-15', '2026-10-14', '2026-10-15', '2027-01-01']) assert.equal(isRecentSatisfactionEncounter(date, now), true)
  for (const date of ['2026-09-14', '2026-09-31', '2026-11-31', null, undefined]) assert.equal(isRecentSatisfactionEncounter(date, now), false)
  assert.deepEqual(getSatisfactionRecencyWindow(new Date('2026-10-14T03:59:59Z')), { from: '2026-09-14', to: '2026-10-13' })
  assert.deepEqual(getSatisfactionRecencyWindow(new Date('2024-03-29T16:00:00Z')), { from: '2024-02-29', to: '2024-03-29' })
})

test('une rencontre à venir conserve le suivi actif même si les précédentes sont anciennes', () => {
  const encounters = ['2026-01-01', '2026-03-01', '2026-06-01', '2026-10-28'].map(date => ({
    clientNom: 'Client fictif', clientNomNormalise: 'client fictif', requerantNom: null, professionnel: null, date,
  }))
  const groups = groupEncountersByClient(encounters, '2026-01-01', '2026-10-31')
  assert.equal(buildEligibleList(groups, new Set(), new Set(), now).length, 1)
  const analysis = analyzeSatisfactionImport(encounters, '2026-01-01', '2026-10-31', new Set(), new Set(), [], now)
  assert.equal(analysis.rows[0].eligible, true)
  assert.deepEqual(analysis.rows[0].reasons, [])
  assert.equal(refreshSatisfactionAnalysisRecency(analysis, now)!.rows[0].eligible, true)
  assert.equal(buildEligibleList(groups, new Set(['client fictif']), new Set(), now).length, 0)
  assert.equal(buildEligibleList(groups, new Set(), new Set(['client fictif']), now).length, 0)
})

test('quatre rencontres sur la période importée suffisent si la dernière est récente; aucun seuil de quatre sur le dernier mois', () => {
  const encounters = ['2026-01-01', '2026-03-01', '2026-06-01', '2026-10-01'].map(date => ({
    clientNom: 'Client fictif', clientNomNormalise: 'client fictif', requerantNom: null, professionnel: null, date,
  }))
  const groups = groupEncountersByClient(encounters, '2026-01-01', '2026-10-14')
  assert.equal(buildEligibleList(groups, new Set(), new Set(), now).length, 1)
  assert.equal(analyzeSatisfactionImport(encounters, '2026-01-01', '2026-10-14', new Set(), new Set(), [], now).rows[0].eligible, true)
  assert.equal(buildEligibleList(groups, new Set(), new Set(), new Date('2026-11-14T17:00:00Z')).length, 0)
})

test('les analyses anciennes sont filtrées sans écriture et les motifs antérieurs restent présents', () => {
  const analysis: SatisfactionAnalysis = { version: 1, rows: [{ clientNom: 'Client fictif', destinataireNom: 'Client fictif', professionnel: null,
    nbRencontres: 4, derniereRencontre: '2026-08-01', eligible: true, reasons: [], contactIssue: null }] }
  const updated = refreshSatisfactionAnalysisRecency(analysis, now)!
  assert.equal(updated.rows[0].eligible, false)
  assert.match(updated.rows[0].reasons[0], /30 derniers jours/)
  assert.equal(analysis.rows[0].eligible, true)
  assert.equal(analysis.rows[0].reasons.length, 0)
  assert.deepEqual(refreshSatisfactionAnalysisRecency(updated, now), updated)
  analysis.rows[0].eligible = false; analysis.rows[0].reasons = ['Désabonné']
  assert.equal(refreshSatisfactionAnalysisRecency(analysis, now)!.rows[0].reasons[0], 'Désabonné')
  assert.equal(refreshSatisfactionAnalysisRecency(null, now), null)
  analysis.rows[0] = { ...analysis.rows[0], derniereRencontre: '2026-10-15', eligible: false, reasons: ['Dernière rencontre dans le futur'] }
  // Pas de candidat virtuel si l'ancienne règle a empêché sa création à l'import.
  assert.match(refreshSatisfactionAnalysisRecency(analysis, now)!.rows[0].reasons[0], /export à jour/)
  const later = refreshSatisfactionAnalysisRecency(analysis, new Date('2026-10-20T16:00:00Z'))!
  assert.equal(later.rows[0].eligible, false)
  assert.match(later.rows[0].reasons[0], /export à jour/)
})

test('un dossier récent garde ses exclusions et les anciens envois/réponses restent dans l’historique', () => {
  assert.equal(shouldShowSatisfactionInvitation({ statut: 'en_attente', derniere_rencontre: '2026-08-01' }, now), false)
  assert.equal(shouldShowSatisfactionInvitation({ statut: 'exclu', derniere_rencontre: '2026-08-01' }, now), false)
  assert.equal(shouldShowSatisfactionInvitation({ statut: 'envoye', derniere_rencontre: '2026-08-01' }, now), true)
  assert.equal(shouldShowSatisfactionInvitation({ statut: 'en_attente', derniere_rencontre: '2026-10-01' }, now), true)
  assert.equal(shouldShowSatisfactionInvitation({ statut: 'en_attente', derniere_rencontre: '2026-10-28' }, now), true)
})

test('pagination : 378 clients en pages de 25, dernière page de 3, filtre avant pagination et page bornée', () => {
  const rows = Array.from({ length: 378 }, (_, i) => i)
  const first = getSatisfactionPage(rows, 1)
  assert.equal(first.rows.length, 25); assert.equal(first.pageCount, 16)
  assert.deepEqual([first.from, first.to], [1, 25])
  const last = getSatisfactionPage(rows, 16)
  assert.deepEqual(last.rows, [375, 376, 377]); assert.deepEqual([last.from, last.to], [376, 378])
  const filtered = getSatisfactionPage(rows.filter(value => value < 7), 16)
  assert.equal(filtered.page, 1); assert.equal(filtered.total, 7)
  assert.equal(getSatisfactionPage(rows, -2).page, 1)
  assert.deepEqual(getSatisfactionPage([], 5), { rows: [], page: 1, pageCount: 1, total: 0, from: 0, to: 0 })
})
