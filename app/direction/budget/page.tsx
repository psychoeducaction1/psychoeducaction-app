'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { AppNav } from '@/components/AppNav'
import {
  Badge,
  buttonClass,
  EmptyState,
  PageHeader,
  StatCard,
  tableBodyClass,
  tableCellClass,
  tableClass,
  tableHeadCellClass,
  tableHeaderClass,
  tableRowClass,
  tableShellClass,
} from '@/components/ui/index'
import {
  calculateBudget,
  type BudgetCalculationResult,
  type BudgetLineType,
  type ProfessionalBudgetResult,
} from '@/lib/budgetCalculator'
import {
  calculateBudgetExpenses,
  type AdministrativePayrollExpense,
  type BudgetFixedExpense,
  type BudgetVariableExpense,
} from '@/lib/budgetExpenses'
import {
  PAYROLL_CATEGORY_LABELS,
  type PayrollCategory,
  type ProfessionalPayrollInfo,
} from '@/lib/payrollCalculator'
import { isSuperAdmin } from '@/lib/superAdmin'
import { supabase } from '@/lib/supabaseClient'

const inputClass =
  'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition duration-200 focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

const lineTypeLabels: Record<BudgetLineType, string> = {
  rencontre: 'Rencontre',
  annulation: 'Annulation',
  ouverture_dossier: 'Ouverture de dossier',
  deplacement_exclu: 'Déplacement exclu',
}

const lineTypeTones: Record<BudgetLineType, 'neutral' | 'success' | 'warning' | 'muted'> = {
  rencontre: 'neutral',
  annulation: 'warning',
  ouverture_dossier: 'success',
  deplacement_exclu: 'muted',
}

type BudgetPeriodRow = {
  id: string
  period_start: string
  period_end: string
  accounting_month: string
  source_file_name: string | null
  gross_revenue: number
  professional_pay: number
  nancy_pay: number
  clinic_revenue: number
  travel_excluded: number
  dossier_revenue: number
  cancellation_revenue: number
  meeting_count: number
  fixed_expenses: number
  variable_expenses: number
  administrative_payroll_expenses: number
  total_expenses: number
  net_result: number
  created_at: string
}

type BudgetPeriodProfessionalRow = {
  id: string
  budget_period_id: string
  professional_id: string | null
  professional_name: string
  gross_revenue: number
  professional_pay: number
  nancy_pay: number
  clinic_revenue: number
  travel_excluded: number
  dossier_revenue: number
  cancellation_revenue: number
  meeting_count: number
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(value)
}

function formatMonth(monthKey: string): string {
  const date = new Date(`${monthKey}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return monthKey

  return new Intl.DateTimeFormat('fr-CA', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('fr-CA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export default function DirectionBudgetPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [error, setError] = useState('')
  const [currentUserId, setCurrentUserId] = useState('')
  const [professionals, setProfessionals] = useState<ProfessionalPayrollInfo[]>([])
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [fileName, setFileName] = useState('')
  const [calculating, setCalculating] = useState(false)
  const [savingPeriod, setSavingPeriod] = useState(false)
  const [calculationError, setCalculationError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [result, setResult] = useState<BudgetCalculationResult | null>(null)
  const [savedPeriods, setSavedPeriods] = useState<BudgetPeriodRow[]>([])
  const [savedPeriodDetails, setSavedPeriodDetails] = useState<
    BudgetPeriodProfessionalRow[]
  >([])
  const [fixedExpenses, setFixedExpenses] = useState<BudgetFixedExpense[]>([])
  const [variableExpenses, setVariableExpenses] = useState<BudgetVariableExpense[]>([])
  const [administrativePayrollExpenses, setAdministrativePayrollExpenses] = useState<
    AdministrativePayrollExpense[]
  >([])
  const [expenseMessage, setExpenseMessage] = useState('')
  const [expenseError, setExpenseError] = useState('')
  const [savingExpense, setSavingExpense] = useState(false)
  const [fixedExpenseName, setFixedExpenseName] = useState('')
  const [fixedExpenseCategory, setFixedExpenseCategory] = useState('')
  const [fixedExpenseAmount, setFixedExpenseAmount] = useState('')
  const [fixedExpenseStartMonth, setFixedExpenseStartMonth] = useState(
    new Date().toISOString().slice(0, 7)
  )
  const [fixedExpenseEndMonth, setFixedExpenseEndMonth] = useState('')
  const [variableExpenseName, setVariableExpenseName] = useState('')
  const [variableExpenseCategory, setVariableExpenseCategory] = useState('')
  const [variableExpenseAmount, setVariableExpenseAmount] = useState('')
  const [variableExpenseDate, setVariableExpenseDate] = useState(
    new Date().toISOString().slice(0, 10)
  )
  const [variableExpenseNotes, setVariableExpenseNotes] = useState('')

  const currentExpenseSummary = useMemo(() => {
    if (
      !result?.detectedPeriod.startDate ||
      !result.detectedPeriod.endDate
    ) {
      return {
        fixedExpenses: 0,
        variableExpenses: 0,
        administrativePayrollExpenses: 0,
        totalExpenses: 0,
      }
    }

    return calculateBudgetExpenses({
      monthKeys: result.detectedPeriod.monthKeys,
      periodStart: result.detectedPeriod.startDate,
      periodEnd: result.detectedPeriod.endDate,
      fixedExpenses,
      variableExpenses,
      administrativePayrollExpenses,
    })
  }, [administrativePayrollExpenses, fixedExpenses, result, variableExpenses])

  const savedMonths = Array.from(
    savedPeriods.reduce((months, period) => {
      const liveExpenses = calculateBudgetExpenses({
        monthKeys: [period.accounting_month],
        periodStart: period.period_start,
        periodEnd: period.period_end,
        fixedExpenses,
        variableExpenses,
        administrativePayrollExpenses,
      })
      const current =
        months.get(period.accounting_month) ??
        ({
          monthKey: period.accounting_month,
          grossRevenue: 0,
          professionalPay: 0,
          nancyPay: 0,
          clinicRevenue: 0,
          travelExcluded: 0,
          dossierRevenue: 0,
          cancellationRevenue: 0,
          meetingCount: 0,
          fixedExpenses: 0,
          variableExpenses: 0,
          administrativePayrollExpenses: 0,
          totalExpenses: 0,
          netResult: 0,
        } as const)

      months.set(period.accounting_month, {
        monthKey: period.accounting_month,
        grossRevenue: current.grossRevenue + Number(period.gross_revenue ?? 0),
        professionalPay:
          current.professionalPay + Number(period.professional_pay ?? 0),
        nancyPay: current.nancyPay + Number(period.nancy_pay ?? 0),
        clinicRevenue:
          current.clinicRevenue + Number(period.clinic_revenue ?? 0),
        travelExcluded:
          current.travelExcluded + Number(period.travel_excluded ?? 0),
        dossierRevenue:
          current.dossierRevenue + Number(period.dossier_revenue ?? 0),
        cancellationRevenue:
          current.cancellationRevenue + Number(period.cancellation_revenue ?? 0),
        meetingCount: current.meetingCount + Number(period.meeting_count ?? 0),
        fixedExpenses:
          current.fixedExpenses + liveExpenses.fixedExpenses,
        variableExpenses:
          current.variableExpenses + liveExpenses.variableExpenses,
        administrativePayrollExpenses:
          current.administrativePayrollExpenses +
          liveExpenses.administrativePayrollExpenses,
        totalExpenses:
          current.totalExpenses + liveExpenses.totalExpenses,
        netResult:
          current.netResult +
          Number(period.clinic_revenue ?? 0) -
          liveExpenses.totalExpenses,
      })

      return months
    }, new Map<string, {
      monthKey: string
      grossRevenue: number
      professionalPay: number
      nancyPay: number
      clinicRevenue: number
      travelExcluded: number
      dossierRevenue: number
      cancellationRevenue: number
      meetingCount: number
      fixedExpenses: number
      variableExpenses: number
      administrativePayrollExpenses: number
      totalExpenses: number
      netResult: number
    }>())
  )
    .map(([, month]) => month)
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.push('/login')
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, email')
        .eq('id', user.id)
        .limit(1)
        .maybeSingle()

      if (profileError) {
        setError(profileError.message)
        setLoading(false)
        return
      }

      if (!isSuperAdmin({ email: user.email }, profile)) {
        router.push('/direction')
        return
      }

      setAuthorized(true)
      setCurrentUserId(user.id)

      const { data: professionalsData, error: professionalsError } = await supabase
        .from('profiles')
        .select(
          'id, full_name, email, professional_phone, professional_title, payroll_category, professional_address'
        )
        .eq('role', 'professionnel')
        .eq('is_active', true)
        .order('full_name', { ascending: true })

      if (professionalsError) {
        setError(professionalsError.message)
        setLoading(false)
        return
      }

      setProfessionals(
        (professionalsData ?? []).map(
          (row: {
            id: string
            full_name: string | null
            email: string | null
            professional_phone: string | null
            professional_title: string | null
            payroll_category: string | null
            professional_address: string | null
          }) => ({
            id: row.id,
            fullName: row.full_name?.trim() || row.email?.trim() || 'Professionnel',
            email: row.email,
            professionalPhone: row.professional_phone,
            professionalTitle: row.professional_title,
            payrollCategory: (row.payroll_category as PayrollCategory | null) ?? null,
            professionalAddress: row.professional_address,
          })
        )
      )

      const { data: budgetPeriodsData, error: budgetPeriodsError } = await supabase
        .from('budget_periods')
        .select(
          'id, period_start, period_end, accounting_month, source_file_name, gross_revenue, professional_pay, nancy_pay, clinic_revenue, travel_excluded, dossier_revenue, cancellation_revenue, meeting_count, fixed_expenses, variable_expenses, administrative_payroll_expenses, total_expenses, net_result, created_at'
        )
        .order('period_start', { ascending: false })

      if (!budgetPeriodsError) {
        setSavedPeriods((budgetPeriodsData ?? []) as BudgetPeriodRow[])
      }

      const periodIds = (budgetPeriodsData ?? []).map((period) => period.id as string)

      if (periodIds.length > 0) {
        const { data: budgetDetailsData } = await supabase
          .from('budget_period_professionals')
          .select(
            'id, budget_period_id, professional_id, professional_name, gross_revenue, professional_pay, nancy_pay, clinic_revenue, travel_excluded, dossier_revenue, cancellation_revenue, meeting_count'
          )
          .in('budget_period_id', periodIds)

        setSavedPeriodDetails((budgetDetailsData ?? []) as BudgetPeriodProfessionalRow[])
      }

      const [
        { data: fixedExpenseData, error: fixedExpenseError },
        { data: variableExpenseData, error: variableExpenseError },
        { data: administrativePayrollData, error: administrativePayrollError },
      ] = await Promise.all([
        supabase
          .from('budget_fixed_expenses')
          .select('id, name, category, monthly_amount, start_month, end_month, created_at')
          .order('name', { ascending: true }),
        supabase
          .from('budget_variable_expenses')
          .select('id, name, category, amount, expense_date, notes, created_at')
          .order('expense_date', { ascending: false }),
        supabase
          .from('administrative_payroll_months')
          .select(
            'id, staff_id, payroll_month, payable_hours, total_mad, mad_to_cad_rate, total_cad, rate_date, payment_date, rate_source, updated_at, administrative_staff(full_name)'
          )
          .order('payroll_month', { ascending: false }),
      ])

      if (fixedExpenseError || variableExpenseError || administrativePayrollError) {
        setExpenseError(
          fixedExpenseError?.message ??
            variableExpenseError?.message ??
            administrativePayrollError?.message ??
            ''
        )
      } else {
        setFixedExpenses(
          (fixedExpenseData ?? []).map((expense) => ({
            ...expense,
            monthly_amount: Number(expense.monthly_amount ?? 0),
          })) as BudgetFixedExpense[]
        )
        setVariableExpenses(
          (variableExpenseData ?? []).map((expense) => ({
            ...expense,
            amount: Number(expense.amount ?? 0),
          })) as BudgetVariableExpense[]
        )
        setAdministrativePayrollExpenses(
          (administrativePayrollData ?? []).map((expense) => ({
            ...expense,
            payable_hours: Number(expense.payable_hours ?? 0),
            total_mad: Number(expense.total_mad ?? 0),
            mad_to_cad_rate: Number(expense.mad_to_cad_rate ?? 0),
            total_cad: Number(expense.total_cad ?? 0),
            staff_name:
              (expense.administrative_staff as { full_name?: string } | null)
                ?.full_name ?? 'Adjointe administrative',
          })) as AdministrativePayrollExpense[]
        )
      }

      setLoading(false)
    }

    loadData()
  }, [router])

  const handleAddFixedExpense = async () => {
    setExpenseMessage('')
    setExpenseError('')
    const amount = Number(fixedExpenseAmount.replace(',', '.'))

    if (!fixedExpenseName.trim() || !Number.isFinite(amount) || amount <= 0) {
      setExpenseError('Indiquez un nom et un montant mensuel supérieur à zéro.')
      return
    }

    if (!fixedExpenseStartMonth) {
      setExpenseError('Indiquez le mois de début de la dépense fixe.')
      return
    }

    if (fixedExpenseEndMonth && fixedExpenseEndMonth < fixedExpenseStartMonth) {
      setExpenseError('Le mois de fin doit être postérieur au mois de début.')
      return
    }

    setSavingExpense(true)
    const { data, error: insertError } = await supabase
      .from('budget_fixed_expenses')
      .insert({
        name: fixedExpenseName.trim(),
        category: fixedExpenseCategory.trim() || null,
        monthly_amount: amount,
        start_month: `${fixedExpenseStartMonth}-01`,
        end_month: fixedExpenseEndMonth ? `${fixedExpenseEndMonth}-01` : null,
        created_by: currentUserId,
      })
      .select('id, name, category, monthly_amount, start_month, end_month, created_at')
      .limit(1)
      .maybeSingle()

    setSavingExpense(false)

    if (insertError || !data) {
      setExpenseError(insertError?.message ?? 'Impossible d’enregistrer la dépense fixe.')
      return
    }

    setFixedExpenses((current) => [
      ...current,
      { ...data, monthly_amount: Number(data.monthly_amount ?? 0) } as BudgetFixedExpense,
    ].sort((a, b) => a.name.localeCompare(b.name, 'fr')))
    setFixedExpenseName('')
    setFixedExpenseCategory('')
    setFixedExpenseAmount('')
    setFixedExpenseEndMonth('')
    setExpenseMessage('Dépense fixe enregistrée.')
  }

  const handleAddVariableExpense = async () => {
    setExpenseMessage('')
    setExpenseError('')
    const amount = Number(variableExpenseAmount.replace(',', '.'))

    if (!variableExpenseName.trim() || !Number.isFinite(amount) || amount <= 0) {
      setExpenseError('Indiquez un nom et un montant supérieur à zéro.')
      return
    }

    if (!variableExpenseDate) {
      setExpenseError('Indiquez la date de la dépense.')
      return
    }

    setSavingExpense(true)
    const { data, error: insertError } = await supabase
      .from('budget_variable_expenses')
      .insert({
        name: variableExpenseName.trim(),
        category: variableExpenseCategory.trim() || null,
        amount,
        expense_date: variableExpenseDate,
        notes: variableExpenseNotes.trim() || null,
        created_by: currentUserId,
      })
      .select('id, name, category, amount, expense_date, notes, created_at')
      .limit(1)
      .maybeSingle()

    setSavingExpense(false)

    if (insertError || !data) {
      setExpenseError(
        insertError?.message ?? 'Impossible d’enregistrer la dépense variable.'
      )
      return
    }

    setVariableExpenses((current) => [
      { ...data, amount: Number(data.amount ?? 0) } as BudgetVariableExpense,
      ...current,
    ])
    setVariableExpenseName('')
    setVariableExpenseCategory('')
    setVariableExpenseAmount('')
    setVariableExpenseNotes('')
    setExpenseMessage('Dépense variable enregistrée.')
  }

  const handleDeleteExpense = async (
    type: 'fixed' | 'variable',
    expenseId: string
  ) => {
    if (!window.confirm('Supprimer cette dépense ?')) return

    setExpenseMessage('')
    setExpenseError('')
    const table =
      type === 'fixed' ? 'budget_fixed_expenses' : 'budget_variable_expenses'
    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .eq('id', expenseId)

    if (deleteError) {
      setExpenseError(deleteError.message)
      return
    }

    if (type === 'fixed') {
      setFixedExpenses((current) =>
        current.filter((expense) => expense.id !== expenseId)
      )
    } else {
      setVariableExpenses((current) =>
        current.filter((expense) => expense.id !== expenseId)
      )
    }
    setExpenseMessage('Dépense supprimée. Les budgets déjà enregistrés sont inchangés.')
  }

  const handleCalculate = async () => {
    setCalculationError('')
    setSaveMessage('')
    setSaveError('')
    setResult(null)
    setPeriodStart('')
    setPeriodEnd('')

    const file = fileInputRef.current?.files?.[0]

    if (!file) {
      setCalculationError('Veuillez sélectionner un fichier Excel.')
      return
    }

    setCalculating(true)

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: false,
      }) as unknown[][]

      const budgetResult = calculateBudget(rows, professionals)

      if (
        !budgetResult.detectedPeriod.startDate ||
        !budgetResult.detectedPeriod.endDate
      ) {
        setCalculationError(
          'Aucune date valide n’a été détectée dans le fichier Excel.'
        )
        return
      }

      setPeriodStart(budgetResult.detectedPeriod.startDate)
      setPeriodEnd(budgetResult.detectedPeriod.endDate)
      setResult(budgetResult)
    } catch (caughtError) {
      setCalculationError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Erreur inconnue pendant la lecture du fichier.'
      )
    } finally {
      setCalculating(false)
    }
  }

  const handleSavePeriod = async () => {
    if (!result) return

    setSaveMessage('')
    setSaveError('')

    if (!currentUserId) {
      setSaveError('Utilisateur introuvable.')
      return
    }

    if (!result.detectedPeriod.startDate || !result.detectedPeriod.endDate) {
      setSaveError('Période détectée introuvable.')
      return
    }

    const monthlyPeriods = result.monthlyResults.map((month) => {
      const professionalDetails = result.professionalResults
        .map((professionalResult) => {
          const lines = professionalResult.lineItems.filter(
            (line) => line.monthKey === month.monthKey
          )
          const detail = lines.reduce(
            (current, line) => {
              if (line.type === 'deplacement_exclu') {
                current.travelExcluded += line.clientAmount
              } else {
                current.grossRevenue += line.clientAmount
                current.professionalPay += line.professionalPay
                current.nancyPay += line.nancyPay
                current.clinicRevenue += line.clinicRevenue
              }

              if (line.type === 'ouverture_dossier') {
                current.dossierRevenue += line.clinicRevenue
              }

              if (line.type === 'annulation') {
                current.cancellationRevenue += line.clinicRevenue
              }

              if (line.type === 'rencontre') {
                current.meetingCount += 1
              }

              if (line.date) {
                current.dates.push(line.date)
              }

              return current
            },
            {
              grossRevenue: 0,
              professionalPay: 0,
              nancyPay: 0,
              clinicRevenue: 0,
              travelExcluded: 0,
              dossierRevenue: 0,
              cancellationRevenue: 0,
              meetingCount: 0,
              dates: [] as string[],
            }
          )

          if (
            detail.grossRevenue <= 0 &&
            detail.travelExcluded <= 0 &&
            detail.clinicRevenue <= 0
          ) {
            return null
          }

          return {
            professionalResult,
            ...detail,
          }
        })
        .filter(
          (detail): detail is {
            professionalResult: ProfessionalBudgetResult
            grossRevenue: number
            professionalPay: number
            nancyPay: number
            clinicRevenue: number
            travelExcluded: number
            dossierRevenue: number
            cancellationRevenue: number
            meetingCount: number
            dates: string[]
          } => Boolean(detail)
        )

      const dates = professionalDetails
        .flatMap((detail) => detail.dates)
        .sort((a, b) => a.localeCompare(b))
      const startDate = dates[0] ?? result.detectedPeriod.startDate
      const endDate = dates[dates.length - 1] ?? result.detectedPeriod.endDate
      const expenses = calculateBudgetExpenses({
        monthKeys: [month.monthKey],
        periodStart: startDate,
        periodEnd: endDate,
        fixedExpenses,
        variableExpenses,
        administrativePayrollExpenses,
      })

      return {
        month,
        professionalDetails,
        startDate,
        endDate,
        ...expenses,
        netResult: month.clinicRevenue - expenses.totalExpenses,
      }
    })

    if (monthlyPeriods.length === 0) {
      setSaveError('Aucun mois calculable à enregistrer.')
      return
    }

    const confirmed = window.confirm(
      [
        'Enregistrer cette analyse budget ?',
        '',
        `Période détectée : ${result.detectedPeriod.startDate} au ${result.detectedPeriod.endDate}`,
        `Mois détectés : ${monthlyPeriods.map((period) => period.month.monthKey).join(', ')}`,
        '',
        'Tout calcul déjà enregistré pour ces mêmes mois sera remplacé.',
      ].join('\n')
    )

    if (!confirmed) return

    setSavingPeriod(true)

    const insertedPeriods: BudgetPeriodRow[] = []
    const insertedDetails: BudgetPeriodProfessionalRow[] = []

    for (const monthlyPeriod of monthlyPeriods) {
      const { data: insertedPeriod, error: periodError } = await supabase
        .from('budget_periods')
        .upsert({
          period_start: monthlyPeriod.startDate,
          period_end: monthlyPeriod.endDate,
          accounting_month: monthlyPeriod.month.monthKey,
          source_file_name: fileName || null,
          gross_revenue: monthlyPeriod.month.grossRevenue,
          professional_pay: monthlyPeriod.month.professionalPay,
          nancy_pay: monthlyPeriod.month.nancyPay,
          clinic_revenue: monthlyPeriod.month.clinicRevenue,
          travel_excluded: monthlyPeriod.month.travelExcluded,
          dossier_revenue: monthlyPeriod.month.dossierRevenue,
          cancellation_revenue: monthlyPeriod.month.cancellationRevenue,
          fixed_expenses: monthlyPeriod.fixedExpenses,
          variable_expenses: monthlyPeriod.variableExpenses,
          administrative_payroll_expenses:
            monthlyPeriod.administrativePayrollExpenses,
          total_expenses: monthlyPeriod.totalExpenses,
          net_result: monthlyPeriod.netResult,
          meeting_count: monthlyPeriod.professionalDetails.reduce(
            (total, detail) => total + detail.meetingCount,
            0
          ),
          created_by: currentUserId,
        }, {
          onConflict: 'period_start,period_end,accounting_month',
        })
        .select(
          'id, period_start, period_end, accounting_month, source_file_name, gross_revenue, professional_pay, nancy_pay, clinic_revenue, travel_excluded, dossier_revenue, cancellation_revenue, meeting_count, fixed_expenses, variable_expenses, administrative_payroll_expenses, total_expenses, net_result, created_at'
        )
        .limit(1)
        .maybeSingle()

      if (periodError || !insertedPeriod) {
        setSavingPeriod(false)
        setSaveError(
          periodError?.message ??
            "Impossible d'enregistrer cette période budget."
        )
        return
      }

      insertedPeriods.push(insertedPeriod as BudgetPeriodRow)

      const { error: clearDetailsError } = await supabase
        .from('budget_period_professionals')
        .delete()
        .eq('budget_period_id', insertedPeriod.id)

      if (clearDetailsError) {
        setSavingPeriod(false)
        setSaveError(clearDetailsError.message)
        return
      }

      const detailRows = monthlyPeriod.professionalDetails.map((detail) => ({
        budget_period_id: insertedPeriod.id,
        professional_id: detail.professionalResult.professional.id,
        professional_name: detail.professionalResult.professional.fullName,
        gross_revenue: detail.grossRevenue,
        professional_pay: detail.professionalPay,
        nancy_pay: detail.nancyPay,
        clinic_revenue: detail.clinicRevenue,
        travel_excluded: detail.travelExcluded,
        dossier_revenue: detail.dossierRevenue,
        cancellation_revenue: detail.cancellationRevenue,
        meeting_count: detail.meetingCount,
      }))

      if (detailRows.length > 0) {
        const { data: monthlyDetails, error: detailsError } = await supabase
          .from('budget_period_professionals')
          .insert(detailRows)
          .select(
            'id, budget_period_id, professional_id, professional_name, gross_revenue, professional_pay, nancy_pay, clinic_revenue, travel_excluded, dossier_revenue, cancellation_revenue, meeting_count'
          )

        if (detailsError) {
          setSavingPeriod(false)
          setSaveError(detailsError.message)
          return
        }

        insertedDetails.push(
          ...((monthlyDetails ?? []) as BudgetPeriodProfessionalRow[])
        )
      }

      const { error: oldPeriodsError } = await supabase
        .from('budget_periods')
        .delete()
        .eq('accounting_month', monthlyPeriod.month.monthKey)
        .neq('id', insertedPeriod.id)

      if (oldPeriodsError) {
        setSavingPeriod(false)
        setSaveError(oldPeriodsError.message)
        return
      }
    }

    const replacedMonths = new Set(
      monthlyPeriods.map((period) => period.month.monthKey)
    )
    const replacedPeriodIds = new Set(
      savedPeriods
        .filter((period) => replacedMonths.has(period.accounting_month))
        .map((period) => period.id)
    )

    setSavedPeriodDetails((current) => [
      ...insertedDetails,
      ...current.filter(
        (detail) => !replacedPeriodIds.has(detail.budget_period_id)
      ),
    ])
    setSavedPeriods((current) => [
      ...insertedPeriods,
      ...current.filter(
        (period) => !replacedMonths.has(period.accounting_month)
      ),
    ])
    setSavingPeriod(false)
    setSaveMessage(
      monthlyPeriods.length === 1
        ? 'Budget mensuel enregistré et ancien calcul remplacé.'
        : `${monthlyPeriods.length} budgets mensuels enregistrés et anciens calculs remplacés.`
    )
  }

  const getMonthExpenseSummary = (monthKey: string) =>
    calculateBudgetExpenses({
      monthKeys: [monthKey],
      periodStart: result?.detectedPeriod.startDate ?? `${monthKey}-01`,
      periodEnd: result?.detectedPeriod.endDate ?? `${monthKey}-31`,
      fixedExpenses,
      variableExpenses,
      administrativePayrollExpenses,
    })

  if (loading) {
    return (
      <>
        <AppNav />
        <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
          <div className="mx-auto max-w-6xl">
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement...
            </div>
          </div>
        </main>
      </>
    )
  }

  if (!authorized) return null

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl space-y-8">
          <PageHeader
            eyebrow="Direction"
            title="Budget"
            description="Calcule les revenus de la clinique à partir du même fichier Excel que la paie, sans enregistrer de données."
          />

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              {error}
            </div>
          )}

          <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
            <h2 className="text-base font-semibold text-[#332820]">
              Historique enregistré
            </h2>
            <p className="mt-1 text-sm leading-6 text-[#7a6859]">
              Périodes sauvegardées manuellement après vérification des calculs.
            </p>

            <div className={`${tableShellClass} mt-4`}>
              <table className={`${tableClass} w-full min-w-[820px]`}>
                <thead className={tableHeaderClass}>
                  <tr>
                    <th className={tableHeadCellClass}>Mois</th>
                    <th className={tableHeadCellClass}>Montant facturé</th>
                    <th className={tableHeadCellClass}>Professionnels</th>
                    <th className={tableHeadCellClass}>Nancy</th>
                    <th className={tableHeadCellClass}>Clinique</th>
                    <th className={tableHeadCellClass}>Dépenses</th>
                    <th className={tableHeadCellClass}>Résultat net</th>
                    <th className={tableHeadCellClass}>Déplacements exclus</th>
                  </tr>
                </thead>
                <tbody className={tableBodyClass}>
                  {savedMonths.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8">
                        <EmptyState title="Aucune période budget enregistrée." />
                      </td>
                    </tr>
                  ) : (
                    savedMonths.map((month) => (
                      <tr key={month.monthKey} className={tableRowClass}>
                        <td className={tableCellClass}>{formatMonth(month.monthKey)}</td>
                        <td className={tableCellClass}>
                          {formatCurrency(month.grossRevenue)}
                        </td>
                        <td className={tableCellClass}>
                          {formatCurrency(month.professionalPay)}
                        </td>
                        <td className={tableCellClass}>
                          {formatCurrency(month.nancyPay)}
                        </td>
                        <td className={`${tableCellClass} font-semibold text-[#332820]`}>
                          {formatCurrency(month.clinicRevenue)}
                        </td>
                        <td className={tableCellClass}>
                          {formatCurrency(month.totalExpenses)}
                        </td>
                        <td className={`${tableCellClass} font-semibold text-[#332820]`}>
                          {formatCurrency(month.netResult)}
                        </td>
                        <td className={tableCellClass}>
                          {formatCurrency(month.travelExcluded)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {savedPeriods.length > 0 && (
              <div className={`${tableShellClass} mt-5`}>
                <table className={`${tableClass} w-full min-w-[980px]`}>
                  <thead className={tableHeaderClass}>
                    <tr>
                      <th className={tableHeadCellClass}>Période</th>
                      <th className={tableHeadCellClass}>Mois comptable</th>
                      <th className={tableHeadCellClass}>Fichier</th>
                      <th className={tableHeadCellClass}>Clinique</th>
                      <th className={tableHeadCellClass}>Facturé</th>
                      <th className={tableHeadCellClass}>Professionnels</th>
                      <th className={tableHeadCellClass}>Nancy</th>
                      <th className={tableHeadCellClass}>Dépenses</th>
                      <th className={tableHeadCellClass}>Résultat net</th>
                      <th className={tableHeadCellClass}>Détails</th>
                    </tr>
                  </thead>
                  <tbody className={tableBodyClass}>
                    {savedPeriods.map((period) => {
                      const periodDetails = savedPeriodDetails.filter(
                        (detail) => detail.budget_period_id === period.id
                      )
                      const periodExpenses = calculateBudgetExpenses({
                        monthKeys: [period.accounting_month],
                        periodStart: period.period_start,
                        periodEnd: period.period_end,
                        fixedExpenses,
                        variableExpenses,
                        administrativePayrollExpenses,
                      })
                      const periodNetResult =
                        Number(period.clinic_revenue ?? 0) -
                        periodExpenses.totalExpenses

                      return (
                        <tr key={period.id} className={tableRowClass}>
                          <td className={tableCellClass}>
                            {formatDate(period.period_start)} au {formatDate(period.period_end)}
                          </td>
                          <td className={tableCellClass}>
                            {formatMonth(period.accounting_month)}
                          </td>
                          <td className={tableCellClass}>
                            {period.source_file_name ?? '-'}
                          </td>
                          <td className={`${tableCellClass} font-semibold text-[#332820]`}>
                            {formatCurrency(Number(period.clinic_revenue ?? 0))}
                          </td>
                          <td className={tableCellClass}>
                            {formatCurrency(Number(period.gross_revenue ?? 0))}
                          </td>
                          <td className={tableCellClass}>
                            {formatCurrency(Number(period.professional_pay ?? 0))}
                          </td>
                          <td className={tableCellClass}>
                            {formatCurrency(Number(period.nancy_pay ?? 0))}
                          </td>
                          <td className={tableCellClass}>
                            {formatCurrency(periodExpenses.totalExpenses)}
                          </td>
                          <td className={`${tableCellClass} font-semibold text-[#332820]`}>
                            {formatCurrency(periodNetResult)}
                          </td>
                          <td className={tableCellClass}>
                            <details>
                              <summary className="cursor-pointer text-sm font-semibold text-[#8a5633]">
                                {periodDetails.length} professionnel
                                {periodDetails.length > 1 ? 's' : ''}
                              </summary>
                              <div className="mt-2 space-y-2">
                                {periodDetails.map((detail) => (
                                  <div
                                    key={detail.id}
                                    className="rounded-xl border border-[#eadfd2] bg-white p-3 text-xs"
                                  >
                                    <p className="font-semibold text-[#332820]">
                                      {detail.professional_name}
                                    </p>
                                    <p className="mt-1 text-[#6c5a4d]">
                                      Clinique : {formatCurrency(Number(detail.clinic_revenue ?? 0))} · Facturé : {formatCurrency(Number(detail.gross_revenue ?? 0))}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <details className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
            <summary className="cursor-pointer list-none">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-[#332820]">
                    Dépenses de la clinique
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-[#7a6859]">
                    Gérez les dépenses mensuelles fixes et les dépenses ponctuelles.
                  </p>
                </div>
                <Badge tone="warning">
                  {fixedExpenses.length + variableExpenses.length} dépense
                  {fixedExpenses.length + variableExpenses.length > 1 ? 's' : ''}
                </Badge>
              </div>
            </summary>

            <div className="mt-5 space-y-7 border-t border-[#eadfd2] pt-5">
              {expenseMessage && (
                <p className="rounded-xl border border-[#d6c7aa] bg-[#f1ead9] px-4 py-3 text-sm text-[#5f5932]">
                  {expenseMessage}
                </p>
              )}
              {expenseError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {expenseError}
                </p>
              )}

              <section>
                <h3 className="text-sm font-semibold text-[#332820]">
                  Paie des adjointes
                </h3>
                <p className="mt-1 text-sm text-[#7a6859]">
                  Ajoutée automatiquement lors de la sauvegarde mensuelle des
                  heures. Le taux MAD/CAD est conservé avec chaque calcul.
                </p>
                <div className={`${tableShellClass} mt-4`}>
                  <table className={`${tableClass} w-full min-w-[760px]`}>
                    <thead className={tableHeaderClass}>
                      <tr>
                        <th className={tableHeadCellClass}>Mois</th>
                        <th className={tableHeadCellClass}>Adjointe</th>
                        <th className={tableHeadCellClass}>Total MAD</th>
                        <th className={tableHeadCellClass}>Taux MAD/CAD</th>
                        <th className={tableHeadCellClass}>Date du taux</th>
                        <th className={tableHeadCellClass}>Dépense CAD</th>
                      </tr>
                    </thead>
                    <tbody className={tableBodyClass}>
                      {administrativePayrollExpenses.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6">
                            <EmptyState title="Aucune paie administrative sauvegardée." />
                          </td>
                        </tr>
                      ) : (
                        administrativePayrollExpenses.map((expense) => (
                          <tr key={expense.id} className={tableRowClass}>
                            <td className={tableCellClass}>
                              {formatMonth(expense.payroll_month.slice(0, 7))}
                            </td>
                            <td className={tableCellClass}>{expense.staff_name}</td>
                            <td className={tableCellClass}>
                              {new Intl.NumberFormat('fr-CA', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }).format(expense.total_mad)}{' '}
                              DH
                            </td>
                            <td className={tableCellClass}>
                              {expense.mad_to_cad_rate.toFixed(6)}
                            </td>
                            <td className={tableCellClass}>
                              {formatDate(expense.rate_date)}
                            </td>
                            <td className={`${tableCellClass} font-semibold text-[#332820]`}>
                              {formatCurrency(expense.total_cad)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="border-t border-[#eadfd2] pt-6">
                <h3 className="text-sm font-semibold text-[#332820]">Dépenses fixes</h3>
                <p className="mt-1 text-sm text-[#7a6859]">
                  Le montant est appliqué une fois pour chaque mois analysé compris dans la plage.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <label className="text-sm font-medium text-[#5d4a3d]">
                    Nom
                    <input
                      value={fixedExpenseName}
                      onChange={(event) => setFixedExpenseName(event.target.value)}
                      placeholder="Loyer, logiciel..."
                      className={`${inputClass} mt-2`}
                    />
                  </label>
                  <label className="text-sm font-medium text-[#5d4a3d]">
                    Catégorie
                    <input
                      value={fixedExpenseCategory}
                      onChange={(event) => setFixedExpenseCategory(event.target.value)}
                      placeholder="Locaux, abonnement..."
                      className={`${inputClass} mt-2`}
                    />
                  </label>
                  <label className="text-sm font-medium text-[#5d4a3d]">
                    Montant mensuel
                    <input
                      value={fixedExpenseAmount}
                      onChange={(event) => setFixedExpenseAmount(event.target.value)}
                      type="number"
                      min="0"
                      step="0.01"
                      className={`${inputClass} mt-2`}
                    />
                  </label>
                  <label className="text-sm font-medium text-[#5d4a3d]">
                    À partir de
                    <input
                      value={fixedExpenseStartMonth}
                      onChange={(event) => setFixedExpenseStartMonth(event.target.value)}
                      type="month"
                      className={`${inputClass} mt-2`}
                    />
                  </label>
                  <label className="text-sm font-medium text-[#5d4a3d]">
                    Jusqu’à (facultatif)
                    <input
                      value={fixedExpenseEndMonth}
                      onChange={(event) => setFixedExpenseEndMonth(event.target.value)}
                      type="month"
                      className={`${inputClass} mt-2`}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={handleAddFixedExpense}
                  disabled={savingExpense}
                  className={`${buttonClass('primary')} mt-4`}
                >
                  Ajouter la dépense fixe
                </button>

                <div className={`${tableShellClass} mt-4`}>
                  <table className={`${tableClass} w-full min-w-[720px]`}>
                    <thead className={tableHeaderClass}>
                      <tr>
                        <th className={tableHeadCellClass}>Dépense</th>
                        <th className={tableHeadCellClass}>Catégorie</th>
                        <th className={tableHeadCellClass}>Montant mensuel</th>
                        <th className={tableHeadCellClass}>Période</th>
                        <th className={tableHeadCellClass}>Action</th>
                      </tr>
                    </thead>
                    <tbody className={tableBodyClass}>
                      {fixedExpenses.length === 0 ? (
                        <tr><td colSpan={5} className="px-4 py-6"><EmptyState title="Aucune dépense fixe." /></td></tr>
                      ) : fixedExpenses.map((expense) => (
                        <tr key={expense.id} className={tableRowClass}>
                          <td className={tableCellClass}>{expense.name}</td>
                          <td className={tableCellClass}>{expense.category ?? '-'}</td>
                          <td className={tableCellClass}>{formatCurrency(expense.monthly_amount)}</td>
                          <td className={tableCellClass}>
                            {formatMonth(expense.start_month.slice(0, 7))} à{' '}
                            {expense.end_month ? formatMonth(expense.end_month.slice(0, 7)) : 'maintenant'}
                          </td>
                          <td className={tableCellClass}>
                            <button
                              type="button"
                              onClick={() => handleDeleteExpense('fixed', expense.id)}
                              className={buttonClass('secondary')}
                            >
                              Supprimer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="border-t border-[#eadfd2] pt-6">
                <h3 className="text-sm font-semibold text-[#332820]">Dépenses variables</h3>
                <p className="mt-1 text-sm text-[#7a6859]">
                  Ces dépenses sont rattachées à leur date et incluses dans la période correspondante.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <label className="text-sm font-medium text-[#5d4a3d]">
                    Nom
                    <input value={variableExpenseName} onChange={(event) => setVariableExpenseName(event.target.value)} placeholder="Achat ponctuel..." className={`${inputClass} mt-2`} />
                  </label>
                  <label className="text-sm font-medium text-[#5d4a3d]">
                    Catégorie
                    <input value={variableExpenseCategory} onChange={(event) => setVariableExpenseCategory(event.target.value)} placeholder="Matériel, entretien..." className={`${inputClass} mt-2`} />
                  </label>
                  <label className="text-sm font-medium text-[#5d4a3d]">
                    Montant
                    <input value={variableExpenseAmount} onChange={(event) => setVariableExpenseAmount(event.target.value)} type="number" min="0" step="0.01" className={`${inputClass} mt-2`} />
                  </label>
                  <label className="text-sm font-medium text-[#5d4a3d]">
                    Date
                    <input value={variableExpenseDate} onChange={(event) => setVariableExpenseDate(event.target.value)} type="date" className={`${inputClass} mt-2`} />
                  </label>
                  <label className="text-sm font-medium text-[#5d4a3d]">
                    Note
                    <input value={variableExpenseNotes} onChange={(event) => setVariableExpenseNotes(event.target.value)} placeholder="Facultatif" className={`${inputClass} mt-2`} />
                  </label>
                </div>
                <button type="button" onClick={handleAddVariableExpense} disabled={savingExpense} className={`${buttonClass('primary')} mt-4`}>
                  Ajouter la dépense variable
                </button>

                <div className={`${tableShellClass} mt-4`}>
                  <table className={`${tableClass} w-full min-w-[720px]`}>
                    <thead className={tableHeaderClass}>
                      <tr>
                        <th className={tableHeadCellClass}>Date</th>
                        <th className={tableHeadCellClass}>Dépense</th>
                        <th className={tableHeadCellClass}>Catégorie</th>
                        <th className={tableHeadCellClass}>Montant</th>
                        <th className={tableHeadCellClass}>Action</th>
                      </tr>
                    </thead>
                    <tbody className={tableBodyClass}>
                      {variableExpenses.length === 0 ? (
                        <tr><td colSpan={5} className="px-4 py-6"><EmptyState title="Aucune dépense variable." /></td></tr>
                      ) : variableExpenses.map((expense) => (
                        <tr key={expense.id} className={tableRowClass}>
                          <td className={tableCellClass}>{formatDate(expense.expense_date)}</td>
                          <td className={tableCellClass}>
                            <p>{expense.name}</p>
                            {expense.notes && <p className="mt-1 text-xs text-[#8a6f5d]">{expense.notes}</p>}
                          </td>
                          <td className={tableCellClass}>{expense.category ?? '-'}</td>
                          <td className={tableCellClass}>{formatCurrency(expense.amount)}</td>
                          <td className={tableCellClass}>
                            <button type="button" onClick={() => handleDeleteExpense('variable', expense.id)} className={buttonClass('secondary')}>
                              Supprimer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </details>

          <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
            <div>
              <h2 className="text-base font-semibold text-[#332820]">
                Fichier et période
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#7a6859]">
                Téléversez le fichier Excel : la période et les mois sont détectés
                automatiquement à partir des dates du fichier. Les rendez-vous non
                facturables sont exclus.
              </p>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
              <label className="block text-sm font-medium text-[#5d4a3d]">
                Fichier Excel
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) => {
                    setFileName(event.target.files?.[0]?.name ?? '')
                    setPeriodStart('')
                    setPeriodEnd('')
                    setResult(null)
                    setSaveMessage('')
                    setSaveError('')
                    setCalculationError('')
                  }}
                  className={`${inputClass} mt-2`}
                />
              </label>
              <div className="rounded-xl border border-[#eadfd2] bg-white px-4 py-3 text-sm text-[#6c5a4d]">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#8a6f5d]">
                  Période détectée
                </p>
                <p className="mt-1 font-medium text-[#332820]">
                  {periodStart && periodEnd
                    ? `${formatDate(periodStart)} au ${formatDate(periodEnd)}`
                    : 'Après calcul du fichier'}
                </p>
              </div>
              <div className="rounded-xl border border-[#eadfd2] bg-white px-4 py-3 text-sm text-[#6c5a4d]">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#8a6f5d]">
                  Mois détectés
                </p>
                <p className="mt-1 font-medium text-[#332820]">
                  {result?.detectedPeriod.monthKeys.length
                    ? result.detectedPeriod.monthKeys.map(formatMonth).join(', ')
                    : 'Automatique'}
                </p>
              </div>
            </div>
            {fileName && (
              <p className="mt-2 text-xs text-[#8a6f5d]">
                Fichier sélectionné : {fileName}
              </p>
            )}

            {calculationError && (
              <p className="mt-3 text-sm font-medium text-red-700">
                {calculationError}
              </p>
            )}

            <button
              type="button"
              onClick={handleCalculate}
              disabled={calculating}
              className={`${buttonClass('primary')} mt-5`}
            >
              {calculating ? 'Calcul...' : 'Calculer le budget'}
            </button>
          </section>

          {result && (
            <section className="space-y-5">
              {result.warnings.length > 0 && (
                <div className="rounded-2xl border border-[#ead2bd] bg-[#fbf1e7] p-4 text-sm text-[#8a5633]">
                  <p className="font-semibold">Avertissements</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {result.warnings.map((warning, index) => (
                      <li key={index}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <StatCard
                  label="Revenu clinique"
                  value={formatCurrency(result.totals.clinicRevenue)}
                  helper="Rencontres, annulations calculables et ouvertures de dossier"
                  priority="high"
                  tone="success"
                />
                <StatCard
                  label="Montant facturé"
                  value={formatCurrency(result.totals.grossRevenue)}
                  helper="Exclut les déplacements et les non facturables"
                />
                <StatCard
                  label="Payé aux professionnels"
                  value={formatCurrency(result.totals.professionalPay)}
                  helper="Part calculée selon les règles de paie"
                />
                <StatCard
                  label="Part Nancy"
                  value={formatCurrency(result.totals.nancyPay)}
                  helper="Inclut la supervision associée à Rim"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Dépenses fixes"
                  value={formatCurrency(currentExpenseSummary.fixedExpenses)}
                  helper="Une fois par mois détecté"
                />
                <StatCard
                  label="Dépenses variables"
                  value={formatCurrency(currentExpenseSummary.variableExpenses)}
                  helper="Selon les dates de la période analysée"
                />
                <StatCard
                  label="Paie des adjointes"
                  value={formatCurrency(
                    currentExpenseSummary.administrativePayrollExpenses
                  )}
                  helper="Montants mensuels convertis automatiquement en CAD"
                />
                <StatCard
                  label="Dépenses totales"
                  value={formatCurrency(currentExpenseSummary.totalExpenses)}
                  helper="Fixes, variables et paie administrative"
                  tone="warm"
                />
                <StatCard
                  label="Résultat budgétaire"
                  value={formatCurrency(
                    result.totals.clinicRevenue - currentExpenseSummary.totalExpenses
                  )}
                  helper="Revenu clinique moins les dépenses"
                  priority="high"
                  tone="success"
                />
              </div>

              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-[#332820]">
                      Enregistrer dans l&apos;historique
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-[#7a6859]">
                      Sauvegarde les totaux vérifiés pour la période détectée du{' '}
                      {formatDate(periodStart)} au {formatDate(periodEnd)}. Si le
                      fichier contient plusieurs mois, ils seront enregistrés
                      séparément dans l’historique.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSavePeriod}
                    disabled={savingPeriod}
                    className={buttonClass('primary')}
                  >
                    {savingPeriod ? 'Enregistrement...' : 'Enregistrer cette période'}
                  </button>
                </div>
                {saveMessage && (
                  <p className="mt-3 rounded-xl border border-[#d6c7aa] bg-[#f1ead9] px-4 py-3 text-sm text-[#5f5932]">
                    {saveMessage}
                  </p>
                )}
                {saveError && (
                  <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {saveError}
                  </p>
                )}
              </section>

              <div className="grid gap-4 md:grid-cols-3">
                <StatCard
                  label="Ouvertures de dossier"
                  value={formatCurrency(result.totals.dossierRevenue)}
                  helper="100 % clinique"
                  tone="success"
                />
                <StatCard
                  label="Annulations"
                  value={formatCurrency(result.totals.cancellationRevenue)}
                  helper="Part clinique lorsque le montant est lisible"
                />
                <StatCard
                  label="Déplacements exclus"
                  value={formatCurrency(result.totals.travelExcluded)}
                  helper="Payés au professionnel, non comptés comme revenu clinique"
                  tone="warm"
                />
              </div>

              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <h2 className="text-base font-semibold text-[#332820]">
                  Revenus par mois
                </h2>
                <div className={`${tableShellClass} mt-4`}>
                  <table className={`${tableClass} w-full min-w-[760px]`}>
                    <thead className={tableHeaderClass}>
                      <tr>
                        <th className={tableHeadCellClass}>Mois</th>
                        <th className={tableHeadCellClass}>Montant facturé</th>
                        <th className={tableHeadCellClass}>Professionnels</th>
                        <th className={tableHeadCellClass}>Nancy</th>
                        <th className={tableHeadCellClass}>Clinique</th>
                        <th className={tableHeadCellClass}>Dépenses</th>
                        <th className={tableHeadCellClass}>Résultat net</th>
                        <th className={tableHeadCellClass}>Déplacements exclus</th>
                      </tr>
                    </thead>
                    <tbody className={tableBodyClass}>
                      {result.monthlyResults.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-8">
                            <EmptyState title="Aucun revenu calculable pour cette période." />
                          </td>
                        </tr>
                      ) : (
                        result.monthlyResults.map((month) => {
                          const monthExpenses = getMonthExpenseSummary(month.monthKey)

                          return (
                          <tr key={month.monthKey} className={tableRowClass}>
                            <td className={tableCellClass}>
                              {formatMonth(month.monthKey)}
                            </td>
                            <td className={tableCellClass}>
                              {formatCurrency(month.grossRevenue)}
                            </td>
                            <td className={tableCellClass}>
                              {formatCurrency(month.professionalPay)}
                            </td>
                            <td className={tableCellClass}>
                              {formatCurrency(month.nancyPay)}
                            </td>
                            <td className={`${tableCellClass} font-semibold text-[#332820]`}>
                              {formatCurrency(month.clinicRevenue)}
                            </td>
                            <td className={tableCellClass}>
                              {formatCurrency(monthExpenses.totalExpenses)}
                            </td>
                            <td className={`${tableCellClass} font-semibold text-[#332820]`}>
                              {formatCurrency(
                                month.clinicRevenue - monthExpenses.totalExpenses
                              )}
                            </td>
                            <td className={tableCellClass}>
                              {formatCurrency(month.travelExcluded)}
                            </td>
                          </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <details className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-[#332820]">
                        Détail par professionnel
                      </h2>
                      <p className="mt-1 text-sm text-[#7a6859]">
                        Ouvrir pour consulter toutes les lignes calculées.
                      </p>
                    </div>
                    <Badge tone="neutral">
                      {result.professionalResults.length} professionnel
                      {result.professionalResults.length > 1 ? 's' : ''}
                    </Badge>
                  </div>
                </summary>
                <div className="mt-4 space-y-4">
                  {result.professionalResults.length === 0 ? (
                    <EmptyState title="Aucun professionnel calculable." />
                  ) : (
                    result.professionalResults.map((professionalResult) => (
                      <div
                        key={professionalResult.professional.id}
                        className="rounded-xl border border-[#eadfd2] bg-white p-4"
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-[#332820]">
                              {professionalResult.professional.fullName}
                            </p>
                            <p className="mt-1 text-xs text-[#8a6f5d]">
                              {professionalResult.professional.payrollCategory
                                ? PAYROLL_CATEGORY_LABELS[
                                    professionalResult.professional.payrollCategory
                                  ]
                                : 'Règle spéciale ou catégorie non définie'}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge tone="success">
                              Clinique : {formatCurrency(professionalResult.clinicRevenue)}
                            </Badge>
                            <Badge tone="neutral">
                              Facturé : {formatCurrency(professionalResult.grossRevenue)}
                            </Badge>
                            <Badge tone="muted">
                              Pro : {formatCurrency(professionalResult.professionalPay)}
                            </Badge>
                            {professionalResult.nancyPay > 0 && (
                              <Badge tone="warning">
                                Nancy : {formatCurrency(professionalResult.nancyPay)}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className={`${tableShellClass} mt-3`}>
                          <table className={`${tableClass} w-full min-w-[820px]`}>
                            <thead className={tableHeaderClass}>
                              <tr>
                                <th className={tableHeadCellClass}>Date</th>
                                <th className={tableHeadCellClass}>Type</th>
                                <th className={tableHeadCellClass}>Description</th>
                                <th className={tableHeadCellClass}>Facturé</th>
                                <th className={tableHeadCellClass}>Pro</th>
                                {professionalResult.nancyPay > 0 && (
                                  <th className={tableHeadCellClass}>Nancy</th>
                                )}
                                <th className={tableHeadCellClass}>Clinique</th>
                              </tr>
                            </thead>
                            <tbody className={tableBodyClass}>
                              {professionalResult.lineItems.map((line, index) => (
                                <tr key={`${line.date}-${line.type}-${index}`} className={tableRowClass}>
                                  <td className={tableCellClass}>{formatDate(line.date)}</td>
                                  <td className={tableCellClass}>
                                    <Badge tone={lineTypeTones[line.type]}>
                                      {lineTypeLabels[line.type]}
                                    </Badge>
                                  </td>
                                  <td className={tableCellClass}>{line.description}</td>
                                  <td className={tableCellClass}>
                                    {formatCurrency(line.clientAmount)}
                                  </td>
                                  <td className={tableCellClass}>
                                    {formatCurrency(line.professionalPay)}
                                  </td>
                                  {professionalResult.nancyPay > 0 && (
                                    <td className={tableCellClass}>
                                      {formatCurrency(line.nancyPay)}
                                    </td>
                                  )}
                                  <td className={`${tableCellClass} font-semibold text-[#332820]`}>
                                    {formatCurrency(line.clinicRevenue)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </details>
            </section>
          )}
        </div>
      </main>
    </>
  )
}
