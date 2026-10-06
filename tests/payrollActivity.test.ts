import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyPayrollActivity,
  getActivityQuantity,
  getActivityUnitClientAmount,
  isTelephoneInterview,
} from '../lib/payrollActivity.ts'

test('reconnaît un rapport d’évaluation psychoéducative', () => {
  assert.equal(
    classifyPayrollActivity('Rapport', "Rapport d'évaluation psychoéducative"),
    'rapport_evaluation'
  )
  assert.equal(
    classifyPayrollActivity("Rapport d'évaluation", 'Psycho-éducative'),
    'rapport_evaluation'
  )
  assert.equal(
    classifyPayrollActivity('Rédaction', "Rédaction d'un rapport"),
    'rapport_evaluation'
  )
  assert.equal(
    classifyPayrollActivity('Rédaction', ''),
    'rapport_evaluation'
  )
  assert.equal(
    classifyPayrollActivity('Rapport', ''),
    'rapport_evaluation'
  )
})

test('reconnaît un entretien téléphonique comme une rencontre facturable', () => {
  assert.equal(
    classifyPayrollActivity('Entretien téléphonique', ''),
    'rencontre'
  )
  assert.equal(isTelephoneInterview('Entretien téléphonique', ''), true)
})

test('ne multiplie pas une seconde fois le montant facturé par la durée', () => {
  const quantity = getActivityQuantity(1.5, false)
  const unitAmount = getActivityUnitClientAmount(202.5, quantity)

  assert.equal(quantity, 1.5)
  assert.equal(unitAmount, 135)
  assert.equal(202.5 * 0.6, 121.5)
})

test('calcule correctement une rencontre de 24 minutes', () => {
  const quantity = getActivityQuantity(0.4, false)
  const unitAmount = getActivityUnitClientAmount(54, quantity)

  assert.equal(quantity, 0.4)
  assert.equal(unitAmount, 135)
  assert.equal(54 * 0.7, 37.8)
})

test('affiche les entretiens téléphoniques en nombre d’éléments', () => {
  const quantity =
    getActivityQuantity(0.25, true) + getActivityQuantity(0.25, true)

  assert.equal(quantity, 2)
  assert.equal(33.75 * 0.7 * quantity, 47.25)
})
