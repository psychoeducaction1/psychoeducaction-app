import assert from 'node:assert/strict'
import test from 'node:test'
import { calculatePayroll, type ProfessionalPayrollInfo } from '../lib/payrollCalculator.ts'
import { calculateBudget, inferBudgetPeriod } from '../lib/budgetCalculator.ts'
import { calculateProfessionalCompensation } from '../lib/professionalCompensation.ts'

const professional: ProfessionalPayrollInfo = {
  id: 'professional-fixture', fullName: 'Professionnel Fictif', email: 'pro@example.invalid',
  payrollCategory: 'psychoeducateur_membre_ordre',
  professionalAddress: null, professionalPhone: null, professionalTitle: null,
}
const header = ['DATE', 'PROFESSIONNEL', 'CLIENT', 'REQUERANT', 'DESCRIPTION',
  'DETAIL', 'EMPLACEMENT', 'PAYE', 'MONTANT RECLAME', 'MANDAT']
function activity(amount: number, times: string, description = 'Rencontre', detail = '', date = '2026-10-05') {
  return [`${date}\n${times}`, professional.fullName, 'Client fictif', '',
    description, detail, '', '', amount, '']
}
function amountEqual(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} differs from ${expected}`)
}

test('le calculateur complet paie une rencontre de 1,5 h une seule fois', () => {
  const result = calculatePayroll([header, activity(202.5, '09:00 - 10:30')], [professional])
  assert.deepEqual(result.warnings, [])
  const row = result.professionalResults[0]
  assert.equal(row.lineItems[0].totalHours, 1.5)
  assert.equal(row.lineItems[0].amount, 135)
  amountEqual(row.lineItems[0].totalPay, 121.5)
  amountEqual(row.grandTotal, 121.5)
})

test('les 24 minutes restent payees 37,80 au taux de 70 % dans paie et budget', () => {
  const rows = [header, activity(54, '09:00 - 09:24')]
  for (let index = 0; index < 9; index++) rows.push(activity(135, '10:00 - 11:00'))
  const payroll = calculatePayroll(rows, [professional]).professionalResults[0]
  const group = payroll.lineItems.find((item) => item.amount === 135)
  assert.ok(group)
  assert.equal(group.rate, 0.7)
  amountEqual(group.totalHours, 9.4)
  amountEqual(group.totalPay - 9 * 94.5, 37.8)
  const budget = calculateBudget(rows, [professional], { startDate: '2026-10-01', endDate: '2026-10-31' })
  amountEqual(budget.totals.professionalPay, payroll.grandTotal)
})

test('deux entretiens telephoniques conservent leur quantite et le total final', () => {
  const rows = [header,
    activity(33.75, '09:00 - 09:15', 'Entretien telephonique'),
    activity(33.75, '09:30 - 09:45', 'Entretien telephonique')]
  for (let index = 0; index < 8; index++) rows.push(activity(135, '10:00 - 11:00'))
  const result = calculatePayroll(rows, [professional]).professionalResults[0]
  const telephone = result.lineItems.find((item) => item.label.startsWith('Entretien'))
  assert.ok(telephone)
  assert.equal(telephone.totalHours, 2)
  // 33,75 × 70 % = 23,625, arrondi par activité à 23,63.
  amountEqual(telephone.totalPay, 47.26)
  amountEqual(result.grandTotal, 47.26 + 8 * 94.5)
})

test('redaction et rapport versent 80 % du montant pour des durees variables, meme sans categorie', () => {
  for (const [description, amount, times] of [
    ['Redaction', 540, '09:00 - 13:00'], ['Rapport', 675, '09:00 - 14:00'],
  ] as const) {
    const rows = [header, activity(amount, times, description)]
    const withoutCategory = { ...professional, payrollCategory: null }
    const payroll = calculatePayroll(rows, [withoutCategory])
    assert.deepEqual(payroll.warnings, [])
    amountEqual(payroll.professionalResults[0].grandTotal, amount * 0.8)
    const budget = calculateBudget(rows, [withoutCategory])
    amountEqual(budget.totals.professionalPay, amount * 0.8)
    amountEqual(budget.totals.clinicRevenue, amount * 0.2)
    assert.equal(payroll.professionalResults[0].meetingCount, 0)
  }
})

test('les annulations a 50 ou 100 % partagent le montant reel et ne comptent pas au seuil', () => {
  const rows = [header, activity(67.5, '09:00 - 10:00', 'Absence'),
    activity(135, '10:00 - 11:00', 'Absence')]
  const payroll = calculatePayroll(rows, [professional]).professionalResults[0]
  assert.equal(payroll.meetingCount, 0)
  assert.equal(payroll.cancellationCount, 2)
  amountEqual(payroll.cancellationFeesTotal, 121.5)
  const budget = calculateBudget(rows, [professional])
  amountEqual(budget.totals.professionalPay, payroll.grandTotal)
  amountEqual(budget.totals.clinicRevenue, 81)
  const flat = calculateProfessionalCompensation({
    professional: { ...professional, payrollCategory: 'psychotherapeute' },
    lineType: 'annulation', clientAmount: 90, durationHours: 0, weeklyMeetingCount: 0,
  })
  amountEqual(flat.professionalPay, 55)
  amountEqual(flat.clinicRevenue, 35)
})

test('le seuil de dix rencontres est calcule par semaine et exclut redactions et non facturables', () => {
  const rows: unknown[][] = [header]
  for (let index = 0; index < 9; index++) rows.push(activity(135, '09:00 - 10:00'))
  rows.push(activity(540, '09:00 - 13:00', 'Redaction'))
  rows.push(activity(135, '09:00 - 10:00', 'Rencontre', 'Non facturable'))
  rows.push(activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-10-12'))
  const result = calculatePayroll(rows, [professional]).professionalResults[0]
  assert.equal(result.meetingCount, 10)
  assert.equal(result.lineItems.find((item) => item.label.includes('Rencontre'))?.rate, 0.6)
  amountEqual(result.grandTotal, 10 * 81 + 432)
})

test('les deplacements sont rembourses, convertis en kilometres et exclus du revenu clinique', () => {
  const rows = [header, activity(64, '', 'Frais', 'Deplacement')]
  const payroll = calculatePayroll(rows, [professional]).professionalResults[0]
  assert.equal(payroll.travelKilometersTotal, 100)
  assert.equal(payroll.grandTotal, 64)
  const budget = calculateBudget(rows, [professional])
  assert.equal(budget.totals.travelExcluded, 64)
  assert.equal(budget.totals.clinicRevenue, 0)
  assert.equal(budget.totals.grossRevenue, 0)
})

test('le calcul refuse de choisir un professionnel parmi deux correspondances ambigues', () => {
  const rows = [header, [...activity(135, '09:00 - 10:00')]]
  rows[1][1] = 'Alex'
  const result = calculatePayroll(rows, [
    { ...professional, id: 'pro-a', fullName: 'Alex Fictif' },
    { ...professional, id: 'pro-b', fullName: 'Alex Exemple' },
  ])
  assert.equal(result.professionalResults.length, 0)
  assert.equal(result.warnings[0].type, 'unmatched_professional')
})

test('les mois et la periode partielle sont detectes sans ajouter des rencontres hors plage', () => {
  const rows = [header, activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-09-30'),
    activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-10-05'),
    activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-10-20')]
  assert.deepEqual(inferBudgetPeriod(rows), {
    startDate: '2026-09-30', endDate: '2026-10-20', monthKeys: ['2026-09', '2026-10'],
  })
  const budget = calculateBudget(rows, [professional], { startDate: '2026-10-01', endDate: '2026-10-15' })
  assert.equal(budget.totals.meetingCount, 1)
  assert.equal(budget.totals.grossRevenue, 135)
})

test('la paie filtre les bornes inclusives de toutes les activités et ignore les autres dates', () => {
  const period = { startDate: '2026-10-05', endDate: '2026-10-11' }
  const rows = [header,
    activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-10-04'),
    activity(135, '09:00 - 10:00', 'Rencontre', '', period.startDate),
    activity(135, '09:00 - 10:00', 'Rencontre', '', period.endDate),
    activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-10-12'),
    activity(67.5, '09:00 - 10:00', 'Absence', '', period.startDate),
    activity(135, '09:00 - 10:00', 'Absence', '', '2026-10-12'),
    activity(12.8, '', 'Frais', 'Deplacement', period.endDate),
    activity(64, '', 'Frais', 'Deplacement', '2026-10-04'),
    activity(540, '09:00 - 13:00', 'Redaction', '', '2026-10-12'),
  ]
  const result = calculatePayroll(rows, [professional], period)
  const pay = result.professionalResults[0]
  assert.deepEqual(result.period, period)
  assert.deepEqual(pay.period, period)
  assert.equal(result.requiresWeeklyReview, false)
  assert.equal(pay.meetingCount, 2)
  assert.equal(pay.cancellationCount, 1)
  amountEqual(pay.cancellationFeesTotal, 40.5)
  amountEqual(pay.travelFeesTotal, 12.8)
  amountEqual(pay.grandTotal, 2 * 81 + 40.5 + 12.8)
  assert.equal(result.warnings.filter(warning => warning.type === 'out_of_period').length, 1)
  period.startDate = '2026-10-01'
  assert.equal(result.period?.startDate, '2026-10-05')
  assert.equal(pay.period?.startDate, '2026-10-05')
})

test('une période partielle utilise le contexte de sa semaine sans payer les jours voisins ni inventer les absents', () => {
  const selected = activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-10-07')
  const rows = [header, selected]
  for (let index = 0; index < 9; index++) rows.push(activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-10-05'))
  // Une autre semaine ne doit jamais contribuer au seuil du mercredi sélectionné.
  for (let index = 0; index < 10; index++) rows.push(activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-10-12'))
  const period = { startDate: '2026-10-07', endDate: '2026-10-07' }
  const completeContext = calculatePayroll(rows, [professional], period)
  assert.equal(completeContext.requiresWeeklyReview, true)
  assert.equal(completeContext.professionalResults[0].meetingCount, 1)
  amountEqual(completeContext.professionalResults[0].grandTotal, 94.5)
  assert.equal(completeContext.warnings.some(warning => warning.type === 'partial_week'), true)
  const missingContext = calculatePayroll([header, selected], [professional], period)
  amountEqual(missingContext.professionalResults[0].grandTotal, 81)
  assert.equal(missingContext.requiresWeeklyReview, true)
  const sunday = calculatePayroll([header,
    activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-10-11'), ...rows.slice(11),
  ], [professional], { startDate: '2026-10-11', endDate: '2026-10-11' })
  amountEqual(sunday.professionalResults[0].grandTotal, 81)
})

test('la période de paie refuse dates absentes, impossibles ou inversées et accepte le jour bissextile', () => {
  for (const period of [
    { startDate: '', endDate: '2026-10-11' },
    { startDate: '2026-02-30', endDate: '2026-03-01' },
    { startDate: '2026-10-12', endDate: '2026-10-05' },
    { startDate: '2026-1-05', endDate: '2026-10-11' },
  ]) {
    assert.throws(() => calculatePayroll([header], [professional], period), /période de paie/)
  }
  const leap = calculatePayroll([header,
    activity(135, '09:00 - 10:00', 'Rencontre', '', '2028-02-29'),
  ], [professional], { startDate: '2028-02-29', endDate: '2028-02-29' })
  assert.equal(leap.professionalResults[0].meetingCount, 1)
})

test('les dates source impossibles sont exclues même pour les déplacements, et une période vide ne paie personne', () => {
  const rows = [header,
    activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-02-30'),
    activity(64, '', 'Frais', 'Deplacement', '2026-02-30'),
    activity(64, '', 'Frais', 'Deplacement', ''),
    activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-02-23invalide'),
    activity(135, '09:00 - 10:00', 'Rencontre', '', '2026-10-05'),
  ]
  const result = calculatePayroll(rows, [professional], { startDate: '2026-02-23', endDate: '2026-03-01' })
  assert.equal(result.professionalResults.length, 0)
  assert.equal(result.warnings.filter(warning => warning.type === 'unreadable_date').length, 4)
  const empty = calculatePayroll([header], [professional], { startDate: '2026-10-05', endDate: '2026-10-11' })
  assert.deepEqual(empty.professionalResults, [])
  assert.deepEqual(empty.warnings, [])
})
