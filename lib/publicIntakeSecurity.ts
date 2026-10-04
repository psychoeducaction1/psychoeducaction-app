import 'server-only'

import { createHash, createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

const OFFICIAL_ORIGIN = 'https://psychoeducaction.com'

function allowedOrigins() {
  return new Set(
    (process.env.PUBLIC_INTAKE_ALLOWED_ORIGINS ?? OFFICIAL_ORIGIN)
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean)
  )
}

export function isAllowedPublicIntakeOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')?.replace(/\/$/, '') ?? ''
  return Boolean(origin && allowedOrigins().has(origin))
}

export function publicIntakeJson(
  request: NextRequest,
  body: object,
  status = 200
) {
  const response = NextResponse.json(body, { status })
  const origin = request.headers.get('origin')?.replace(/\/$/, '') ?? ''
  if (allowedOrigins().has(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Vary', 'Origin')
  }
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}

export function publicIntakeOptions(request: NextRequest) {
  if (!isAllowedPublicIntakeOrigin(request)) {
    return publicIntakeJson(request, { error: 'Origine non autorisée.' }, 403)
  }

  const response = new NextResponse(null, { status: 204 })
  response.headers.set(
    'Access-Control-Allow-Origin',
    request.headers.get('origin') ?? OFFICIAL_ORIGIN
  )
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Idempotency-Key'
  )
  response.headers.set('Access-Control-Max-Age', '86400')
  response.headers.set('Vary', 'Origin')
  return response
}

export function publicIntakeRequestFingerprint(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const address = forwarded || request.headers.get('x-real-ip') || 'unknown'
  const salt = process.env.PUBLIC_INTAKE_RATE_LIMIT_SALT ?? 'public-intake'
  return createHash('sha256').update(`${salt}:${address}`).digest('hex')
}

export async function enforcePublicIntakeRateLimit(
  request: NextRequest,
  action: string,
  limit: number,
  windowSeconds: number
) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.rpc('check_public_intake_rate_limit', {
    p_key_hash: publicIntakeRequestFingerprint(request),
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })

  if (error) throw new Error('La protection contre les abus est indisponible.')
  return data === true
}

export async function verifyPublicIntakeTurnstile(
  request: NextRequest,
  token: unknown
) {
  if (process.env.PUBLIC_INTAKE_BYPASS_ANTIBOT === 'true') return true

  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret || typeof token !== 'string' || !token.trim()) return false

  const body = new URLSearchParams({
    secret,
    response: token.trim(),
    remoteip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '',
  })
  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body, cache: 'no-store' }
  )
  if (!response.ok) return false
  const result = (await response.json()) as { success?: boolean }
  return result.success === true
}

export function createHoldToken(idempotencyKey: string) {
  const secret = process.env.PUBLIC_INTAKE_HOLD_SECRET
  if (!secret) throw new Error('PUBLIC_INTAKE_HOLD_SECRET est manquant.')
  return createHmac('sha256', secret).update(idempotencyKey).digest('hex')
}

export function hashHoldToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
