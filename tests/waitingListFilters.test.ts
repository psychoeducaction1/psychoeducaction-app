import assert from 'node:assert/strict'
import test from 'node:test'
import { hasSpecialProgramMarker } from '../lib/waitingListFilters.ts'

test('détecte IVAC, PAE et CNESST dans les renseignements du dossier', () => {
  assert.equal(hasSpecialProgramMarker({ internal_notes: 'Dossier IVAC' }), true)
  assert.equal(hasSpecialProgramMarker({ consultation_reason: 'Référence PAE' }), true)
  assert.equal(hasSpecialProgramMarker({ service_requested: 'Mandat CNESST' }), true)
})

test('ne masque pas un dossier ordinaire', () => {
  assert.equal(
    hasSpecialProgramMarker({
      consultation_reason: 'Soutien pour des difficultés scolaires',
      internal_notes: 'Disponibilités en soirée',
    }),
    false
  )
})
