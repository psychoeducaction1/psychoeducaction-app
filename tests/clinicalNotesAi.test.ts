import test from 'node:test'
import assert from 'node:assert/strict'
import { CLINICAL_NOTE_FIELDS, detectClinicalAudio, formatClinicalNoteDraft, parseClinicalNoteDraft } from '../lib/clinicalNotesAi.ts'

test('la note IA doit avoir les six rubriques attendues, sans champs supplementaires', () => {
  const fixture = Object.fromEntries(CLINICAL_NOTE_FIELDS.map(field => [field, 'Information fictive']))
  const draft = parseClinicalNoteDraft(fixture)
  assert.ok(draft)
  assert.match(formatClinicalNoteDraft(draft), /ESSAI FICTIF/)
  assert.match(formatClinicalNoteDraft(draft), /A VERIFIER/)
  for (const invalid of [null, [], {}, { ...fixture, objectif: '' }, { ...fixture, informations: 42 }, { ...fixture, aVerifier: 'x'.repeat(6001) }, { ...fixture, extra: 'Texte fictif' }]) {
    assert.equal(parseClinicalNoteDraft(invalid), null)
  }
})

test('l’essai reconnait les signatures audio sans se fier au nom ni au type fournis', () => {
  assert.equal(detectClinicalAudio(new Uint8Array()), null)
  assert.equal(detectClinicalAudio(new TextEncoder().encode('<html>Fichier fictif</html>')), null)
  const wave = new Uint8Array(32)
  wave.set(new TextEncoder().encode('RIFF'), 0)
  assert.equal(detectClinicalAudio(wave), null)
  wave.set(new TextEncoder().encode('WAVE'), 8)
  assert.equal(detectClinicalAudio(wave)?.extension, 'wav')
  const mp3 = new Uint8Array(32)
  mp3.set(new TextEncoder().encode('ID3'))
  assert.equal(detectClinicalAudio(mp3)?.extension, 'mp3')
  const m4a = new Uint8Array(32)
  m4a.set(new TextEncoder().encode('ftypM4A '), 4)
  assert.equal(detectClinicalAudio(m4a)?.extension, 'm4a')
  const webm = new Uint8Array(32)
  webm.set([26, 69, 223, 163])
  assert.equal(detectClinicalAudio(webm)?.extension, 'webm')
})
