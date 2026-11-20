import assert from 'node:assert/strict'
import test from 'node:test'
import { meetsCapacityNotice } from '../lib/clinical-calendar/capacityNotice.ts'

test('disponibilités : exactement 72 heures, fin de semaine comprise', () => {
  const fridayNoon = Date.parse('2026-11-20T17:00:00Z')
  assert.equal(meetsCapacityNotice('2026-11-23', 12 * 60, fridayNoon), true)
  assert.equal(meetsCapacityNotice('2026-11-23', 12 * 60, fridayNoon + 1), false)
  assert.equal(meetsCapacityNotice('2026-11-23', 11 * 60, fridayNoon), false)
})

test('disponibilités : le passage à l’heure avancée compte une heure de moins', () => {
  const beforeClockChange = Date.parse('2026-03-06T17:00:00Z')
  assert.equal(meetsCapacityNotice('2026-03-09', 12 * 60, beforeClockChange), false)
  assert.equal(meetsCapacityNotice('2026-03-09', 13 * 60, beforeClockChange), true)
})
