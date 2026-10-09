export const INTAKE_TIME_ZONE = 'America/Toronto'
export const INTAKE_CALL_MINUTES = 15
export const INTAKE_SLOT_MINUTES = 30
export const INTAKE_MINIMUM_NOTICE_MINUTES = 120

type DateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: string
}

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: INTAKE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
})

function partsInToronto(date: Date): DateParts {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday,
  }
}

export function torontoLocalToUtc(
  dateValue: string,
  hour: number,
  minute: number
) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue)
  if (!match) throw new Error('Date locale invalide.')

  const desiredUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    hour,
    minute
  )
  let candidate = new Date(desiredUtc)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsInToronto(candidate)
    const representedUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute
    )
    candidate = new Date(candidate.getTime() + desiredUtc - representedUtc)
  }

  return candidate
}

export function dateKeyInToronto(date: Date) {
  const parts = partsInToronto(date)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function dateTimeInputValueInToronto(date: Date) {
  const parts = partsInToronto(date)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

export function dateTimeInputToUtcInToronto(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('Date et heure locales invalides.')
  return torontoLocalToUtc(match[1], Number(match[2]), Number(match[3]))
}

export function addLocalDays(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12))
  return date.toISOString().slice(0, 10)
}

export function startOfLocalWeek(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay() || 7
  return addLocalDays(dateValue, 1 - weekday)
}

export function isValidIntakeSlot(startAt: Date, now = new Date()) {
  if (Number.isNaN(startAt.getTime())) return false
  if (
    startAt.getTime() <
    now.getTime() + INTAKE_MINIMUM_NOTICE_MINUTES * 60_000
  ) {
    return false
  }

  const parts = partsInToronto(startAt)
  if (parts.minute !== 0 && parts.minute !== 30) return false
  if (parts.weekday === 'Sun') return false

  const minutes = parts.hour * 60 + parts.minute
  const isSaturday = parts.weekday === 'Sat'
  const firstStart = isSaturday ? 12 * 60 : 8 * 60
  const closing = isSaturday ? 16 * 60 : 18 * 60 + 30

  return minutes >= firstStart && minutes + INTAKE_SLOT_MINUTES <= closing
}

export function buildIntakeSlots(
  fromDate: string,
  days: number,
  now = new Date()
) {
  const slots: Array<{ startAt: string; endAt: string; bufferEndAt: string }> = []

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const dateValue = addLocalDays(fromDate, dayOffset)
    const midday = torontoLocalToUtc(dateValue, 12, 0)
    const weekday = partsInToronto(midday).weekday
    if (weekday === 'Sun') continue

    const isSaturday = weekday === 'Sat'
    const firstStart = isSaturday ? 12 * 60 : 8 * 60
    const closing = isSaturday ? 16 * 60 : 18 * 60 + 30

    for (
      let minuteOfDay = firstStart;
      minuteOfDay + INTAKE_SLOT_MINUTES <= closing;
      minuteOfDay += INTAKE_SLOT_MINUTES
    ) {
      const start = torontoLocalToUtc(
        dateValue,
        Math.floor(minuteOfDay / 60),
        minuteOfDay % 60
      )
      if (!isValidIntakeSlot(start, now)) continue

      slots.push({
        startAt: start.toISOString(),
        endAt: new Date(
          start.getTime() + INTAKE_CALL_MINUTES * 60_000
        ).toISOString(),
        bufferEndAt: new Date(
          start.getTime() + INTAKE_SLOT_MINUTES * 60_000
        ).toISOString(),
      })
    }
  }

  return slots
}

export function rangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string
) {
  return (
    new Date(firstStart).getTime() < new Date(secondEnd).getTime() &&
    new Date(secondStart).getTime() < new Date(firstEnd).getTime()
  )
}
