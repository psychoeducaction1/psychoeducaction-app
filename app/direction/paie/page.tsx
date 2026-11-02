'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readSpreadsheetRows } from '@/lib/spreadsheetImport'
import { AppNav } from '@/components/AppNav'
import { Badge, buttonClass, EmptyState, PageHeader } from '@/components/ui/index'
import { supabase } from '@/lib/supabaseClient'
import { isPayrollAuthorized } from '@/lib/payrollAccess'
import {
  calculatePayroll,
  isPayrollDate,
  PAYROLL_CATEGORY_LABELS,
  PAYROLL_CATEGORY_OPTIONS,
  validatePayrollPeriod,
  type PayrollCalculationResult,
  type PayrollCategory,
  type ProfessionalPayrollInfo,
  type ProfessionalPayrollResult,
} from '@/lib/payrollCalculator'
import {
  buildPayrollInvoiceShortNumber,
  type InvoicePeriod,
} from '@/lib/generatePayrollInvoiceDocx'
import { formatPayrollQuantity } from '@/lib/payrollDecimal'
import type { PayrollInvoiceRecord } from '@/lib/payrollInvoiceRegistry'

const inputClass =
  'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition duration-200 focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd]'

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(value)
}

function formatDateFr(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function getFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || 'à vous'
}

function buildPayrollEmailMessage(
  professionalResult: ProfessionalPayrollResult,
  period: InvoicePeriod,
  invoiceNumber: string
): string {
  const firstName = getFirstName(professionalResult.professional.fullName)
  const invoiceShortNumber = buildPayrollInvoiceShortNumber(invoiceNumber)
  const paymentDate = formatDateFr(period.dueDate)

  return [
    `Bonjour ${firstName},`,
    '',
    "J'espère que tu vas bien.",
    '',
    `Tu trouveras ci-joint ta facture #${invoiceShortNumber}.`,
    '',
    `Merci de bien vouloir vérifier les informations, la signer puis me la renvoyer. Le paiement sera effectué le ${paymentDate}.`,
    '',
    'Merci et excellente fin de journée,',
    '',
    'Fatima Zahra Benlahcen, Agente administrative',
    'Clinique PsychoÉducAction',
    'T: (438) 500-1388',
    'C: psych.educ.action@outlook.com',
    'www.psychoeducaction.com',
  ].join('\n')
}

function displayedInvoiceResult(result: ProfessionalPayrollResult, record?: PayrollInvoiceRecord): ProfessionalPayrollResult {
  const invoice = record?.snapshot?.invoice
  if (!invoice) return result
  return { ...result, professional: { ...result.professional, ...invoice.professional }, invoiceIssues: [],
    lineItems: invoice.lineItems.map(i => ({ label: i.label, totalHours: i.quantity, totalPay: i.totalPay, unit: i.unit, amount: 0, rate: 0, isFlatRate: false })),
    cancellationLineItems: invoice.cancellationLineItems.map(i => ({ label: i.label, count: i.count, totalPay: i.totalPay, clientAmount: 0, rate: 0 })),
    meetingCount: invoice.lineItems.filter(i => i.unit !== 'h' && !i.label.startsWith('Rapport')).reduce((n, i) => n + i.quantity, 0),
    cancellationCount: invoice.cancellationCount, cancellationFeesTotal: invoice.cancellationFeesTotal,
    travelFeesTotal: invoice.travelFeesTotal, travelKilometersTotal: invoice.travelKilometersTotal, grandTotal: invoice.grandTotal,
  }
}

export default function DirectionPaiePage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const calculationSequence = useRef(0)
  const fileReadController = useRef<AbortController | null>(null)
  const sourceRows = useRef<unknown[][]>([])
  useEffect(() => () => { fileReadController.current?.abort(); calculationSequence.current++ }, [])

  const [sequences, setSequences] = useState<Record<string, string>>({})
  const [sequenceDrafts, setSequenceDrafts] = useState<Record<string, string>>({})
  useEffect(() => { void (async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const response = await fetch('/api/direction/payroll-invoices/sequence', { headers: { Authorization: 'Bearer ' + session.access_token } })
    if (response.ok) { const data = await response.json(); setSequences(Object.fromEntries(data.sequences.map((s: { professional_id: string; prefix: string; last_number: number }) => [s.professional_id, s.prefix + '-' + String(s.last_number).padStart(3, '0')]))) }
  })().catch(() => {}) }, [])
  const saveSequence = async (id: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Session expirée.')
      const response = await fetch('/api/direction/payroll-invoices/sequence', { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ professionalId: id, lastReference: sequenceDrafts[id] }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error)
      setSequences(current => ({ ...current, [id]: sequenceDrafts[id] })); setConfigMessage('Séquence confirmée.')
    } catch (error) { setConfigMessage(error instanceof Error ? error.message : 'Configuration impossible.') }
  }

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
  const [weeklyContextConfirmed, setWeeklyContextConfirmed] = useState(false)
  const [downloadingId, setDownloadingId] = useState('')
  const [sendingId, setSendingId] = useState('')
  const [invoiceMessage, setInvoiceMessage] = useState('')
  const [invoiceRecords, setInvoiceRecords] = useState<Record<string, PayrollInvoiceRecord>>({})
  const [invoiceNumbersByProfessionalId, setInvoiceNumbersByProfessionalId] = useState<
    Record<string, string>
  >({})

  useEffect(() => {
    if (!result?.period) return
    let canceled = false
    const period = result.period
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || canceled) return
      await Promise.all(result.professionalResults.map(async professional => {
        try {
          const response = await fetch(`/api/direction/payroll-invoices?professionalId=${professional.professional.id}&start=${period.startDate}&end=${period.endDate}`,
            { headers: { Authorization: `Bearer ${session.access_token}` } })
          const payload = await response.json()
          if (!canceled && response.ok && payload.record) setInvoiceRecords(current => ({ ...current, [professional.professional.id]: payload.record }))
        } catch { /* La génération signalera explicitement un registre indisponible. */ }
      }))
    })()
    return () => { canceled = true }
  }, [result])

  const invalidateCalculation = () => {
    fileReadController.current?.abort()
    calculationSequence.current += 1
    setResult(null)
    sourceRows.current = []
    setCalculating(false)
    setWeeklyContextConfirmed(false)
    setInvoiceMessage('')
    setInvoiceRecords({})
  }

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
    field: 'payroll_category' | 'professional_address' | 'professional_title',
    value: string
  ) => {
    invalidateCalculation()
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

    invalidateCalculation()
    setProfessionals((current) =>
      current.map((professional) =>
        professional.id === professionalId
          ? {
              ...professional,
              ...(field === 'payroll_category'
                ? { payrollCategory: (value || null) as PayrollCategory | null }
                : field === 'professional_title' ? { professionalTitle: value || null }
                : { professionalAddress: value || null }),
            }
          : professional
      )
    )
  }

  const handleCalculate = async () => {
    const sequence = ++calculationSequence.current
    setCalculationError('')
    setResult(null)
    setWeeklyContextConfirmed(false)

    const file = fileInputRef.current?.files?.[0]

    if (!file) {
      setCalculationError('Veuillez sélectionner un fichier Excel.')
      return
    }

    if (!periodStart || !periodEnd || !periodDue) {
      setCalculationError("Veuillez indiquer la période et la date d'échéance.")
      return
    }

    const selectedPeriod = { startDate: periodStart, endDate: periodEnd }
    try {
      validatePayrollPeriod(selectedPeriod)
      if (!isPayrollDate(periodDue)) throw new Error('La date d’échéance doit être valide.')
    } catch (caughtError) {
      setCalculationError(caughtError instanceof Error ? caughtError.message : 'Période invalide.')
      return
    }

    setCalculating(true)
    fileReadController.current?.abort()
    const controller = new AbortController()
    fileReadController.current = controller

    try {
      const rows = await readSpreadsheetRows(file, { raw: false }, controller.signal)

      const calculation = calculatePayroll(rows, professionals, selectedPeriod)
      if (sequence === calculationSequence.current) { sourceRows.current = rows; setResult(calculation) }
    } catch (caughtError) {
      if (sequence === calculationSequence.current) setCalculationError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Erreur inconnue pendant la lecture du fichier.'
      )
    } finally {
      if (sequence === calculationSequence.current) setCalculating(false)
    }
  }

  const prepareInvoice = async (professionalResult: ProfessionalPayrollResult, action = 'prepare') => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Session expirée.')
    if (action === 'prepare' && invoiceRecords[professionalResult.professional.id]) return { record: invoiceRecords[professionalResult.professional.id], token: session.access_token }
    if (!professionalResult.period) throw new Error('Recalculez la paie.')
    const body: Record<string, unknown> = { professionalId: professionalResult.professional.id,
      period: { ...professionalResult.period, dueDate: periodDue }, action,
      rows: action === 'import' ? undefined : sourceRows.current, weeklyContextConfirmed }
    body.legacyNumber = invoiceNumbersByProfessionalId[professionalResult.professional.id]?.trim() || undefined
    if (action === 'revise') {
      const reason = window.prompt('Motif du rectificatif (10 caractères minimum). La facture courante sera remplacée, sans reprise de signature.')
      if (!reason) throw new Error('Rectificatif annulé.')
      body.reason = reason
      body.expectedVersion = Number(window.prompt('Version actuelle à corriger', String(invoiceRecords[professionalResult.professional.id]?.version ?? 1)))
    }
    const response = await fetch('/api/direction/payroll-invoices', { method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error ?? 'Enregistrement impossible.')
    const record = payload.record as PayrollInvoiceRecord
    setInvoiceRecords(current => ({ ...current, [professionalResult.professional.id]: record }))
    return { record, token: session.access_token }
  }

  const downloadVersion = async (record: PayrollInvoiceRecord, token: string, version = record.version) => {
    const response = await fetch(`/api/direction/payroll-invoices?id=${record.id}&version=${version}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error('Téléchargement de la version archivée impossible.')
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    const disposition = response.headers.get('content-disposition') ?? ''
    link.download = decodeURIComponent(disposition.split("filename*=UTF-8''")[1] ?? `Facture-${record.id}-v${version}.docx`)
    link.href = url; link.click(); URL.revokeObjectURL(url)
  }

  const openEditor = async (professionalResult: ProfessionalPayrollResult) => {
    setInvoiceMessage('')
    try {
      let record = invoiceRecords[professionalResult.professional.id] ?? (await prepareInvoice(professionalResult)).record
      if (!record.snapshot) record = (await prepareInvoice(professionalResult, 'revise')).record
      router.push('/direction/paie/rectifier?id=' + record.id)
    } catch (error) { setInvoiceMessage(error instanceof Error ? error.message : 'Ouverture impossible.') }
  }

  const handleDownload = async (professionalResult: ProfessionalPayrollResult, action = 'prepare') => {
    setInvoiceMessage('')

    if (!professionalResult.period || (professionalResult.requiresWeeklyReview && !weeklyContextConfirmed)) {
      setInvoiceMessage('Recalculez la période et vérifiez les semaines complètes avant d’émettre une facture.')
      return
    }
    setDownloadingId(professionalResult.professional.id)

    try {
      const { record, token } = await prepareInvoice(professionalResult, action)
      await downloadVersion(record, token)
      setInvoiceMessage(`${record.number} — version ${record.version} conservée sous l’identifiant ${record.id}.`)
    } catch (caughtError) {
      setInvoiceMessage(caughtError instanceof Error ? caughtError.message : 'La facture n’a pas pu être générée.')
    } finally {
      setDownloadingId('')
    }
  }

  const handleSendInvoice = async (professionalResult: ProfessionalPayrollResult) => {
    setInvoiceMessage('')

    if (!professionalResult.period || (professionalResult.requiresWeeklyReview && !weeklyContextConfirmed)) {
      setInvoiceMessage('Recalculez la période et vérifiez les semaines complètes avant d’émettre une facture.')
      return
    }

    const recipientEmail = professionalResult.professional.email?.trim()

    if (!recipientEmail) {
      setInvoiceMessage(
        `Impossible d'envoyer la facture à ${professionalResult.professional.fullName} : aucun courriel professionnel n'est configuré.`
      )
      return
    }

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      router.push('/login')
      return
    }

    const period: InvoicePeriod = {
      ...professionalResult.period,
      dueDate: periodDue,
    }
    setSendingId(professionalResult.professional.id)

    try {
      const { record } = await prepareInvoice(professionalResult)
      const subject = `Facture ${record.number} — version ${record.version} - Clinique PsychoÉducAction`
      const message = buildPayrollEmailMessage(professionalResult, period, `${record.number} — version ${record.version}`)
      const response = await fetch('/api/direction/payroll-invoice-email', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: recipientEmail,
          subject,
          message,
          invoiceId: record.id,
          version: record.version,
          professionalId: professionalResult.professional.id,
          professionalName: professionalResult.professional.fullName,
          invoiceNumber: record.number,
          paymentDate: period.dueDate,
        }),
      })
      const responseBody = (await response.json().catch(() => ({}))) as {
        error?: string
      }

      if (!response.ok) {
        throw new Error(responseBody.error ?? "Erreur pendant l'envoi de la facture.")
      }

      setInvoiceMessage(
        `Facture envoyée à ${professionalResult.professional.fullName} (${recipientEmail}).`
      )
    } catch (caughtError) {
      setInvoiceMessage(
        caughtError instanceof Error
          ? caughtError.message
          : "Erreur inconnue pendant l'envoi de la facture."
      )
    } finally {
      setSendingId('')
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
              À définir une fois par professionnel - détermine le pourcentage/taux appliqué lors
              du calcul. Visible seulement sur cette page.
            </p>

            {configMessage && <p className="mt-3 text-sm text-red-700">{configMessage}</p>}

            <div className="mt-4 space-y-3">
              {professionals.map((professional) => (
                <div
                  key={professional.id}
                  className="grid gap-3 rounded-xl border border-[#eadfd2] bg-white p-3 sm:grid-cols-[1fr_1fr_2fr]"
                >
                  <div className="text-sm font-medium text-[#332820]">
                    {professional.fullName}
                    <div className="mt-2 text-xs font-normal">{sequences[professional.id] ? 'Dernier numéro de la séquence : ' + sequences[professional.id] : <>
                      <label>Dernière référence envoyée<input className={inputClass} placeholder="PEA-ABC-009" value={sequenceDrafts[professional.id] ?? ''} onChange={e => setSequenceDrafts(current => ({ ...current, [professional.id]: e.target.value }))} /></label>
                      <p>Première facture : utiliser un préfixe unique et terminer par 000.</p>
                      <button type="button" className="underline" onClick={() => void saveSequence(professional.id)}>Confirmer la séquence</button>
                    </>}</div>
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
                    aria-label={`Titre professionnel de ${professional.fullName}`}
                    value={professional.professionalTitle ?? ''}
                    onChange={(event) => { invalidateCalculation(); setProfessionals(current => current.map(p => p.id === professional.id ? { ...p, professionalTitle: event.target.value } : p)) }}
                    onBlur={(event) => void updateProfessionalField(professional.id, 'professional_title', event.target.value)}
                    placeholder="Titre professionnel (repris tel quel sur la facture)"
                    className={inputClass}
                  />
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
                  onChange={(event) => { setPeriodStart(event.target.value); invalidateCalculation() }}
                  className={`${inputClass} mt-2`}
                />
              </label>
              <label className="block text-sm font-medium text-[#5d4a3d]">
                Fin de la période
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(event) => { setPeriodEnd(event.target.value); invalidateCalculation() }}
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
                onChange={(event) => { setFileName(event.target.files?.[0]?.name ?? ''); invalidateCalculation() }}
                className={`${inputClass} mt-2`}
              />
            </label>
            {fileName && (
              <p className="mt-2 text-xs text-[#8a6f5d]">Fichier sélectionné : {fileName}</p>
            )}

            {calculationError && <p className="mt-3 text-sm text-red-700">{calculationError}</p>}

            <button
              type="button"
              onClick={handleCalculate}
              disabled={calculating || Boolean(savingProfessionalId)}
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

              {result.requiresWeeklyReview && result.professionalResults.length > 0 && (
                <label className="flex items-start gap-3 rounded-xl border border-[#ead2bd] bg-[#fffdf9] p-4 text-sm text-[#5d4a3d]">
                  <input type="checkbox" checked={weeklyContextConfirmed} onChange={(event) => setWeeklyContextConfirmed(event.target.checked)} className="mt-1" />
                  J’ai vérifié que l’export contient toutes les rencontres des semaines concernées pour appliquer le bon seuil hebdomadaire. Seules les dates sélectionnées seront payées.
                </label>
              )}

              {invoiceMessage && (
                <div className="rounded-2xl border border-[#ead2bd] bg-[#fbf1e7] p-4 text-sm text-[#8a5633]">
                  {invoiceMessage}
                </div>
              )}

              {result.professionalResults.length === 0 ? (
                <EmptyState title="Aucun professionnel calculable dans ce fichier." />
              ) : (
                <div className="space-y-3">
                  {result.professionalResults.map(calculated => displayedInvoiceResult(calculated, invoiceRecords[calculated.professional.id])).map((professionalResult) => (
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
                            - {professionalResult.meetingCount} rencontre
                            {professionalResult.meetingCount > 1 ? 's' : ''}
                            {professionalResult.cancellationCount > 0 &&
                              ` - ${professionalResult.cancellationCount} annulation${
                                professionalResult.cancellationCount > 1 ? 's' : ''
                              }`}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                          <details className="text-xs"><summary>Ancienne facture non enregistrée</summary><label className="flex items-center gap-2 text-xs font-medium text-[#5d4a3d]">
                            Référence déjà émise (anciennes périodes seulement)
                            <input
                              value={
                                invoiceNumbersByProfessionalId[
                                  professionalResult.professional.id
                                ] ?? ''
                              }
                              onChange={(event) =>
                                setInvoiceNumbersByProfessionalId((current) => ({
                                  ...current,
                                  [professionalResult.professional.id]: event.target.value,
                                }))
                              }
                              placeholder="PEA-AG-021"
                              className={inputClass}
                            />
                          </label></details>
                          <button type="button" className={buttonClass('secondary')} disabled={Boolean(downloadingId)}
                            onClick={() => void openEditor(professionalResult)}>Rectifier la facture</button>
                          {invoiceRecords[professionalResult.professional.id] && <span className="text-xs">{invoiceRecords[professionalResult.professional.id].number}</span>}
                          <Badge tone="success">
                            {professionalResult.invoiceIssues?.some(i => i.includes('catégorie')) ? 'Calcul incomplet' : formatCurrency(professionalResult.grandTotal)}
                          </Badge>
                          <button
                            type="button"
                            onClick={() => handleDownload(professionalResult)}
                            disabled={downloadingId === professionalResult.professional.id || Boolean(professionalResult.invoiceIssues?.length) || Boolean(result.requiresWeeklyReview && !weeklyContextConfirmed)}
                            className={buttonClass('secondary')}
                          >
                            {downloadingId === professionalResult.professional.id
                              ? 'Génération...'
                              : 'Télécharger la facture'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendInvoice(professionalResult)}
                            disabled={sendingId === professionalResult.professional.id || Boolean(professionalResult.invoiceIssues?.length) || Boolean(result.requiresWeeklyReview && !weeklyContextConfirmed)}
                            className={buttonClass('primary')}
                          >
                            {sendingId === professionalResult.professional.id
                              ? 'Envoi...'
                              : 'Envoyer la facture'}
                          </button>
                        </div>
                      </div>

                      {invoiceRecords[professionalResult.professional.id]?.snapshot && <p className="mt-2 text-xs text-[#8a6f5d]">Facture enregistrée : les postes ci-dessous correspondent au document téléchargeable. Utilisez « Rectifier la facture » pour les modifier.</p>}
                      {professionalResult.invoiceIssues?.map(issue => <p key={issue} className="mt-2 text-sm text-red-700">{issue}</p>)}

                      <div className={`${inputClass} mt-3 overflow-x-auto bg-white`}>
                        <table className="w-full min-w-[500px] text-left text-sm">
                          <thead>
                            <tr className="text-xs uppercase text-[#8a6f5d]">
                              <th className="py-1 pr-2">Description</th>
                              <th className="py-1 pr-2">Heures / quantité</th>
                              <th className="py-1 pr-2">Prix unitaire (CAD)</th>
                              <th className="py-1 pr-2">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {professionalResult.lineItems.map((item, index) => (
                              <tr key={index} className="border-t border-[#eadfd2]">
                                <td className="py-1 pr-2">{item.label}</td>
                                <td className="py-1 pr-2">{item.totalHours > 0 ? formatPayrollQuantity(item.totalHours, item.unit) : 'À confirmer'}{item.sourceRows?.length ? ` — lignes ${item.sourceRows.join(', ')}` : ''}</td>
                                <td className="py-1 pr-2">{item.totalHours > 0 ? new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 6 }).format(item.totalPay / item.totalHours) : 'À confirmer'}</td>
                                <td className="py-1 pr-2">{formatCurrency(item.totalPay)}</td>
                              </tr>
                            ))}
                            {professionalResult.travelFeesTotal > 0 && (
                              <tr className="border-t border-[#eadfd2]">
                                <td className="py-1 pr-2">Frais de déplacement</td>
                                <td className="py-1 pr-2">
                                  {formatPayrollQuantity(professionalResult.travelKilometersTotal, 'km')}
                                </td>
                                <td className="py-1 pr-2">0,64 $</td>
                                <td className="py-1 pr-2">
                                  {formatCurrency(professionalResult.travelFeesTotal)}
                                </td>
                              </tr>
                            )}
                            {professionalResult.cancellationCount > 0 && (
                              professionalResult.cancellationLineItems.map((item, index) => (
                                <tr
                                  key={index}
                                  className="border-t border-[#eadfd2]"
                                >
                                  <td className="py-1 pr-2">{item.label}</td>
                                  <td className="py-1 pr-2">{item.count}</td>
                                  <td className="py-1 pr-2">{formatCurrency(item.totalPay / item.count)}</td>
                                  <td className="py-1 pr-2">
                                    {formatCurrency(item.totalPay)}
                                  </td>
                                </tr>
                              ))
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
