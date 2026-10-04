import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { notifyRapidCallback } from '@/lib/publicIntakeNotifications'
import {
  enforcePublicIntakeRateLimit,
  isAllowedPublicIntakeOrigin,
  publicIntakeJson,
  publicIntakeOptions,
  verifyPublicIntakeTurnstile,
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
  const validation = validatePublicIntakePayload(body?.intake, 'rapid_callback')
  if (!validation.data) return publicIntakeJson(request, { error: validation.error }, 400)

  try {
    const [rateAllowed, human] = await Promise.all([
      enforcePublicIntakeRateLimit(request, 'callback', 10, 900),
      verifyPublicIntakeTurnstile(request, body?.turnstileToken),
    ])
    if (!rateAllowed) return publicIntakeJson(request, { error: 'Trop de requêtes.' }, 429)
    if (!human) return publicIntakeJson(request, { error: 'Validation antipourriel échouée.' }, 400)

    const intake = validation.data
    const { data, error } = await getSupabaseAdmin().rpc('create_public_callback_request', {
      p_payload: {
        ...intake,
        modalityLabels: modalityLabelsForDatabase(intake.modalities),
      },
      p_idempotency_key: idempotencyKey,
    })
    if (error) return publicIntakeJson(request, { error: 'La demande de rappel a échoué.' }, 500)

    let notificationPending = false
    try {
      await notifyRapidCallback(data.prospectId)
    } catch {
      notificationPending = true
    }
    return publicIntakeJson(request, {
      success: true,
      status: 'RAPID_CALLBACK_REQUESTED',
      notificationPending,
    }, data.reused ? 200 : 201)
  } catch {
    return publicIntakeJson(request, { error: 'La demande de rappel est temporairement indisponible.' }, 503)
  }
}
