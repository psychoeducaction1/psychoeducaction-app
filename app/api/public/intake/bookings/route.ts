import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { notifyPublicIntakeAppointment } from '@/lib/publicIntakeNotifications'
import { isValidIntakeSlot } from '@/lib/publicIntakeSchedule'
import {
  enforcePublicIntakeRateLimit,
  hashHoldToken,
  isAllowedPublicIntakeOrigin,
  publicIntakeJson,
  publicIntakeOptions,
} from '@/lib/publicIntakeSecurity'
import {
  modalityLabelsForDatabase,
  validateIdempotencyKey,
  validatePublicIntakePayload,
} from '@/lib/publicIntakeValidation'

export function OPTIONS(request: NextRequest) {
  return publicIntakeOptions(request)
}

export async function POST(request: NextRequest) {
  if (!isAllowedPublicIntakeOrigin(request)) {
    return publicIntakeJson(request, { error: 'Origine non autorisée.' }, 403)
  }
  const idempotencyKey = validateIdempotencyKey(request.headers.get('idempotency-key'))
  if (!idempotencyKey) return publicIntakeJson(request, { error: 'Clé d’idempotence invalide.' }, 400)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const validation = validatePublicIntakePayload(body?.intake, 'scheduled_call')
  if (!validation.data) return publicIntakeJson(request, { error: validation.error }, 400)
  const startAt = typeof body?.startAt === 'string' ? new Date(body.startAt) : new Date('invalid')
  const holdToken = typeof body?.holdToken === 'string' ? body.holdToken : ''
  if (!holdToken || !isValidIntakeSlot(startAt)) {
    return publicIntakeJson(request, { error: 'La réservation est invalide.' }, 400)
  }

  try {
    const rateAllowed = await enforcePublicIntakeRateLimit(
      request,
      'booking',
      10,
      900
    )
    if (!rateAllowed) return publicIntakeJson(request, { error: 'Trop de requêtes.' }, 429)

    const intake = validation.data
    const { data, error } = await getSupabaseAdmin().rpc('confirm_public_intake_booking', {
      p_payload: {
        ...intake,
        modalityLabels: modalityLabelsForDatabase(intake.modalities),
      },
      p_start_at: startAt.toISOString(),
      p_hold_token_hash: hashHoldToken(holdToken),
      p_idempotency_key: idempotencyKey,
    })
    if (error) {
      console.error('[public-intake-booking] Supabase RPC failed:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })
      const unavailable = error.message.includes('HOLD_INVALID_OR_EXPIRED') || error.message.includes('SLOT_UNAVAILABLE')
      return publicIntakeJson(
        request,
        { error: unavailable ? 'Le créneau n’est plus disponible.' : 'La réservation a échoué.' },
        unavailable ? 409 : 500
      )
    }

    let notificationPending = false
    try {
      await notifyPublicIntakeAppointment(data.appointmentId)
    } catch {
      notificationPending = true
    }
    return publicIntakeJson(request, {
      success: true,
      appointmentId: data.appointmentId,
      startAt: data.startAt,
      endAt: data.endAt,
      notificationPending,
    }, data.reused ? 200 : 201)
  } catch {
    return publicIntakeJson(request, { error: 'La réservation est temporairement indisponible.' }, 503)
  }
}
