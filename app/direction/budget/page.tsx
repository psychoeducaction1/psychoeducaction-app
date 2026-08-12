'use client'

import { useEffect, useRef, useState } from 'react'
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
} from '@/lib/budgetCalculator'
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

function getDefaultPeriod() {
  const today = new Date()
  const endDate = today.toISOString().slice(0, 10)
  const start = new Date(today)
  start.setDate(start.getDate() - 13)

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate,
  }
}

export default function DirectionBudgetPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const defaultPeriod = getDefaultPeriod()

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [error, setError] = useState('')
  const [professionals, setProfessionals] = useState<ProfessionalPayrollInfo[]>([])
  const [periodStart, setPeriodStart] = useState(defaultPeriod.startDate)
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.endDate)
  const [fileName, setFileName] = useState('')
  const [calculating, setCalculating] = useState(false)
  const [calculationError, setCalculationError] = useState('')
  const [result, setResult] = useState<BudgetCalculationResult | null>(null)

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
      setLoading(false)
    }

    loadData()
  }, [router])

  const handleCalculate = async () => {
    setCalculationError('')
    setResult(null)

    const file = fileInputRef.current?.files?.[0]

    if (!file) {
      setCalculationError('Veuillez sélectionner un fichier Excel.')
      return
    }

    if (!periodStart || !periodEnd) {
      setCalculationError('Veuillez indiquer la période à analyser.')
      return
    }

    if (periodStart > periodEnd) {
      setCalculationError('La date de début doit précéder la date de fin.')
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

      setResult(
        calculateBudget(rows, professionals, {
          startDate: periodStart,
          endDate: periodEnd,
        })
      )
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
            <div>
              <h2 className="text-base font-semibold text-[#332820]">
                Fichier et période
              </h2>
              <p className="mt-1 text-sm leading-6 text-[#7a6859]">
                Sélectionnez une période de deux semaines ou toute autre plage à
                analyser. Les rendez-vous non facturables sont exclus.
              </p>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <label className="block text-sm font-medium text-[#5d4a3d]">
                Début de la période
                <input
                  type="date"
                  value={periodStart}
                  onChange={(event) => setPeriodStart(event.target.value)}
                  className={`${inputClass} mt-2`}
                />
              </label>
              <label className="block text-sm font-medium text-[#5d4a3d]">
                Fin de la période
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(event) => setPeriodEnd(event.target.value)}
                  className={`${inputClass} mt-2`}
                />
              </label>
              <label className="block text-sm font-medium text-[#5d4a3d]">
                Fichier Excel
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')}
                  className={`${inputClass} mt-2`}
                />
              </label>
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

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                        <th className={tableHeadCellClass}>Déplacements exclus</th>
                      </tr>
                    </thead>
                    <tbody className={tableBodyClass}>
                      {result.monthlyResults.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8">
                            <EmptyState title="Aucun revenu calculable pour cette période." />
                          </td>
                        </tr>
                      ) : (
                        result.monthlyResults.map((month) => (
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
                              {formatCurrency(month.travelExcluded)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <h2 className="text-base font-semibold text-[#332820]">
                  Détail par professionnel
                </h2>
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
                                <th className={tableHeadCellClass}>Nancy</th>
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
                                  <td className={tableCellClass}>
                                    {formatCurrency(line.nancyPay)}
                                  </td>
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
              </section>
            </section>
          )}
        </div>
      </main>
    </>
  )
}
