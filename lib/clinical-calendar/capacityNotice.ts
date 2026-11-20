import { torontoLocalInstant } from './time.ts'

export const capacityNoticeMessage = 'Choisissez des plages qui commencent au moins 72 heures après votre proposition.'
const noticeMilliseconds = 72 * 60 * 60 * 1000

export function meetsCapacityNotice(day: string, startMinute: number, now: number): boolean {
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute >= 1440 || !Number.isFinite(now)) return false
  const hour = String(Math.floor(startMinute / 60)).padStart(2, '0')
  const minute = String(startMinute % 60).padStart(2, '0')
  try { return Date.parse(torontoLocalInstant(`${day}T${hour}:${minute}`)) - now >= noticeMilliseconds }
  catch { return false }
}
