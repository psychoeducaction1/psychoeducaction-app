import { decimalProduct } from '@/lib/payrollDecimal'

/** Recover the hourly client rate within the cent rounding of the claimed amount. */
export function activityHourlyRate(amount: number, hours: number): number {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(hours) || hours <= 0) return 0
  const raw = amount / hours
  const integer = Math.round(raw)
  return decimalProduct(integer, hours) === decimalProduct(amount, 1) ? integer : decimalProduct(amount, 1, hours)
}

export type ActivityTimeCorrection = { sourceRow: number; startTime: string; endTime: string }
export function correctActivityTimes(rows: unknown[][], corrections: ActivityTimeCorrection[]): unknown[][] {
  if (!corrections.length) throw new Error('Renseignez les horaires à corriger.')
  const result = rows.map(row => [...row])
  const seen = new Set<number>()
  for (const correction of corrections) {
    const { sourceRow, startTime, endTime } = correction
    if (!Number.isInteger(sourceRow) || sourceRow < 1 || !result[sourceRow - 1] || seen.has(sourceRow)) throw new Error('Activité invalide.')
    seen.add(sourceRow)
    const minutes = (time: string) => {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Horaire invalide.')
      const [h, m] = time.split(':').map(Number); return h * 60 + m
    }
    if (minutes(endTime) <= minutes(startTime)) throw new Error('La fin doit être après le début, le même jour.')
    const date = String(result[sourceRow - 1][0]).match(/(?:^|\n)(\d{4}-\d{2}-\d{2})(?:$|\s)/)?.[1]
    if (!date) throw new Error('Date de l’activité introuvable.')
    result[sourceRow - 1][0] = `${date}\n${startTime} - ${endTime}`
  }
  return result
}
