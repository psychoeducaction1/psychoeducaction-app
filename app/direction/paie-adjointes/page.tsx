'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  administrativeEntryTypeLabels,
  administrativeEntryTypeOptions,
  buildDefaultTimeEntry,
  buildPayrollRow,
  calculateHoursBetween,
  getDatesInRange,
  getMonthDateRange,
  getMonthKey,
  getPlannedHours,
  roundMoney,
  type AdministrativeEntryType,
  type AdministrativePayrollRow,
  type AdministrativeStaff,
  type AdministrativeTimeEntry,
  type MoroccoHoliday,
} from '@/lib/administrativePayroll'
import { isSuperAdmin } from '@/lib/superAdmin'
import { supabase } from '@/lib/supabaseClient'

const inputClass =
  'w-full rounded-xl border border-[#dfd0bf] bg-white px-3 py-2 text-sm text-[#332820] shadow-sm outline-none transition focus:border-[#c98b52] focus:ring-2 focus:ring-[#ead2bd] disabled:cursor-wait disabled:bg-[#f7efe7] disabled:text-[#8a6f5d]'

type StaffRow = {
  id: string
  profile_id: string | null
  full_name: string
  email: string | null
  hourly_rate: number | string
  monthly_salary: number | string | null
  vacation_days_per_year: number | string
  default_schedule: unknown
}

type TimeEntryRow = {
  id: string
  staff_id: string
  work_date: string
  start_time: string | null
  end_time: string | null
  break_minutes: number | null
  entry_type: AdministrativeEntryType
  hours: number | null
  note: string | null
}

function normalizeSchedule(value: unknown): AdministrativeStaff['default_schedule'] {
  if (!Array.isArray(value)) return null

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const schedule = item as Record<string, unknown>
      const weekday = Number(schedule.weekday)
      const startTime = String(schedule.startTime ?? schedule.start_time ?? '')
      const endTime = String(schedule.endTime ?? schedule.end_time ?? '')

      if (!Number.isFinite(weekday) || !startTime || !endTime) return null

      return { weekday, startTime, endTime }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

function normalizeStaff(row: StaffRow): AdministrativeStaff {
  return {
    id: row.id,
    profile_id: row.profile_id,
    full_name: row.full_name,
    email: row.email,
    hourly_rate: Number(row.hourly_rate ?? 0),
    monthly_salary:
      row.monthly_salary === null || row.monthly_salary === undefined
        ? null
        : Number(row.monthly_salary),
    vacation_days_per_year: Number(row.vacation_days_per_year ?? 0),
    default_schedule: normalizeSchedule(row.default_schedule),
  }
}

function formatCurrencyDh(value: number): string {
  return new Intl.NumberFormat('fr-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' DH'
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('fr-CA', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(date)
}

function getEntryKey(staffId: string, dateValue: string): string {
  return `${staffId}:${dateValue}`
}

function isStaffUser(
  staff: AdministrativeStaff[],
  user: { id: string; email?: string | null }
): boolean {
  const userEmail = user.email?.trim().toLowerCase() ?? ''
  return staff.some(
    (staffMember) =>
      staffMember.profile_id === user.id ||
      staffMember.email?.trim().toLowerCase() === userEmail
  )
}

export default function DirectionAdministrativePayrollPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [monthKey, setMonthKey] = useState(getMonthKey())
  const [staff, setStaff] = useState<AdministrativeStaff[]>([])
  const [holidays, setHolidays] = useState<MoroccoHoliday[]>([])
  const [entriesByKey, setEntriesByKey] = useState<
    Record<string, AdministrativeTimeEntry>
  >({})
  const [canEditAll, setCanEditAll] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentUserEmail, setCurrentUserEmail] = useState('')

  const loadData = useCallback(async () => {
    await Promise.resolve()

    setLoading(true)
    setError('')
    setMessage('')

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
      .select('role, full_name, email')
      .eq('id', user.id)
      .limit(1)
      .maybeSingle()

    if (profileError) {
      setError(profileError.message)
      setLoading(false)
      return
    }

    const { startDate, endDate } = getMonthDateRange(monthKey)

    const { data: staffData, error: staffError } = await supabase
      .from('administrative_staff')
      .select(
        'id, profile_id, full_name, email, hourly_rate, monthly_salary, vacation_days_per_year, default_schedule'
      )
      .eq('is_active', true)
      .order('full_name')

    if (staffError) {
      setError(staffError.message)
      setLoading(false)
      return
    }

    const normalizedStaff = ((staffData ?? []) as StaffRow[]).map(normalizeStaff)
    const isDirection = profile?.role === 'direction'
    const isAllowedStaff = isStaffUser(normalizedStaff, user)

    if (!isDirection && !isAllowedStaff) {
      router.push('/')
      return
    }

    const visibleStaff = isDirection
      ? normalizedStaff
      : normalizedStaff.filter(
          (staffMember) =>
            staffMember.profile_id === user.id ||
            staffMember.email?.trim().toLowerCase() ===
              user.email?.trim().toLowerCase()
        )

    const staffIds = visibleStaff.map((staffMember) => staffMember.id)

    const [holidayResponse, entryResponse] = await Promise.all([
      supabase
        .from('morocco_holidays')
        .select('holiday_date, name')
        .gte('holiday_date', startDate)
        .lte('holiday_date', endDate)
        .order('holiday_date'),
      staffIds.length > 0
        ? supabase
            .from('administrative_time_entries')
            .select(
              'id, staff_id, work_date, start_time, end_time, break_minutes, entry_type, hours, note'
            )
            .in('staff_id', staffIds)
            .gte('work_date', startDate)
            .lte('work_date', endDate)
            .order('work_date')
        : Promise.resolve({ data: [], error: null }),
    ])

    if (holidayResponse.error) {
      setError(holidayResponse.error.message)
      setLoading(false)
      return
    }

    if (entryResponse.error) {
      setError(entryResponse.error.message)
      setLoading(false)
      return
    }

    setStaff(visibleStaff)
    setHolidays((holidayResponse.data ?? []) as MoroccoHoliday[])
    setEntriesByKey(
      Object.fromEntries(
        ((entryResponse.data ?? []) as TimeEntryRow[]).map((entry) => [
          getEntryKey(entry.staff_id, entry.work_date),
          entry,
        ])
      )
    )
    setCanEditAll(isSuperAdmin({ email: user.email }, profile) || isDirection)
    setCurrentUserId(user.id)
    setCurrentUserEmail(user.email ?? '')
    setLoading(false)
  }, [monthKey, router])

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(loadTimer)
  }, [loadData])

  const holidaysByDate = useMemo(
    () =>
      new Map(
        holidays.map((holiday) => [holiday.holiday_date, holiday.name] as const)
      ),
    [holidays]
  )

  const monthlyPlannedHoursByStaffId = useMemo(() => {
    const { startDate, endDate } = getMonthDateRange(monthKey)
    const dates = getDatesInRange(startDate, endDate)
    const plannedHoursByStaff = new Map<string, number>()

    staff.forEach((staffMember) => {
      plannedHoursByStaff.set(
        staffMember.id,
        dates.reduce(
          (sum, dateValue) => sum + getPlannedHours(staffMember, dateValue),
          0
        )
      )
    })

    return plannedHoursByStaff
  }, [monthKey, staff])

  const effectiveHourlyRateByStaffId = useMemo(() => {
    const rates = new Map<string, number>()

    staff.forEach((staffMember) => {
      const monthlySalary = Number(staffMember.monthly_salary ?? 0)
      const monthlyPlannedHours =
        monthlyPlannedHoursByStaffId.get(staffMember.id) ?? 0

      rates.set(
        staffMember.id,
        monthlySalary > 0 && monthlyPlannedHours > 0
          ? monthlySalary / monthlyPlannedHours
          : Number(staffMember.hourly_rate ?? 0)
      )
    })

    return rates
  }, [monthlyPlannedHoursByStaffId, staff])

  const payrollRows = useMemo(() => {
    const { startDate, endDate } = getMonthDateRange(monthKey)
    const dates = getDatesInRange(startDate, endDate)
    const rows: AdministrativePayrollRow[] = []

    staff.forEach((staffMember) => {
      dates.forEach((dateValue) => {
        const holidayName = holidaysByDate.get(dateValue) ?? null
        const plannedHours = getPlannedHours(staffMember, dateValue)
        const existingEntry =
          entriesByKey[getEntryKey(staffMember.id, dateValue)] ?? null

        if (!existingEntry && plannedHours <= 0 && !holidayName) return

        const entry =
          existingEntry ??
          buildDefaultTimeEntry({
            staff: staffMember,
            dateValue,
            holidayName,
          })

        rows.push(
          buildPayrollRow({
            staff: staffMember,
            entry,
            holidayName,
            hourlyRateOverride: effectiveHourlyRateByStaffId.get(staffMember.id),
          })
        )
      })
    })

    return rows
  }, [effectiveHourlyRateByStaffId, entriesByKey, holidaysByDate, monthKey, staff])

  const totals = useMemo(() => {
    const byStaff = new Map<
      string,
      {
        staff: AdministrativeStaff
        plannedHours: number
        workedHours: number
        payableHours: number
        amount: number
        vacationDaysUsed: number
        holidaysWorked: number
      }
    >()

    payrollRows.forEach((row) => {
      const current =
        byStaff.get(row.staff.id) ??
        {
          staff: row.staff,
          plannedHours: 0,
          workedHours: 0,
          payableHours: 0,
          amount: 0,
          vacationDaysUsed: 0,
          holidaysWorked: 0,
        }

      current.plannedHours += row.plannedHours
      current.workedHours += Number(row.hours ?? 0)
      current.payableHours += row.payableHours
      current.amount += row.amount
      current.vacationDaysUsed += row.entry_type === 'vacation_paid' ? 1 : 0
      current.holidaysWorked += row.entry_type === 'holiday_worked' ? 1 : 0
      byStaff.set(row.staff.id, current)
    })

    return Array.from(byStaff.values()).map((total) => ({
      ...total,
      amount: roundMoney(total.amount),
      vacationDaysRemaining: Math.max(
        Number(total.staff.vacation_days_per_year ?? 0) -
          total.vacationDaysUsed,
        0
      ),
    }))
  }, [payrollRows])

  const grandTotal = totals.reduce((sum, total) => sum + total.amount, 0)
  const grandPayableHours = totals.reduce(
    (sum, total) => sum + total.payableHours,
    0
  )
  const vacationDaysUsed = totals.reduce(
    (sum, total) => sum + total.vacationDaysUsed,
    0
  )
  const payrollRowsByStaff = totals.map((total) => ({
    total,
    rows: payrollRows.filter((row) => row.staff_id === total.staff.id),
  }))

  const updateEntry = (
    row: AdministrativePayrollRow,
    changes: Partial<AdministrativeTimeEntry>
  ) => {
    const nextEntry = {
      staff_id: row.staff_id,
      work_date: row.work_date,
      start_time: row.start_time,
      end_time: row.end_time,
      break_minutes: row.break_minutes ?? 0,
      entry_type: row.entry_type,
      hours: row.hours,
      note: row.note,
      id: row.id,
      ...changes,
    }

    if (
      'start_time' in changes ||
      'end_time' in changes ||
      'break_minutes' in changes
    ) {
      nextEntry.hours = calculateHoursBetween(
        nextEntry.start_time,
        nextEntry.end_time,
        Number(nextEntry.break_minutes ?? 0)
      )
    }

    if (changes.entry_type === 'unpaid_absence') {
      nextEntry.hours = 0
    }

    if (
      changes.entry_type === 'holiday_paid' ||
      changes.entry_type === 'vacation_paid'
    ) {
      nextEntry.hours = row.plannedHours
    }

    setEntriesByKey((currentEntries) => ({
      ...currentEntries,
      [getEntryKey(row.staff_id, row.work_date)]: nextEntry,
    }))
  }

  const canEditRow = (row: AdministrativePayrollRow) => {
    if (canEditAll) return true
    return (
      row.staff.profile_id === currentUserId ||
      row.staff.email?.trim().toLowerCase() === currentUserEmail.toLowerCase()
    )
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    setError('')

    const entriesToSave = payrollRows.map((row) => ({
      staff_id: row.staff_id,
      work_date: row.work_date,
      start_time: row.start_time,
      end_time: row.end_time,
      break_minutes: row.break_minutes ?? 0,
      entry_type: row.entry_type,
      hours: row.hours ?? 0,
      note: row.note?.trim() || null,
      updated_by: currentUserId || null,
    }))

    const { error: saveError } = await supabase
      .from('administrative_time_entries')
      .upsert(entriesToSave, {
        onConflict: 'staff_id,work_date',
      })

    if (saveError) {
      setError(saveError.message)
      setSaving(false)
      return
    }

    setMessage('Paie administrative sauvegardée.')
    setSaving(false)
    await loadData()
  }

  const renderPayrollTable = (rows: AdministrativePayrollRow[]) => (
    <div className={`${tableShellClass} mt-4`}>
      <table className={`${tableClass} min-w-[1080px]`}>
        <thead className={tableHeaderClass}>
          <tr>
            <th className={tableHeadCellClass}>Date</th>
            <th className={tableHeadCellClass}>Statut</th>
            <th className={tableHeadCellClass}>Début</th>
            <th className={tableHeadCellClass}>Fin</th>
            <th className={tableHeadCellClass}>Heures</th>
            <th className={tableHeadCellClass}>Férié</th>
            <th className={tableHeadCellClass}>Payable</th>
            <th className={tableHeadCellClass}>Montant</th>
            <th className={tableHeadCellClass}>Note</th>
          </tr>
        </thead>
        <tbody className={tableBodyClass}>
          {rows.map((row) => {
            const editable = canEditRow(row)

            return (
              <tr
                key={getEntryKey(row.staff_id, row.work_date)}
                className={tableRowClass}
              >
                <td className={tableCellClass}>
                  <span className="font-medium text-[#332820]">
                    {formatDate(row.work_date)}
                  </span>
                </td>
                <td className={tableCellClass}>
                  <select
                    value={row.entry_type}
                    disabled={!editable}
                    onChange={(event) =>
                      updateEntry(row, {
                        entry_type: event.target.value as AdministrativeEntryType,
                      })
                    }
                    className={inputClass}
                  >
                    {administrativeEntryTypeOptions.map((type) => (
                      <option key={type} value={type}>
                        {administrativeEntryTypeLabels[type]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={tableCellClass}>
                  <input
                    type="time"
                    value={row.start_time ?? ''}
                    disabled={!editable}
                    onChange={(event) =>
                      updateEntry(row, {
                        start_time: event.target.value || null,
                      })
                    }
                    className={inputClass}
                  />
                </td>
                <td className={tableCellClass}>
                  <input
                    type="time"
                    value={row.end_time ?? ''}
                    disabled={!editable}
                    onChange={(event) =>
                      updateEntry(row, {
                        end_time: event.target.value || null,
                      })
                    }
                    className={inputClass}
                  />
                </td>
                <td className={tableCellClass}>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={row.hours ?? 0}
                    disabled={!editable}
                    onChange={(event) =>
                      updateEntry(row, {
                        hours: Number(event.target.value),
                      })
                    }
                    className={inputClass}
                  />
                </td>
                <td className={tableCellClass}>
                  {row.holidayName ? (
                    <Badge tone="warning">{row.holidayName}</Badge>
                  ) : (
                    '-'
                  )}
                </td>
                <td className={tableCellClass}>
                  {row.payableHours.toFixed(2)} h
                </td>
                <td className={tableCellClass}>
                  <span className="font-semibold text-[#332820]">
                    {formatCurrencyDh(row.amount)}
                  </span>
                </td>
                <td className={tableCellClass}>
                  <input
                    type="text"
                    value={row.note ?? ''}
                    disabled={!editable}
                    onChange={(event) =>
                      updateEntry(row, {
                        note: event.target.value,
                      })
                    }
                    placeholder="Note interne"
                    className={inputClass}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-4 py-8 sm:px-6 lg:ml-72 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Direction"
            title="Paie des adjointes"
            description="Génération mensuelle des heures, fériés marocains, congés payés et montants en dirhams."
            actions={
              <button
                type="button"
                onClick={handleSave}
                disabled={loading || saving || payrollRows.length === 0}
                className={buttonClass('primary')}
              >
                {saving ? 'Sauvegarde...' : 'Sauvegarder le mois'}
              </button>
            }
          />

          {loading && (
            <div className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 text-sm text-[#7a6859]">
              Chargement...
            </div>
          )}

          {!loading && error && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && message && (
            <div className="mb-4 rounded-2xl border border-[#d8e2c7] bg-[#f6faef] p-5 text-sm text-[#3f4f2d]">
              {message}
            </div>
          )}

          {!loading && (
            <div className="space-y-6">
              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <div className="grid gap-4 md:grid-cols-[240px_1fr] md:items-end">
                  <label className="block text-sm font-medium text-[#5d4a3d]">
                    Mois de paie
                    <input
                      type="month"
                      value={monthKey}
                      onChange={(event) => setMonthKey(event.target.value)}
                      className={`${inputClass} mt-2`}
                    />
                  </label>
                  <p className="text-sm leading-6 text-[#7a6859]">
                    Les horaires sont générés automatiquement. Les jours fériés
                    inscrits au calendrier du Maroc sont payés selon le statut
                    choisi.
                  </p>
                </div>
              </section>

              <div className="grid gap-4 md:grid-cols-3">
                <StatCard
                  label="Total à payer"
                  value={formatCurrencyDh(grandTotal)}
                  helper="Montant brut calculé"
                  priority="high"
                />
                <StatCard
                  label="Heures payables"
                  value={grandPayableHours.toFixed(2)}
                  helper="Inclut les fériés travaillés à double"
                />
                <StatCard
                  label="Congés utilisés"
                  value={vacationDaysUsed}
                  helper="Jours de vacances payées dans le mois"
                />
              </div>

              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <h2 className="text-lg font-semibold text-[#332820]">
                  Résumé par adjointe
                </h2>
                {totals.length === 0 ? (
                  <div className="mt-4">
                    <EmptyState title="Aucune adjointe administrative configurée." />
                  </div>
                ) : (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {totals.map((total) => (
                      <article
                        key={total.staff.id}
                        className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h3 className="text-base font-semibold text-[#332820]">
                              {total.staff.full_name}
                            </h3>
                            <p className="mt-1 text-sm text-[#7a6859]">
                              {formatCurrencyDh(Number(total.staff.hourly_rate))}/h
                            </p>
                          </div>
                          <Badge tone="success">
                            {formatCurrencyDh(total.amount)}
                          </Badge>
                        </div>
                        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                          <div>
                            <dt className="font-medium text-[#8a6f5d]">
                              Heures payables
                            </dt>
                            <dd className="mt-1 text-[#332820]">
                              {total.payableHours.toFixed(2)}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium text-[#8a6f5d]">
                              Jours fériés travaillés
                            </dt>
                            <dd className="mt-1 text-[#332820]">
                              {total.holidaysWorked}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium text-[#8a6f5d]">
                              Vacances utilisées
                            </dt>
                            <dd className="mt-1 text-[#332820]">
                              {total.vacationDaysUsed} /{' '}
                              {total.staff.vacation_days_per_year}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium text-[#8a6f5d]">
                              Vacances restantes
                            </dt>
                            <dd className="mt-1 text-[#332820]">
                              {total.vacationDaysRemaining}
                            </dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-[#eadfd2] bg-[#fffdf9] p-5 shadow-[0_1px_2px_rgba(72,49,30,0.05)]">
                <h2 className="text-lg font-semibold text-[#332820]">
                  Feuilles de temps mensuelles
                </h2>
                {payrollRows.length === 0 ? (
                  <div className="mt-4">
                    <EmptyState title="Aucune ligne à afficher pour ce mois." />
                  </div>
                ) : (
                  <div className="mt-4 space-y-5">
                    {payrollRowsByStaff.map(({ total, rows }) => (
                      <article
                        key={total.staff.id}
                        className="rounded-2xl border border-[#eadfd2] bg-[#fbf6ef] p-4"
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <h3 className="text-base font-semibold text-[#332820]">
                              {total.staff.full_name}
                            </h3>
                            <p className="mt-1 text-sm text-[#7a6859]">
                              {rows.length} journée{rows.length > 1 ? 's' : ''}{' '}
                              affichée{rows.length > 1 ? 's' : ''}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge tone="success">
                              {formatCurrencyDh(total.amount)}
                            </Badge>
                            <Badge tone="neutral">
                              {total.payableHours.toFixed(2)} h payables
                            </Badge>
                            <Badge tone="warning">
                              {total.vacationDaysUsed} congé
                              {total.vacationDaysUsed > 1 ? 's' : ''}
                            </Badge>
                          </div>
                        </div>
                        {renderPayrollTable(rows)}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
