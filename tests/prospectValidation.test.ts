import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizePublicIntakeEmail, normalizePublicIntakePhone, sanitizePublicAttribution,
  validateIdempotencyKey, validatePublicIntakePayload,
} from '../lib/publicIntakeValidation.ts'

const payload = {
  firstName: 'Client', lastName: 'Fictif', phone: '5145550100', email: 'client@example.invalid',
  requestType: 'self', requesterNames: [], modalities: ['telehealth'], contactType: 'scheduled_call',
}

test('le motif et la date de naissance sont facultatifs a la reception publique', () => {
  const result = validatePublicIntakePayload(payload, 'scheduled_call')
  assert.equal(result.error, undefined)
  assert.equal(result.data?.consultationReason, null)
  assert.equal(result.data?.birthDate, null)
})

test('une demande pour un tiers exige un requerant et le domicile exige une adresse complete', () => {
  assert.ok(validatePublicIntakePayload({ ...payload, requestType: 'child_or_teen' }).error)
  assert.ok(validatePublicIntakePayload({ ...payload, modalities: ['home'] }).error)
  const result = validatePublicIntakePayload({
    ...payload, requestType: 'other', requesterNames: ['Requerant fictif'], modalities: ['home'],
    address: 'Adresse fictive', city: 'Ville fictive', postalCode: 'h0h 0h0',
  })
  assert.equal(result.error, undefined)
  assert.equal(result.data?.postalCode, 'H0H 0H0')
})

test('les identites normalisees detectent le meme contact malgre la casse ou le format du telephone', () => {
  assert.equal(normalizePublicIntakeEmail(' CLIENT@example.invalid '), payload.email)
  assert.equal(normalizePublicIntakePhone('+1 (514) 555-0100'), payload.phone)
  assert.equal(normalizePublicIntakePhone('514-555-0100'), payload.phone)
  assert.ok(validatePublicIntakePayload({ ...payload, email: 'invalid' }).error)
  assert.ok(validatePublicIntakePayload({ ...payload, phone: '123' }).error)
})

test('une route de reservation refuse un corps de rappel et nettoie les modalites inconnues', () => {
  assert.ok(validatePublicIntakePayload({ ...payload, contactType: 'rapid_callback' }, 'scheduled_call').error)
  assert.deepEqual(validatePublicIntakePayload({
    ...payload, modalities: ['telehealth', 'telehealth', 'unknown'],
  }).data?.modalities, ['telehealth'])
  assert.ok(validatePublicIntakePayload({ ...payload, modalities: ['unknown'] }).error)
})

test('le suivi conserve seulement les champs techniques autorises et des cles idempotentes bornees', () => {
  assert.deepEqual(sanitizePublicAttribution({
    source: 'google', campaign: 'Campagne fictive', email: payload.email,
    phone: payload.phone, consultationReason: 'Texte fictif', arbitrary: 'ignored',
  }), { source: 'google', campaign: 'Campagne fictive' })
  assert.equal(validateIdempotencyKey('a'.repeat(16)), 'a'.repeat(16))
  assert.equal(validateIdempotencyKey('a'.repeat(128)), 'a'.repeat(128))
  for (const key of [null, 'a'.repeat(15), 'a'.repeat(129), 'contains spaces here', 'not/allowed/path']) {
    assert.equal(validateIdempotencyKey(key), null)
  }
})
