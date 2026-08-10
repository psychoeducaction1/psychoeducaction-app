'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { AppNav } from '@/components/AppNav'
import { Badge, buttonClass, EmptyState, PageHeader } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import { isPayrollAuthorized } from '@/lib/payrollAccess'
import {
  calculatePayroll,
  PAYROLL_CATEGORY_LABELS,
  PAYROLL_CATEGORY_OPTIONS,
  type PayrollCalculationResult,
  type PayrollCategory,
  type ProfessionalPayrollInfo,
  type ProfessionalPayrollResult,
} from '@/lib/payrollCalculator'
import { downloadPayrollInvoice, type InvoicePeriod } from '@/lib/generatePayrollInvoiceDocx'

const inputClass =
  'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition duration-200 focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(value)
}

export default function DirectionPaiePage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [error, setError] = useState('')

  const [professionals, setProfessionals] = useState<ProfessionalPayrollInfo[]>([])
  const [savingProfessionalId, setSavingProfessionalId] = useState('')
  const [configMessage, setConfigMessage] = useState('')

  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [periodDue, setPeriodDue] = useState('')
  const [fileName, setFileName] = useState('')
  const [calculating, setCalculating] = useState(false)
  const [calculationError, setCalculationError] = useState('')
  const [result, setResult] = useState<PayrollCalculationResult | null>(null)
  const [downloadingId, setDownloadingId] = useState('')

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

      if (!isPayrollAuthorized({ email: user.email }, profile)) {
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

      const loadedProfessionals: ProfessionalPayrollInfo[] = (professionalsData ?? []).map(
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

      setProfessionals(loadedProfessionals)
      setLoading(false)
    }

    loadData()
  }, [router])

  const updateProfessionalField = async (
    professionalId: string,
    field: 'payroll_category' | 'professional_address',
    value: string
  ) => {
    setSavingProfessionalId(professionalId)
    setConfigMessage('')

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ [field]: value || null })
      .eq('id', professionalId)

    setSavingProfessionalId('')

    if (updateError) {
      setConfigMessage(updateError.message)
      return
    }

    setProfessionals((current) =>
      current.map((professional) =>
        professional.id === professionalId
          ? {
              ...professional,
              ...(field === 'payroll_category'
                ? { payrollCategory: (value || null) as PayrollCategory | null }
                : { professionalAddress: value || null }),
            }
          : professional
      )
    )
  }

  const handleCalculate = async () => {
    setCalculationError('')
    setResult(null)

    const file = fileInputRef.current?.files?.[0]

    if (!file) {
      setCalculationError('Veuillez sélectionner un fichier Excel.')
      return
    }

    if (!periodStart || !periodEnd || !periodDue) {
      setCalculationError('Veuillez indiquer la période et la date d’échéance.')
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

      const calculation = calculatePayroll(rows, professionals)
      setResult(calculation)
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

  const handleDownload = async (professionalResult: ProfessionalPayrollResult) => {
    const period: InvoicePeriod = {
      startDate: periodStart,
      endDate: periodEnd,
      dueDate: periodDue,
    }

    setDownloadingId(professionalResult.professional.id)

    try {
      await downloadPayrollInvoice(professionalResult, period)
    } finally {
      setDownloadingId('')
    }
  }

  if (loading) {
    return (
      <>
        <AppNav />
        <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
          <div className="mx-auto max-w-5xl">
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
        <div className="mx-auto max-w-5xl space-y-8">
          <PageHeader
            eyebrow="Direction"
            title="Paie des professionnels"
            description="Importez le fichier Excel des activités pour calculer la paie de chaque professionnel."
          />

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              {error}
            </div>
          )}

          <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
            <h2 className="text-base font-semibold text-[#332820]">Catégories de paie</h2>
            <p className="mt-1 text-sm text-[#7a6859]">
              À définir une fois par professionnel — détermine le pourcentage/taux appliqué
              lors du calcul. Visible seulement sur cette page.
            </p>

            {configMessage && (
              <p className="mt-3 text-sm text-red-700">{configMessage}</p>
            )}

            <div className="mt-4 space-y-3">
              {professionals.map((professional) => (
                <div
                  key={professional.id}
                  className="grid gap-3 rounded-xl border border-[#eadfd2] bg-white p-3 sm:grid-cols-[1fr_1fr_2fr]"
                >
                  <div className="text-sm font-medium text-[#332820]">
                    {professional.fullName}
                    {savingProfessionalId === professional.id && (
                      <span className="ml-2 text-xs font-normal text-[#8a5633]">
                        Sauvegarde...
                      </span>
                    )}
                  </div>
                  <select
                    value={professional.payrollCategory ?? ''}
                    onChange={(event) =>
                      updateProfessionalField(
                        professional.id,
                        'payroll_category',
                        event.target.value
                      )
                    }
                    className={inputClass}
                  >
                    <option value="">Catégorie non définie</option>
                    {PAYROLL_CATEGORY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {PAYROLL_CATEGORY_LABELS[option]}
                      </option>
                    ))}
                  </select>
                  <input
                    value={professional.professionalAddress ?? ''}
                    onChange={(event) =>
                      setProfessionals((current) =>
                        current.map((p) =>
                          p.id === professional.id
                            ? { ...p, professionalAddress: event.target.value }
                            : p
                        )
                      )
                    }
                    onBlur={(event) =>
                      updateProfessionalField(
                        professional.id,
                        'professional_address',
                        event.target.value
                      )
                    }
                    placeholder="Adresse postale (pour la facture)"
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
            <h2 className="text-base font-semibold text-[#332820]">Importer le fichier</h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
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
                Date d&apos;échéance
                <input
                  type="date"
                  value={periodDue}
                  onChange={(event) => setPeriodDue(event.target.value)}
                  className={`${inputClass} mt-2`}
                />
              </label>
            </div>

            <label className="mt-4 block text-sm font-medium text-[#5d4a3d]">
              Fichier Excel (&quot;Activités détaillées&quot;)
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? '')}
                className={`${inputClass} mt-2`}
              />
            </label>
            {fileName && (
              <p className="mt-2 text-xs text-[#8a6f5d]">Fichier sélectionné : {fileName}</p>
            )}

            {calculationError && (
              <p className="mt-3 text-sm text-red-700">{calculationError}</p>
            )}

            <button
              type="button"
              onClick={handleCalculate}
              disabled={calculating}
              className={`${buttonClass('primary')} mt-4`}
            >
              {calculating ? 'Calcul...' : 'Calculer'}
            </button>
          </section>

          {result && (
            <section className="space-y-4">
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

              {result.professionalResults.length === 0 ? (
                <EmptyState title="Aucun professionnel calculable dans ce fichier." />
              ) : (
                <div className="space-y-3">
                  {result.professionalResults.map((professionalResult) => (
                    <div
                      key={professionalResult.professional.id}
                      className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-4"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-[#332820]">
                            {professionalResult.professional.fullName}
                          </p>
                          <p className="text-xs text-[#8a6f5d]">
                            {professionalResult.professional.payrollCategory
                              ? PAYROLL_CATEGORY_LABELS[
                                  professionalResult.professional.payrollCategory
                                ]
                              : ''}{' '}
                            · {professionalResult.meetingCount} rencontre
                            {professionalResult.meetingCount > 1 ? 's' : ''}
                            {professionalResult.cancellationCount > 0 &&
                              ` · ${professionalResult.cancellationCount} annulation${
                                professionalResult.cancellationCount > 1 ? 's' : ''
                              }`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge tone="success">
                            {formatCurrency(professionalResult.grandTotal)}
                          </Badge>
                          <button
                            type="button"
                            onClick={() => handleDownload(professionalResult)}
                            disabled={downloadingId === professionalResult.professional.id}
                            className={buttonClass('secondary')}
                          >
                            {downloadingId === professionalResult.professional.id
                              ? 'Génération...'
                              : 'Télécharger la facture'}
                          </button>
                        </div>
                      </div>

                      <div className={`${inputClass} mt-3 overflow-x-auto bg-white`}>
                        <table className="w-full min-w-[500px] text-left text-sm">
                          <thead>
                            <tr className="text-xs uppercase text-[#8a6f5d]">
                              <th className="py-1 pr-2">Description</th>
                              <th className="py-1 pr-2">Heures</th>
                              <th className="py-1 pr-2">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {professionalResult.lineItems.map((item, index) => (
                              <tr key={index} className="border-t border-[#eadfd2]">
                                <td className="py-1 pr-2">{item.label}</td>
                                <td className="py-1 pr-2">{item.totalHours.toFixed(2)}</td>
                                <td className="py-1 pr-2">{formatCurrency(item.totalPay)}</td>
                              </tr>
                            ))}
                            {professionalResult.travelFeesTotal > 0 && (
                              <tr className="border-t border-[#eadfd2]">
                                <td className="py-1 pr-2">Frais de déplacement</td>
                                <td className="py-1 pr-2">-</td>
                                <td className="py-1 pr-2">
                                  {formatCurrency(professionalResult.travelFeesTotal)}
                                </td>
                              </tr>
                            )}
                            {professionalResult.cancellationCount > 0 && (
                              <tr className="border-t border-[#eadfd2]">
                                <td className="py-1 pr-2">Frais d&apos;annulation</td>
                                <td className="py-1 pr-2">
                                  {professionalResult.cancellationCount}
                                </td>
                                <td className="py-1 pr-2">
                                  {formatCurrency(professionalResult.cancellationFeesTotal)}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </>
  )
}
