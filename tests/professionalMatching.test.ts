import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateProfessionalMatch,
  getSuggestedProfessionals,
  type MatchingClient,
  type MatchingProfessional,
} from '../lib/professionalMatching.ts'

const baseClient: MatchingClient = {
  birth_date: '2016-01-01',
  service_requested: 'Psychoéducation',
  meeting_modality: ['Présentiel — bureau de Longueuil'],
  consultation_reason: 'Anxiété et difficultés à gérer ses émotions.',
  internal_notes: null,
}

const baseProfessional: MatchingProfessional = {
  id: 'pro-1',
  full_name: 'Professionnelle test',
  pref_age_ranges: [{ min: 8, max: 12 }],
  pref_service_types: ['psychoeducation'],
  pref_office_locations: ['longueuil'],
  pref_meeting_modes: ['in_person'],
  pref_motifs: ['anxiety'],
}

test('propose un professionnel compatible sans considérer sa capacité', () => {
  const result = evaluateProfessionalMatch(
    baseClient,
    baseProfessional,
    new Date('2026-10-09T12:00:00Z')
  )

  assert.equal(result.isSuggested, true)
  assert.equal(result.score, 100)
})

test('applique une tolérance de deux ans autour de la plage d’âge', () => {
  const client = { ...baseClient, birth_date: '2012-01-01' }
  const result = evaluateProfessionalMatch(
    client,
    baseProfessional,
    new Date('2026-10-09T12:00:00Z')
  )

  assert.equal(result.isSuggested, true)
})

test('rejette un bureau incompatible même si les autres critères concordent', () => {
  const result = evaluateProfessionalMatch(
    { ...baseClient, meeting_modality: ['Présentiel — bureau de Montréal'] },
    baseProfessional,
    new Date('2026-10-09T12:00:00Z')
  )

  assert.equal(result.isSuggested, false)
})

test('ne suggère pas un motif non reconnu sous le seuil de 80 %', () => {
  const result = evaluateProfessionalMatch(
    { ...baseClient, consultation_reason: 'Demande générale sans précision.' },
    baseProfessional,
    new Date('2026-10-09T12:00:00Z')
  )

  assert.equal(result.score, 75)
  assert.equal(result.isSuggested, false)
})

test('retourne seulement les professionnels qui satisfont les critères', () => {
  const incompatible = {
    ...baseProfessional,
    id: 'pro-2',
    pref_office_locations: ['montreal'],
  }
  const suggestions = getSuggestedProfessionals(
    baseClient,
    [incompatible, baseProfessional],
    new Date('2026-10-09T12:00:00Z')
  )

  assert.deepEqual(suggestions.map((match) => match.professional.id), ['pro-1'])
})
