import assert from 'node:assert/strict'
import test from 'node:test'
import { applyInvoiceEdit, editableInvoice } from '../lib/payrollInvoiceEditor.ts'
import type { PayrollInvoiceData } from '../lib/generatePayrollInvoiceDocx.ts'

const base: PayrollInvoiceData = { professional: { fullName: 'Fournisseur fictif', email: 'fixture@example.invalid', professionalTitle: 'Titre fictif', professionalAddress: null, professionalPhone: null }, lineItems: [{ label: 'Rencontre', quantity: 2, unit: 'élément', unitPay: 100, totalPay: 200 }], cancellationLineItems: [], cancellationCount: 0, cancellationFeesTotal: 0, meetingsPay: 200, travelFeesTotal: 0, travelKilometersTotal: 0, grandTotal: 200 }
test('rectification manuelle : 200 devient 180, le serveur recalcule et ignore les totaux et profils fournis', () => {
  const edit = editableInvoice(base); edit.lines[0].unitPay = 90
  const result = applyInvoiceEdit(base, { ...edit, grandTotal: 1, professional: { fullName: 'Falsifié' } })
  assert.equal(result.grandTotal, 180); assert.equal(result.meetingsPay, 180)
  assert.equal(result.professional.fullName, 'Fournisseur fictif'); assert.equal(base.grandTotal, 200)
})
test('rectification : ajout, retrait, annulation, déplacement et arrondis décimaux', () => {
  const result = applyInvoiceEdit(base, { lines: [{ label: 'Annulation', quantity: 2, unit: 'élément', unitPay: 23.625, cancellation: true }], travelFeesTotal: 28.56 })
  assert.equal(result.meetingsPay, 0); assert.equal(result.cancellationCount, 2)
  assert.equal(result.cancellationFeesTotal, 47.25); assert.equal(result.grandTotal, 75.81)
  assert.equal(result.travelKilometersTotal, 44.63)
})
test('rectification refuse valeurs non finies, négatives, lignes invalides et annulations fractionnaires', () => {
  for (const value of [NaN, Infinity, -1, 1000001]) {
    assert.throws(() => applyInvoiceEdit(base, { ...editableInvoice(base), travelFeesTotal: value }))
    assert.throws(() => applyInvoiceEdit(base, { lines: [{ label: 'Rencontre', unit: 'élément', quantity: value, unitPay: 90 }], travelFeesTotal: 0 }))
  }
  assert.throws(() => applyInvoiceEdit(base, { lines: [], travelFeesTotal: 0 }))
  assert.throws(() => applyInvoiceEdit(base, { lines: [{ label: 'Annulation', quantity: .5, unit: 'élément', unitPay: 90, cancellation: true }], travelFeesTotal: 0 }))
})
