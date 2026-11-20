/** Only the fixed domain code plus a validated ISO date cross the RPC boundary. */
export function mandateDateFailure(value: unknown): { code: 'MANDATE_DATE_BEFORE_START'; startDate: string; message: string; status: 409 } | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.code !== 'MANDATE_DATE_BEFORE_START' && !(v.code === '22023' && v.message === 'MANDATE_DATE_BEFORE_START')) return null
  const date = typeof v.mandateStartDate === 'string' ? v.mandateStartDate : typeof v.details === 'string' ? /^MANDATE_START=(\d{4}-\d{2}-\d{2})$/.exec(v.details)?.[1] : undefined
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) return null
  const [year, month, day] = date.split('-')
  return { code: 'MANDATE_DATE_BEFORE_START', startDate: date, status: 409, message: `La date de la rencontre ou de la note précède le début du mandat, fixé au ${day}/${month}/${year}. Choisissez une date à partir de ce jour ou faites vérifier la date du mandat.` }
}
