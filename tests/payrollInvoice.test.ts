import assert from 'node:assert/strict'
import test from 'node:test'
import { Packer } from 'docx'
import JSZip from 'jszip'
import { calculatePayroll, type ProfessionalPayrollInfo } from '../lib/payrollCalculator.ts'
import { generatePayrollInvoiceDocument, toPayrollInvoiceData } from '../lib/generatePayrollInvoiceDocx.ts'

const professional: ProfessionalPayrollInfo = {
  id: 'fictitious-professional', fullName: 'Professionnel Fictif', email: 'pro@example.invalid',
  payrollCategory: 'psychoeducateur_membre_ordre', professionalTitle: 'Professionnel fictif',
  professionalAddress: null, professionalPhone: null,
}
const header = ['DATE', 'PROFESSIONNEL', 'CLIENT', 'REQUERANT', 'DESCRIPTION',
  'DETAIL', 'EMPLACEMENT', 'PAYE', 'MONTANT RECLAME', 'MANDAT']
const period = { startDate: '2026-10-05', endDate: '2026-10-11', dueDate: '2026-10-15' }
function activity(amount: number, description = 'Rencontre', times = '09:00 - 10:00') {
  return [`2026-10-05\n${times}`, professional.fullName, 'PATIENT-FICTIF-PRIVE', '', description, '', '', '', amount, '']
}
function resultForInvoice() {
  return calculatePayroll([header, activity(137.91), activity(68.93, 'Absence'),
    activity(34.47, 'Entretien telephonique', '10:00 - 10:15'),
    activity(275.82, 'Redaction', '11:00 - 13:00'),
  ], [professional], period).professionalResults[0]
}

test('les labels et la projection fournisseur excluent les prix clients et les pourcentages sans modifier les honoraires', () => {
  const result = resultForInvoice()
  for (const item of [...result.lineItems, ...result.cancellationLineItems]) {
    assert.doesNotMatch(item.label, /137[.,]91|68[.,]93|275[.,]82|%|montant facturé/)
  }
  const expectedTotal = 82.75 + 41.36 + 20.68 + 220.66
  assert.ok(Math.abs(result.grandTotal - expectedTotal) < 0.000001)
  // Même un ancien libellé confidentiel ne doit pas franchir la projection.
  result.lineItems[0].label = 'BASE-CLIENT-CONFIDENTIELLE 137,91 $ (60 %)'
  result.rateGroups[0].label = 'BASE-CLIENT-CONFIDENTIELLE 60 %'
  result.cancellationLineItems[0].label = 'BASE-CLIENT-CONFIDENTIELLE 68,93 $'
  const invoice = toPayrollInvoiceData(result)
  const serialized = JSON.stringify(invoice)
  assert.doesNotMatch(serialized, /BASE-CLIENT|137\.91|68\.93|275\.82|%|clientAmount|payrollCategory|isFlatRate|"rate"|"amount"/)
  assert.equal(invoice.grandTotal, result.grandTotal)
  assert.equal(invoice.lineItems.find(item => item.label === 'Entretien téléphonique')?.quantity, 1)
  assert.equal(invoice.lineItems.find(item => item.label.startsWith('Rapport'))?.quantity, 2)
  assert.equal(invoice.lineItems[0].unitPay, result.lineItems[0].totalPay / result.lineItems[0].totalHours)
})

test('le vrai DOCX ne contient que les honoraires, les quantités et les données du fournisseur', async () => {
  const result = resultForInvoice()
  for (const item of [...result.lineItems, ...result.cancellationLineItems]) item.label = 'BASE-CLIENT-CONFIDENTIELLE 137,91 $'
  for (const group of result.rateGroups) group.label = 'BASE-CLIENT-CONFIDENTIELLE 60 %'
  const buffer = await Packer.toBuffer(generatePayrollInvoiceDocument(result, period, null, { invoiceNumber: '007' }))
  const zip = await JSZip.loadAsync(buffer)
  const xmlEntries = await Promise.all(Object.values(zip.files).filter(file => !file.dir && /\.(?:xml|rels)$/.test(file.name))
    .map(file => file.async('string')))
  const allXml = xmlEntries.join('\n')
  assert.doesNotMatch(allXml, /BASE-CLIENT|137[.,]91|68[.,]93|275[.,]82|PATIENT-FICTIF|60 %|70 %|80 %|montant facturé/)
  const text = (await zip.file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, ' ').replace(/&apos;/g, "'")
  assert.match(text, /Honoraires professionnels/)
  assert.match(text, /Entretien téléphonique/)
  assert.match(text, /Rapport d'évaluation psychoéducative/)
  assert.match(text, /Honoraires d’annulation/)
  assert.match(text, /Professionnel Fictif/)
  const formattedTotal = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(result.grandTotal)
  assert.ok(text.includes(formattedTotal))
})

test('la facture refuse tout en-tête non borné, changé, invalide ou sans confirmation des semaines partielles', () => {
  const result = resultForInvoice()
  assert.throws(() => generatePayrollInvoiceDocument(result, { ...period, startDate: '2026-10-01' }, null), /Recalculez/)
  assert.throws(() => generatePayrollInvoiceDocument(result, { ...period, dueDate: '2026-02-30' }, null), /échéance/)
  const unbounded = calculatePayroll([header, activity(137.91)], [professional]).professionalResults[0]
  assert.throws(() => generatePayrollInvoiceDocument(unbounded, period, null), /Recalculez/)
  const partialPeriod = { ...period, endDate: '2026-10-06' }
  const partial = calculatePayroll([header, activity(137.91)], [professional], partialPeriod).professionalResults[0]
  assert.throws(() => generatePayrollInvoiceDocument(partial, partialPeriod, null), /semaines complètes/)
  assert.doesNotThrow(() => generatePayrollInvoiceDocument(partial, partialPeriod, null, { weeklyContextConfirmed: true }))
})

test('le forfait garde séparés les heures de rencontre et les éléments de téléphone dans le DOCX', () => {
  const flat = { ...professional, payrollCategory: 'psychotherapeute' as const }
  const result = calculatePayroll([header, activity(180), activity(45, 'Entretien telephonique', '10:00 - 10:15')], [flat], period).professionalResults[0]
  const invoice = toPayrollInvoiceData(result)
  assert.equal(invoice.lineItems.length, 2)
  assert.deepEqual(invoice.lineItems.map(item => [item.label, item.quantity, item.totalPay]), [
    ['Rencontre', 1, 110], ['Entretien téléphonique', 1, 27.5],
  ])
  assert.equal(invoice.grandTotal, 137.5)
})
