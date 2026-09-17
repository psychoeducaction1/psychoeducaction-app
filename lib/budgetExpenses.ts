export type BudgetFixedExpense = {
  id: string
  name: string
  category: string | null
  monthly_amount: number
  start_month: string
  end_month: string | null
  created_at: string
}

export type BudgetVariableExpense = {
  id: string
  name: string
  category: string | null
  amount: number
  expense_date: string
  notes: string | null
  created_at: string
}

export type AdministrativePayrollExpense = {
  id: string
  staff_id: string
  payroll_month: string
  payable_hours: number
  total_mad: number
  mad_to_cad_rate: number
  total_cad: number
  rate_date: string
  payment_date: string
  rate_source: string
  updated_at: string
  staff_name?: string
}

export type BudgetExpenseSummary = {
  fixedExpenses: number
  variableExpenses: number
  administrativePayrollExpenses: number
  totalExpenses: number
}

export function isFixedExpenseApplicable(
  expense: BudgetFixedExpense,
  monthKey: string
): boolean {
  const startMonth = expense.start_month.slice(0, 7)
  const endMonth = expense.end_month?.slice(0, 7) ?? null

  return startMonth <= monthKey && (!endMonth || endMonth >= monthKey)
}

export function calculateBudgetExpenses({
  monthKeys,
  periodStart,
  periodEnd,
  fixedExpenses,
  variableExpenses,
  administrativePayrollExpenses = [],
}: {
  monthKeys: string[]
  periodStart: string
  periodEnd: string
  fixedExpenses: BudgetFixedExpense[]
  variableExpenses: BudgetVariableExpense[]
  administrativePayrollExpenses?: AdministrativePayrollExpense[]
}): BudgetExpenseSummary {
  const fixedTotal = monthKeys.reduce(
    (total, monthKey) =>
      total +
      fixedExpenses
        .filter((expense) => isFixedExpenseApplicable(expense, monthKey))
        .reduce((sum, expense) => sum + Number(expense.monthly_amount ?? 0), 0),
    0
  )
  const variableTotal = variableExpenses
    .filter(
      (expense) =>
        monthKeys.includes(expense.expense_date.slice(0, 7)) &&
        expense.expense_date >= periodStart && expense.expense_date <= periodEnd
    )
    .reduce((sum, expense) => sum + Number(expense.amount ?? 0), 0)
  const administrativePayrollTotal = administrativePayrollExpenses
    .filter((expense) => monthKeys.includes(expense.payroll_month.slice(0, 7)))
    .reduce((sum, expense) => sum + Number(expense.total_cad ?? 0), 0)

  return {
    fixedExpenses: fixedTotal,
    variableExpenses: variableTotal,
    administrativePayrollExpenses: administrativePayrollTotal,
    totalExpenses: fixedTotal + variableTotal + administrativePayrollTotal,
  }
}
