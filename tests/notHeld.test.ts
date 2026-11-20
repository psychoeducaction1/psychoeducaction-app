import test from 'node:test'
import assert from 'node:assert/strict'
import { notHeldFeeChoices, isNotHeldPreview } from '../lib/clinical-calendar/notHeld.ts'
import { isCalendarCommand } from '../lib/clinical-calendar/durableTransport.ts'
import type { DurableCalendarEvent } from '../lib/clinical-calendar/durableTypes.ts'

const id = '97980000-0000-4000-8000-000000000002'
const now = Date.parse('2026-11-20T12:00:00Z')
const event = { id, version: 3, startAt: '2026-11-19T12:00:00Z', billable: true, absenceDecision: { allowedFeePercents: [0, 50, 100] } } as DurableCalendarEvent
test('absence et annulation tardive : seulement les pourcentages convenus', () => {
  assert.deepEqual(notHeldFeeChoices(event, 'no_show', 'client', now), [0, 50, 100])
  assert.deepEqual(notHeldFeeChoices(event, 'cancelled', 'client', now), [0, 50, 100])
  assert.deepEqual(notHeldFeeChoices({ ...event, absenceDecision: { ...event.absenceDecision, allowedFeePercents: [0] } }, 'no_show', 'client', now), [0])
})
test('annulation clinique, professionnelle, avec préavis ou activité gratuite : aucun frais', () => {
  for (const reason of ['professional', 'clinic'] as const) assert.deepEqual(notHeldFeeChoices(event, 'cancelled', reason, now), [0])
  assert.deepEqual(notHeldFeeChoices({ ...event, startAt: '2026-11-21T12:00:00Z' }, 'cancelled', 'client', now), [0])
  assert.deepEqual(notHeldFeeChoices({ ...event, billable: false }, 'no_show', 'client', now), [0])
})
test('confirmation liée à la bonne rencontre et sa version, sans exposer les documents', () => {
  const preview = { appointmentId: id, version: 3, hash: 'a'.repeat(64), noteCount: 1, invoiceCount: 1, paidInvoiceCount: 0 }
  assert.equal(isNotHeldPreview(preview, event), true)
  assert.equal(isNotHeldPreview({ ...preview, version: 2 }, event), false)
  assert.equal(isNotHeldPreview({ ...preview, paidInvoiceCount: -1 }, event), false)
})
test('commande de résultat stricte : confirmation, prévisualisation, frais et origine', () => {
  const command = { action: 'appointments.not-held', id, data: { expectedVersion: 3, previewHash: 'a'.repeat(64), confirmed: true, status: 'no_show', reason: null, feePercent: 0 } }
  assert.equal(isCalendarCommand(command), true)
  for (const patch of [{ feePercent: 12 }, { reason: 'client' }, { confirmed: false }, { previewHash: '' }, { payment: true }]) assert.equal(isCalendarCommand({ ...command, data: { ...command.data, ...patch } }), false)
  assert.equal(isCalendarCommand({ ...command, data: { ...command.data, status: 'cancelled', reason: 'client' } }), true)
  assert.equal(isCalendarCommand({ ...command, data: { ...command.data, status: 'cancelled' } }), false)
})
