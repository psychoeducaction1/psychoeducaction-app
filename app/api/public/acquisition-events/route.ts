import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  enforcePublicIntakeRateLimit,
  isAllowedPublicIntakeOrigin,
  publicIntakeJson,
  publicIntakeOptions,
} from '@/lib/publicIntakeSecurity'
import {
  sanitizePublicAttribution,
  validateIdempotencyKey,
} from '@/lib/publicIntakeValidation'

const eventTypes = ['contact_form_submitted', 'phone_click'] as const

export function OPTIONS(request: NextRequest) {
  return publicIntakeOptions(request)
}

export async function POST(request: NextRequest) {
  if (!isAllowedPublicIntakeOrigin(request)) {
    return publicIntakeJson(request, { error: 'Origine non autorisée.' }, 403)
  }

  const idempotencyKey = validateIdempotencyKey(request.headers.get('idempotency-key'))
  if (!idempotencyKey) {
    return publicIntakeJson(request, { error: 'Clé d’idempotence invalide.' }, 400)
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const eventType = typeof body?.eventType === 'string' ? body.eventType : ''
  if (!eventTypes.includes(eventType as (typeof eventTypes)[number])) {
    return publicIntakeJson(request, { error: 'Type d’événement invalide.' }, 400)
  }

  const rateAllowed = await enforcePublicIntakeRateLimit(request, 'acquisition-event', 30, 900)
  if (!rateAllowed) return publicIntakeJson(request, { error: 'Trop de requêtes.' }, 429)

  const supabase = getSupabaseAdmin()
  const { data: existing, error: lookupError } = await supabase
    .from('public_acquisition_events')
    .select('conversion_event_id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (lookupError) return publicIntakeJson(request, { error: 'Enregistrement impossible.' }, 500)
  if (existing) {
    return publicIntakeJson(request, {
      success: true,
      conversionEventId: existing.conversion_event_id,
      reused: true,
    })
  }

  const source = typeof body?.source === 'string'
    ? body.source.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120)
    : 'Site web'
  const { data, error } = await supabase
    .from('public_acquisition_events')
    .insert({
      idempotency_key: idempotencyKey,
      event_type: eventType,
      source: source || 'Site web',
      utm: sanitizePublicAttribution(body?.utm),
    })
    .select('conversion_event_id')
    .single()

  if (error) return publicIntakeJson(request, { error: 'Enregistrement impossible.' }, 500)
  return publicIntakeJson(request, {
    success: true,
    conversionEventId: data.conversion_event_id,
    reused: false,
  }, 201)
}
