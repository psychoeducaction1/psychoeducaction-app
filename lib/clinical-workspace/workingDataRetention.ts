export const CLINICAL_WORKING_DATA_TTL_MS = 24 * 60 * 60 * 1000

export function workingDataDeadline(startedAt: number) {
  return startedAt + CLINICAL_WORKING_DATA_TTL_MS
}

export function workingDataExpired(deadline: number | null, now: number) {
  return deadline !== null && now >= deadline
}
