import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isProfessionalSuggested,
  rankProfessionalMatches,
  type MatchingProfessional,
} from '../lib/professionalMatching.ts'

const professionals: MatchingProfessional[] = [
  {
    id: 'best',
    name: 'Professionnelle compatible',
    professionalTitle: 'Psychoéducatrice',
    preferredClientTypes: ['Adolescents'],
    preferredModalities: ['Présentiel — bureau de Longueuil', 'Visioconférence'],
    preferredFollowupTypes: ['Psychoéducation', 'Coaching parental'],
    preferenceNotes: null,
    remainingPlaces: 2,
  },
  {
    id: 'other',
    name: 'Professionnelle moins compatible',
    professionalTitle: 'Psychothérapeute',
    preferredClientTypes: ['Adultes'],
    preferredModalities: ['À domicile'],
    preferredFollowupTypes: ['Psychothérapie'],
    preferenceNotes: null,
    remainingPlaces: 1,
  },
]

test('classe en premier le professionnel correspondant aux préférences', () => {
  const matches = rankProfessionalMatches(
    {
      birthDate: '2011-03-12',
      serviceRequested: 'Psychoéducation',
      meetingModalities: ['Présentiel — bureau de Longueuil'],
      city: 'Longueuil',
      consultationReason: 'Coaching parental pour un adolescent',
    },
    professionals,
    new Date('2026-10-09T12:00:00Z')
  )

  assert.equal(matches[0].professionalId, 'best')
  assert.ok(matches[0].score > matches[1].score)
  assert.equal(isProfessionalSuggested(matches[0]), true)
  assert.ok(matches[0].reasons.some((reason) => reason.includes('Longueuil')))
})

test('conserve un client sans âge et signale la donnée à vérifier', () => {
  const [match] = rankProfessionalMatches(
    {
      birthDate: null,
      serviceRequested: 'Psychoéducation',
      meetingModalities: ['Visioconférence'],
      city: null,
      consultationReason: null,
    },
    [professionals[0]],
    new Date('2026-10-09T12:00:00Z')
  )

  assert.equal(match.professionalId, 'best')
  assert.ok(match.cautions.includes('Âge du client non précisé'))
})

test('ne propose que les professionnels ayant une place restante', () => {
  const matches = rankProfessionalMatches(
    {
      birthDate: '1990-01-01',
      serviceRequested: 'Psychothérapie',
      meetingModalities: ['Visioconférence'],
      city: null,
      consultationReason: 'Anxiété',
    },
    [{ ...professionals[0], remainingPlaces: 0 }],
    new Date('2026-10-09T12:00:00Z')
  )

  assert.deepEqual(matches, [])
})
