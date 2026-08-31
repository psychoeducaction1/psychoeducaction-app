export type AdministrativeEntryType =
  | 'normal'
  | 'holiday_paid'
  | 'holiday_worked'
  | 'vacation_paid'
  | 'unpaid_absence'
  | 'custom'

export type AdministrativeScheduleDay = {
  weekday: number
  startTime: string
  endTime: string
}

export type AdministrativeStaff = {
  id: string
  profile_id: string | null
  full_name: string
  email: string | null
  hourly_rate: number
  monthly_salary: number | null
  vacation_days_per_year: number
  default_schedule: AdministrativeScheduleDay[] | null
}

export type MoroccoHoliday = {
  holiday_date: string
  name: string
}

export type AdministrativeTimeEntry = {
  id?: string
  staff_id: string
  work_date: string
  start_time: string | null
  end_time: string | null
  break_minutes: number | null
  entry_type: AdministrativeEntryType
  hours: number | null
  note: string | null
}

export type AdministrativePayrollRow = AdministrativeTimeEntry & {
  staff: AdministrativeStaff
  holidayName: string | null
  plannedHours: number
  payableHours: number
  amount: number
}

export const administrativeEntryTypeLabels: Record<
  AdministrativeEntryType,
  string
> = {
  normal: 'Travail',
  holiday_paid: 'Férié non travaillé',
  holiday_worked: 'Férié travaillé',
  vacation_paid: 'Congé payé',
  unpaid_absence: 'Absence non payée',
  custom: 'Ajustement',
}

export const administrativeEntryTypeOptions: AdministrativeEntryType[] = [
  'normal',
  'holiday_paid',
  'holiday_worked',
  'vacation_paid',
  'unpaid_absence',
  'custom',
]

export function getMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function getMonthDateRange(monthKey: string): {
  startDate: string
  endDate: string
} {
  const [yearValue, monthValue] = monthKey.split('-').map(Number)
  const year = Number.isFinite(yearValue) ? yearValue : new Date().getFullYear()
  const monthIndex = Number.isFinite(monthValue) ? monthValue - 1 : 0
  const start = new Date(year, monthIndex, 1)
  const end = new Date(year, monthIndex + 1, 0)

  return {
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end),
  }
}

export function getDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const current = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)

  while (!Number.isNaN(current.getTime()) && current <= end) {
    dates.push(toDateInputValue(current))
    current.setDate(current.getDate() + 1)
  }

  return dates
}

export function getWeekdayNumber(dateValue: string): number {
  const day = new Date(`${dateValue}T00:00:00`).getDay()
  return day === 0 ? 7 : day
}

export function getScheduleForDate(
  staff: AdministrativeStaff,
  dateValue: string
): AdministrativeScheduleDay | null {
  const weekday = getWeekdayNumber(dateValue)
  return (
    staff.default_schedule?.find((scheduleDay) => scheduleDay.weekday === weekday) ??
    null
  )
}

export function calculateHoursBetween(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  breakMinutes = 0
): number {
  if (!startTime || !endTime) return 0

  const [startHour, startMinute] = startTime.split(':').map(Number)
  const [endHour, endMinute] = endTime.split(':').map(Number)

  if (
    !Number.isFinite(startHour) ||
    !Number.isFinite(startMinute) ||
    !Number.isFinite(endHour) ||
    !Number.isFinite(endMinute)
  ) {
    return 0
  }

  const startTotal = startHour * 60 + startMinute
  const endTotal = endHour * 60 + endMinute
  const workedMinutes = Math.max(endTotal - startTotal - breakMinutes, 0)

  return roundHours(workedMinutes / 60)
}

export function getPlannedHours(
  staff: AdministrativeStaff,
  dateValue: string
): number {
  const schedule = getScheduleForDate(staff, dateValue)
  return schedule
    ? calculateHoursBetween(schedule.startTime, schedule.endTime, 0)
    : 0
}

export function buildDefaultTimeEntry({
  staff,
  dateValue,
  holidayName,
}: {
  staff: AdministrativeStaff
  dateValue: string
  holidayName: string | null
}): AdministrativeTimeEntry {
  const schedule = getScheduleForDate(staff, dateValue)
  const plannedHours = getPlannedHours(staff, dateValue)

  return {
    staff_id: staff.id,
    work_date: dateValue,
    start_time: schedule?.startTime ?? null,
    end_time: schedule?.endTime ?? null,
    break_minutes: 0,
    entry_type:
      holidayName && plannedHours > 0
        ? 'holiday_paid'
        : plannedHours > 0
          ? 'normal'
          : 'unpaid_absence',
    hours: plannedHours,
    note: null,
  }
}

export function calculatePayableHours(
  entryType: AdministrativeEntryType,
  hours: number,
  plannedHours: number
): number {
  switch (entryType) {
    case 'holiday_worked':
      return roundHours(hours * 2)
    case 'holiday_paid':
    case 'vacation_paid':
      return roundHours(hours || plannedHours)
    case 'unpaid_absence':
      return 0
    case 'normal':
    case 'custom':
      return roundHours(hours)
  }
}

export function buildPayrollRow({
  staff,
  entry,
  holidayName,
  hourlyRateOverride,
}: {
  staff: AdministrativeStaff
  entry: AdministrativeTimeEntry
  holidayName: string | null
  hourlyRateOverride?: number
}): AdministrativePayrollRow {
  const plannedHours = getPlannedHours(staff, entry.work_date)
  const hours = Number(entry.hours ?? 0)
  const payableHours = calculatePayableHours(
    entry.entry_type,
    hours,
    plannedHours
  )

  return {
    ...entry,
    staff: {
      ...staff,
      hourly_rate: hourlyRateOverride ?? staff.hourly_rate,
    },
    holidayName,
    plannedHours,
    payableHours,
    amount: payableHours * Number(hourlyRateOverride ?? staff.hourly_rate ?? 0),
  }
}

export function roundHours(value: number): number {
  return Math.round(value * 100) / 100
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(date.getDate()).padStart(2, '0')}`
}
