import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  SATISFACTION_MIN_ENCOUNTERS,
  buildEligibleList,
  detectEncounterPeriod,
  extractSatisfactionRows,
  generateSatisfactionToken,
  getFirstName,
  groupEncountersByClient,
  isSatisfactionEncounter,
  normalizeClientName,
  parseSatisfactionDate,
  resolveDestinataire,
  resolveUniqueSatisfactionRecipients,
  type SatisfactionClientGroup,
} from '../lib/satisfaction.ts'

// Noms entièrement fictifs, utilisés uniquement comme données de test.

test('parseSatisfactionDate extrait la date du format multi-lignes Psylog', () => {
  assert.equal(
    parseSatisfactionDate('2026-10-11\nDimanche\n11:15 - 12:15'),
    '2026-10-11'
  )
  assert.equal(parseSatisfactionDate('2026-07-01\nMercredi\n09:00 - 10:00'), '2026-07-01')
})

test('parseSatisfactionDate retourne null pour les valeurs invalides', () => {
  assert.equal(parseSatisfactionDate(null), null)
  assert.equal(parseSatisfactionDate(-123), null)
  assert.equal(parseSatisfactionDate(''), null)
  assert.equal(parseSatisfactionDate('Sans date'), null)
})

test('normalizeClientName retire accents, casse et espaces superflus', () => {
  assert.equal(normalizeClientName('  Marie-Anne  Côté '), 'marie anne cote')
  assert.equal(normalizeClientName('JEAN TREMBLAY'), 'jean tremblay')
  assert.equal(normalizeClientName("Aïcha Benali"), 'aicha benali')
  assert.equal(normalizeClientName(null), '')
})

test('isSatisfactionEncounter reconnaît Rencontre et Rencontre clinique', () => {
  assert.equal(isSatisfactionEncounter('Rencontre', ''), true)
  assert.equal(isSatisfactionEncounter('Rencontre clinique', ''), true)
  assert.equal(isSatisfactionEncounter('rencontre', 'à distance par vidéoconférence'), true)
})

test('isSatisfactionEncounter exclut les autres types d’activités', () => {
  assert.equal(isSatisfactionEncounter('Rédaction', "Rédaction d'un rapport"), false)
  assert.equal(isSatisfactionEncounter('Absence', ''), false)
  assert.equal(isSatisfactionEncounter('Travail clinique', ''), false)
  assert.equal(isSatisfactionEncounter('Activité de groupe', ''), false)
  assert.equal(
    isSatisfactionEncounter('', "Frais d'ouverture de dossier"),
    false
  )
})

test('extractSatisfactionRows ignore les lignes non-rencontres et sans client', () => {
  const rows: unknown[][] = [
    ['Activités détaillées'],
    [],
    ['DATE', 'PROFESSIONNEL', 'CLIENT', 'REQUÉRANT', 'DESCRIPTION', 'DÉTAIL'],
    ['2026-10-01\nJeudi\n10:00 - 11:00', 'Pro Un', 'Marie Côté', '', 'Rencontre', ''],
    ['2026-10-02\nVendredi\n10:00 - 11:00', 'Pro Un', 'Marie Côté', '', 'Rédaction', 'Rapport'],
    ['2026-10-03\nSamedi\n10:00 - 11:00', 'Pro Un', '', '', 'Rencontre', ''],
    ['sans date', 'Pro Un', 'Jean Tremblay', '', 'Rencontre', ''],
  ]

  const encounters = extractSatisfactionRows(rows)

  assert.equal(encounters.length, 1)
  assert.equal(encounters[0].clientNom, 'Marie Côté')
  assert.equal(encounters[0].date, '2026-10-01')
})

test('groupEncountersByClient regroupe, compte et retient le professionnel le plus fréquent', () => {
  const groups = groupEncountersByClient(
    [
      { clientNom: 'Marie Côté', clientNomNormalise: 'marie cote', requerantNom: null, professionnel: 'Pro Un', date: '2026-10-01' },
      { clientNom: 'marie cote', clientNomNormalise: 'marie cote', requerantNom: null, professionnel: 'Pro Deux', date: '2026-10-05' },
      { clientNom: 'Marie Côté', clientNomNormalise: 'marie cote', requerantNom: null, professionnel: 'Pro Un', date: '2026-10-03' },
    ],
    '2026-10-01',
    '2026-10-31'
  )

  assert.equal(groups.length, 1)
  assert.equal(groups[0].nbRencontres, 3)
  assert.equal(groups[0].derniereRencontre, '2026-10-05')
  assert.equal(groups[0].professionnel, 'Pro Un')
})

test('groupEncountersByClient filtre sur la période', () => {
  const groups = groupEncountersByClient(
    [
      { clientNom: 'Jean Tremblay', clientNomNormalise: 'jean tremblay', requerantNom: null, professionnel: null, date: '2026-09-15' },
      { clientNom: 'Jean Tremblay', clientNomNormalise: 'jean tremblay', requerantNom: null, professionnel: null, date: '2026-10-15' },
    ],
    '2026-10-01',
    '2026-10-31'
  )

  assert.equal(groups.length, 1)
  assert.equal(groups[0].nbRencontres, 1)
})

test('le seuil d’éligibilité est d’au moins 4 rencontres', () => {
  assert.equal(SATISFACTION_MIN_ENCOUNTERS, 4)

  const makeGroup = (nb: number): SatisfactionClientGroup => ({
    clientNom: 'Client Test',
    clientNomNormalise: 'client test',
    requerantNom: null,
    destinataireNom: 'Client Test',
    professionnel: null,
    nbRencontres: nb,
    derniereRencontre: '2026-10-01',
  })

  const eligible = buildEligibleList(
    [makeGroup(3), makeGroup(4), makeGroup(7)],
    new Set(),
    new Set()
  )

  assert.deepEqual(
    eligible.map((g) => g.nbRencontres),
    [4, 7]
  )
})

test('buildEligibleList exclut les déjà-sollicités et les désabonnés', () => {
  const makeGroup = (nom: string): SatisfactionClientGroup => ({
    clientNom: nom,
    clientNomNormalise: normalizeClientName(nom),
    requerantNom: null,
    destinataireNom: nom,
    professionnel: null,
    nbRencontres: 5,
    derniereRencontre: '2026-10-01',
  })

  const eligible = buildEligibleList(
    [makeGroup('Marie Côté'), makeGroup('Jean Tremblay'), makeGroup('Aïcha Benali')],
    new Set(['marie cote']),
    new Set(['aicha benali'])
  )

  assert.deepEqual(
    eligible.map((g) => g.clientNom),
    ['Jean Tremblay']
  )
})

test('resolveDestinataire préfère le requérant quand il diffère du client', () => {
  assert.equal(resolveDestinataire('Léo Martin', 'Sophie Martin'), 'Sophie Martin')
  assert.equal(resolveDestinataire('Léo Martin', 'Léo Martin'), 'Léo Martin')
  assert.equal(resolveDestinataire('Léo Martin', '  léo martin  '), 'Léo Martin')
  assert.equal(resolveDestinataire('Léo Martin', ''), 'Léo Martin')
  assert.equal(resolveDestinataire('Léo Martin', null), 'Léo Martin')
})

test('detectEncounterPeriod retourne le min et le max des dates', () => {
  const period = detectEncounterPeriod([
    { clientNom: 'A', clientNomNormalise: 'a', requerantNom: null, professionnel: null, date: '2026-09-10' },
    { clientNom: 'B', clientNomNormalise: 'b', requerantNom: null, professionnel: null, date: '2026-10-11' },
    { clientNom: 'C', clientNomNormalise: 'c', requerantNom: null, professionnel: null, date: '2026-08-01' },
  ])

  assert.deepEqual(period, { start: '2026-08-01', end: '2026-10-11' })
  assert.equal(detectEncounterPeriod([]), null)
})

test('generateSatisfactionToken produit des jetons uniques non vides', () => {
  const first = generateSatisfactionToken()
  const second = generateSatisfactionToken()

  assert.ok(first.length > 0)
  assert.notEqual(first, second)
})

test('getFirstName extrait le prénom', () => {
  assert.equal(getFirstName('Marie Côté'), 'Marie')
  assert.equal(getFirstName('  Jean  Tremblay  '), 'Jean')
  assert.equal(getFirstName(''), 'à vous')
})

test('resolveUniqueSatisfactionRecipients accepte une seule fiche et tous ses courriels', () => {
  const match = resolveUniqueSatisfactionRecipients('lea martin', [
    {
      clientName: 'Léa Martin',
      requesterNames: ['Sophie Martin', 'Alex Martin'],
      emails: ['SOPHIE@example.com', 'alex@example.com', 'sophie@example.com'],
    },
  ])

  assert.deepEqual(match, {
    names: ['Sophie Martin', 'Alex Martin'],
    emails: ['sophie@example.com', 'alex@example.com'],
  })
})

test('resolveUniqueSatisfactionRecipients bloque une homonymie', () => {
  const match = resolveUniqueSatisfactionRecipients('lea martin', [
    { clientName: 'Léa Martin', requesterNames: [], emails: ['a@example.com'] },
    { clientName: 'Lea Martin', requesterNames: [], emails: ['b@example.com'] },
  ])

  assert.equal(match, null)
})

test('la migration et la route empêchent deux envois au même client', async () => {
  const [sql, route] = await Promise.all([
    readFile(
      new URL('../supabase/satisfaction-clients-hardening.sql', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../app/api/satisfaction/send/route.ts', import.meta.url),
      'utf8'
    ),
  ])

  assert.match(sql, /satisfaction_one_contact_per_client_idx/i)
  assert.match(sql, /where statut in \('en_cours', 'envoye'\)/i)
  assert.match(route, /update\(\{ statut: 'en_cours' \}\)/)
  assert.match(route, /\.eq\('statut', 'en_attente'\)/)
})

test('le désabonnement exige une confirmation POST', async () => {
  const route = await readFile(
    new URL('../app/api/satisfaction/unsubscribe/route.ts', import.meta.url),
    'utf8'
  )
  const getHandler = route.split('export async function POST')[0]

  assert.match(getHandler, /<form method="post"/i)
  assert.doesNotMatch(getHandler, /\.upsert\(/)
  assert.match(route, /export async function POST/)
})
