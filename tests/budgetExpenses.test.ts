import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateBudgetExpenses, isFixedExpenseApplicable } from '../lib/budgetExpenses.ts'
import {
  buildDefaultTimeEntry, buildPayrollRow, calculateHoursBetween, calculatePayableHours,
  type AdministrativeStaff,
} from '../lib/administrativePayroll.ts'

const staff: AdministrativeStaff = {
  id: 'staff-test', profile_id: null, full_name: 'Employe fictif', email: 'staff@example.invalid',
  hourly_rate: 40, monthly_salary: 3200, vacation_days_per_year: 10,
  default_schedule: [
    { weekday: 1, startTime: '08:00', endTime: '12:00' },
    { weekday: 6, startTime: '12:00', endTime: '12:00' },
  ],
}

test('les frais fixes sont mensuels et les bornes de debut et de fin sont incluses', () => {
  const expense = { id: 'expense-test', name: 'Loyer fictif', category: null,
    monthly_amount: 100, start_month: '2026-09-01', end_month: '2026-10-01', created_at: '' }
  assert.equal(isFixedExpenseApplicable(expense, '2026-08'), false)
  assert.equal(isFixedExpenseApplicable(expense, '2026-09'), true)
  assert.equal(isFixedExpenseApplicable(expense, '2026-10'), true)
  assert.equal(isFixedExpenseApplicable(expense, '2026-11'), false)
  const result = calculateBudgetExpenses({
    monthKeys: ['2026-09', '2026-10'], periodStart: '2026-09-15', periodEnd: '2026-10-15',
    fixedExpenses: [expense], variableExpenses: [
      { id: 'included', name: 'Frais fictifs', category: null, amount: 25,
        expense_date: '2026-10-15', notes: null, created_at: '' },
      { id: 'excluded', name: 'Frais hors periode', category: null, amount: 80,
        expense_date: '2026-10-16', notes: null, created_at: '' },
    ],
    administrativePayrollExpenses: [
      { id: 'pay-test', staff_id: staff.id, payroll_month: '2026-09-01', payable_hours: 80,
        total_mad: 3200, mad_to_cad_rate: 0.15, total_cad: 480,
        rate_date: '2026-09-30', payment_date: '2026-09-30', rate_source: 'fixture', updated_at: '' },
    ],
  })
  assert.deepEqual(result, {
    fixedExpenses: 200, variableExpenses: 25, administrativePayrollExpenses: 480, totalExpenses: 705,
  })
})

test('ferie travaille, ferie non travaille, vacances et absence ont des montants distincts', () => {
  assert.equal(calculatePayableHours('holiday_worked', 4, 4), 8)
  assert.equal(calculatePayableHours('holiday_paid', 0, 4), 4)
  assert.equal(calculatePayableHours('vacation_paid', 4, 4), 4)
  assert.equal(calculatePayableHours('unpaid_absence', 4, 4), 0)
  const entry = buildDefaultTimeEntry({ staff, dateValue: '2026-10-05', holidayName: 'Ferie fictif' })
  assert.equal(entry.entry_type, 'holiday_paid')
  assert.equal(buildPayrollRow({ staff, entry, holidayName: 'Ferie fictif' }).amount, 160)
  assert.equal(buildPayrollRow({
    staff, entry: { ...entry, entry_type: 'holiday_worked' },
    holidayName: 'Ferie fictif', hourlyRateOverride: 50,
  }).amount, 400)
})

test('un samedi a zero heure reste modifiable sans ajouter automatiquement un salaire', () => {
  const entry = buildDefaultTimeEntry({ staff, dateValue: '2026-10-03', holidayName: null })
  assert.equal(entry.hours, 0)
  assert.equal(buildPayrollRow({ staff, entry, holidayName: null }).amount, 0)
  assert.equal(buildPayrollRow({
    staff, entry: { ...entry, entry_type: 'custom', hours: 4 }, holidayName: null,
  }).amount, 160)
  assert.equal(calculateHoursBetween('12:00', '18:30', 30), 6)
})
