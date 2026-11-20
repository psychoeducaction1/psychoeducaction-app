import {
  buildDefaultTimeEntry, buildPayrollRow, getAdministrativeHourlyRate,
  getDatesInRange, getMonthDateRange, getPlannedHours, getScheduleForDate, roundMoney,
} from '@/lib/administrativePayroll'
import type { AdministrativeStaff, AdministrativeTimeEntry, MoroccoHoliday } from '@/lib/administrativePayroll'

export function parseAdministrativePayrollRequest(value: unknown): { month: string; staffIds: string[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (Object.keys(body).length !== 2 || typeof body.month !== 'string'
    || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(body.month)
    || !Array.isArray(body.staffIds) || !body.staffIds.length || body.staffIds.length > 25
    || !body.staffIds.every(id => typeof id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
    || new Set(body.staffIds).size !== body.staffIds.length) return null
  return { month: body.month, staffIds: body.staffIds as string[] }
}

// Meme regle que l'ecran: horaires par defaut, saisies manuelles prioritaires,
// conges/feries et taux de reference. Aucun montant fourni par le navigateur.
export function computeAdministrativePayrollTotals(
  staff: AdministrativeStaff[], entries: AdministrativeTimeEntry[], holidays: MoroccoHoliday[], month: string
) {
  const { startDate, endDate } = getMonthDateRange(month)
  const dates = getDatesInRange(startDate, endDate)
  const byDate = new Map(holidays.map(day => [day.holiday_date, day.name]))
  return staff.map(person => {
    const hourlyRate = getAdministrativeHourlyRate(person, month)
    if (!Number.isFinite(hourlyRate) || hourlyRate < 0) throw new Error('Taux horaire invalide.')
    const ownEntries = new Map(entries.filter(entry => entry.staff_id === person.id).map(entry => [entry.work_date, entry]))
    let payableHours = 0
    let amount = 0
    for (const date of dates) {
      const holidayName = byDate.get(date) ?? null
      const existing = ownEntries.get(date)
      if (!existing && !getScheduleForDate(person, date) && getPlannedHours(person, date) <= 0 && !holidayName) continue
      const entry = existing ?? buildDefaultTimeEntry({ staff: person, dateValue: date, holidayName })
      if (!Number.isFinite(Number(entry.hours ?? 0)) || Number(entry.hours ?? 0) < 0) throw new Error('Heures invalides.')
      const row = buildPayrollRow({ staff: person, entry, holidayName, hourlyRateOverride: hourlyRate })
      if (!Number.isFinite(row.payableHours) || !Number.isFinite(row.amount)) throw new Error('Saisie de paie invalide.')
      payableHours += row.payableHours
      amount += row.amount
    }
    return { staffId: person.id, payableHours: roundMoney(payableHours), totalMad: roundMoney(amount) }
  })
}
