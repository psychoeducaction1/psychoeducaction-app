import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  INTAKE_CALL_MINUTES,
  INTAKE_SLOT_MINUTES,
  isValidIntakeSlot,
} from '@/lib/publicIntakeSchedule'
import {
  createHoldToken,
  enforcePublicIntakeRateLimit,
  hashHoldToken,
  isAllowedPublicIntakeOrigin,
  publicIntakeJson,
  publicIntakeOptions,
  verifyPublicIntakeTurnstile,
} from '@/lib/publicIntakeSecurity'
import { validateIdempotencyKey } from '@/lib/publicIntakeValidation'

export function OPTIONS(request: NextRequest) {
  return publicIntakeOptions(request)
}

export async function POST(request: NextRequest) {
  if (!isAllowedPublicIntakeOrigin(request)) {
    return publicIntakeJson(request, { error: 'Origine non autorisée.' }, 403)
  }

  const idempotencyKey = validateIdempotencyKey(
    request.headers.get('idempotency-key')
  )
  if (!idempotencyKey) {
    return publicIntakeJson(request, { error: 'Clé d’idempotence invalide.' }, 400)
  }
  const body = (await request.json().catch(() => null)) as
    | { startAt?: unknown; turnstileToken?: unknown }
    | null
  const startAt = typeof body?.startAt === 'string' ? new Date(body.startAt) : new Date('invalid')
  if (!isValidIntakeSlot(startAt)) {
    return publicIntakeJson(request, { error: 'Ce créneau est invalide.' }, 400)
  }

  try {
    const [rateAllowed, human] = await Promise.all([
      enforcePublicIntakeRateLimit(request, 'hold', 30, 600),
      verifyPublicIntakeTurnstile(request, body?.turnstileToken),
    ])
    if (!rateAllowed) return publicIntakeJson(request, { error: 'Trop de requêtes.' }, 429)
    if (!human) return publicIntakeJson(request, { error: 'Validation antipourriel échouée.' }, 400)

    const token = createHoldToken(idempotencyKey)
    const { data, error } = await getSupabaseAdmin().rpc('hold_public_intake_slot', {
      p_start_at: startAt.toISOString(),
      p_end_at: new Date(startAt.getTime() + INTAKE_CALL_MINUTES * 60_000).toISOString(),
      p_buffer_end_at: new Date(startAt.getTime() + INTAKE_SLOT_MINUTES * 60_000).toISOString(),
      p_token_hash: hashHoldToken(token),
      p_idempotency_key: idempotencyKey,
    })
    if (error) {
      const status = error.message.includes('SLOT_UNAVAILABLE') ? 409 : 500
      return publicIntakeJson(
        request,
        { error: status === 409 ? 'Ce créneau vient d’être réservé.' : 'La retenue du créneau a échoué.' },
        status
      )
    }
    return publicIntakeJson(request, { ...data, holdToken: token }, 201)
  } catch {
    return publicIntakeJson(request, { error: 'La retenue du créneau a échoué.' }, 503)
  }
}
