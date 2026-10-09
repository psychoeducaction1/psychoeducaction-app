import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clientGroupOptions,
  formatAgeRanges,
  getOptionLabels,
  normalizeStructuredPreferences,
} from '../lib/professionalPreferences.ts'

test('normalizes missing structured preferences without reusing legacy fields', () => {
  const preferences = normalizeStructuredPreferences({
    pref_languages: ['Français'],
    pref_age_ranges: null,
    pref_client_groups: null,
    pref_service_types: null,
    pref_office_locations: null,
    pref_meeting_modes: null,
    pref_motifs: null,
    pref_exclusions: null,
    pref_matching_notes: null,
  })

  assert.deepEqual(preferences.pref_age_ranges, [])
  assert.deepEqual(preferences.pref_client_groups, [])
  assert.equal(preferences.pref_matching_notes, '')
})

test('formats separate and open-ended age ranges', () => {
  assert.equal(
    formatAgeRanges([
      { min: 5, max: 12 },
      { min: 18, max: null },
    ]),
    '5 à 12 ans, 18 ans et plus'
  )
})

test('uses readable labels while preserving unknown values', () => {
  assert.deepEqual(
    getOptionLabels(['children', 'custom_group'], clientGroupOptions),
    ['Enfants', 'custom_group']
  )
})
