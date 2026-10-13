import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { analyzeSatisfactionImport, isSatisfactionDate, matchesSatisfactionSearch, validateSatisfactionEncounters } from '../lib/satisfactionWorkspace.ts'
import { buildSatisfactionEmail, parseSatisfactionDate } from '../lib/satisfaction.ts'

const encounters = (name: string, count: number) => Array.from({ length: count }, (_, i) => ({
  clientNom: name, clientNomNormalise: name.toLowerCase(), requerantNom: null,
  professionnel: 'Professionnel fictif', date: `2026-03-${String(10 + i).padStart(2, '0')}`,
}))
test('analyse conservée: chaque non-éligibilité est expliquée et un courriel absent ne retire pas un éligible', () => {
  const input = [...encounters('Camille', 3), ...encounters('Léa', 4), ...encounters('Alex', 5), ...encounters('Sam', 4)]
  const rows = analyzeSatisfactionImport(input, '2026-03-01', '2026-03-31', new Set(['alex']), new Set(['sam']), []).rows
  assert.deepEqual(rows.map(row => row.eligible), [false, true, false, false])
  assert.match(rows[0].reasons[0], /Moins de 4/)
  assert.equal(rows[1].contactIssue, 'missing_client')
  assert.deepEqual(rows[2].reasons, ['Déjà sollicité'])
  assert.deepEqual(rows[3].reasons, ['Désabonné'])
})
test('une homonymie est signalée et aucun courriel n’est choisi arbitrairement', () => {
  const input = encounters('Camille', 4)
  const rows = analyzeSatisfactionImport(input, '2026-03-01', '2026-03-31', new Set(), new Set(), [
    { clientName: 'Camille', requesterNames: [], emails: ['first@example.invalid'] },
    { clientName: 'Camille', requesterNames: [], emails: ['other@example.invalid'] },
  ]).rows
  assert.equal(rows[0].contactIssue, 'ambiguous')
  assert.equal('emails' in rows[0], false)
})
test('la recherche ignore les accents, la casse et les espaces et accepte plusieurs mots', () => {
  assert.equal(matchesSatisfactionSearch(' LEA   martin ', ['Léa Martin', 'Professionnel fictif']), true)
  assert.equal(matchesSatisfactionSearch('fictif lea', ['Léa Martin', 'Professionnel fictif']), true)
  assert.equal(matchesSatisfactionSearch('inconnu', ['Léa Martin']), false)
  assert.equal(matchesSatisfactionSearch('', []), true)
})
test('dates Excel natives et dates impossibles: validation sans décalage ni identité fournie par le navigateur', () => {
  assert.equal(parseSatisfactionDate(new Date('2026-03-10T00:00:00Z')), '2026-03-10')
  assert.equal(parseSatisfactionDate(46091), '2026-03-10')
  assert.equal(parseSatisfactionDate('2026-02-30'), null)
  assert.equal(isSatisfactionDate('2026-02-30'), false)
  assert.equal(validateSatisfactionEncounters([{ ...encounters('Camille', 1)[0], clientNomNormalise: 'spoofed' }])?.[0].clientNomNormalise, 'camille')
  assert.equal(validateSatisfactionEncounters([{ date: '2026-03-10' }]), null)
})
test('le courriel test affiche le même modèle, sans lien ni jeton permettant une action réelle', () => {
  const message = buildSatisfactionEmail({ destinatairePrenom: 'Exemple', professionnel: '<script>fictif</script>',
    lienReponse: 'https://fixture.example.invalid/secret-response', lienDesabonnement: 'https://fixture.example.invalid/secret-unsubscribe', test: true })
  assert.match(message.subject, /^\[TEST\]/)
  assert.match(message.html, /TEST/)
  assert.match(message.html, /&lt;script&gt;/)
  assert.doesNotMatch(message.html, /href=|secret-response|secret-unsubscribe|<script>/)
  assert.doesNotMatch(message.text, /secret-response|secret-unsubscribe/)
  const real = buildSatisfactionEmail({ destinatairePrenom: 'Exemple', lienReponse: 'https://fixture.example.invalid/response', lienDesabonnement: 'https://fixture.example.invalid/unsubscribe' })
  assert.match(real.html, /href="https:\/\/fixture.example.invalid\/response"/)
  assert.doesNotMatch(real.subject, /TEST/)
})
test('vraies API satisfaction: dates automatiques, import vide visible, résultats et test isolé', () => {
  const result = spawnSync(process.execPath, ['--import', new URL('./register-aliases.mjs', import.meta.url).href,
    '--experimental-strip-types', fileURLToPath(new URL('./helpers/satisfactionWorkspaceRoutes.mjs', import.meta.url)),
  ], { encoding: 'utf8', timeout: 10000, windowsHide: true })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
})
