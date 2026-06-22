import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type NotificationBody = {
  professionalId?: unknown
  previousPendingCount?: unknown
}

type ProfileRow = {
  full_name: string | null
  email: string | null
  role: string | null
  platform_access_enabled: boolean | null
}

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''

  if (!authorization.toLowerCase().startsWith('bearer ')) return ''

  return authorization.slice('bearer '.length).trim()
}

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.psychoeducaction.com').replace(
    /\/$/,
    ''
  )
}

async function sendEmail({
  to,
  subject,
  text,
}: {
  to: string
  subject: string
  text: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ??
    'Assignations PsychoÉducAction <onboarding@resend.dev>'

  if (!apiKey) {
    throw new Error('RESEND_API_KEY est manquant.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject,
      text,
    }),
  })

  const responseText = await response.text()
  console.log('[professional-assignment-notification] Resend response:', {
    status: response.status,
    ok: response.ok,
    body: response.ok ? undefined : responseText,
  })

  if (!response.ok) {
    throw new Error(
      `Erreur Resend ${response.status}: ${responseText || response.statusText}`
    )
  }
}

export async function POST(request: NextRequest) {
  console.log('[professional-assignment-notification] Route appelee.')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(
      { error: 'Configuration Supabase publique manquante côté serveur.' },
      500
    )
  }

  const accessToken = getBearerToken(request)

  if (!accessToken) {
    return jsonResponse({ error: 'Non autorisé.' }, 401)
  }

  const supabaseServer = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const {
    data: { user },
    error: userError,
  } = await supabaseServer.auth.getUser()

  if (userError || !user) {
    return jsonResponse({ error: 'Utilisateur connecté introuvable.' }, 401)
  }

  const { data: currentProfile, error: currentProfileError } =
    await supabaseServer
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .limit(1)
      .maybeSingle()

  if (currentProfileError) {
    return jsonResponse({ error: currentProfileError.message }, 500)
  }

  if (currentProfile?.role !== 'direction') {
    return jsonResponse({ error: 'Accès réservé à la direction.' }, 403)
  }

  let body: NotificationBody

  try {
    body = (await request.json()) as NotificationBody
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const professionalId = normalizeId(body.professionalId)
  const previousPendingCount = normalizeCount(body.previousPendingCount)

  console.log('[professional-assignment-notification] Payload recu:', {
    professionalId,
    pendingBefore: previousPendingCount,
  })

  if (!professionalId) {
    return jsonResponse({ error: "L'identifiant du professionnel est requis." }, 400)
  }

  const { count: currentPendingCount, error: countError } = await supabaseServer
    .from('assigned_clients')
    .select('id', { count: 'exact', head: true })
    .eq('professional_id', professionalId)
    .is('is_active', null)

  if (countError) {
    return jsonResponse({ error: countError.message }, 500)
  }

  const pendingAfter = currentPendingCount ?? 0
  const shouldSendEmail = previousPendingCount === 0 && pendingAfter > 0

  console.log('[professional-assignment-notification] Transition evaluee:', {
    professionalId,
    pendingBefore: previousPendingCount,
    pendingAfter,
    shouldSendEmail,
  })

  if (!shouldSendEmail) {
    return jsonResponse(
      {
        skipped: true,
        reason: 'transition_absente',
        pendingBefore: previousPendingCount,
        pendingAfter,
      },
      200
    )
  }

  if (pendingAfter <= 0) {
    return jsonResponse({ skipped: true, reason: 'aucune_assignation' }, 200)
  }

  const { data: professionalProfile, error: professionalProfileError } =
    await supabaseServer
      .from('profiles')
      .select('full_name, email, role, platform_access_enabled')
      .eq('id', professionalId)
      .limit(1)
      .maybeSingle()

  if (professionalProfileError) {
    return jsonResponse({ error: professionalProfileError.message }, 500)
  }

  const profile = professionalProfile as ProfileRow | null

  console.log('[professional-assignment-notification] Profil professionnel:', {
    professionalId,
    role: profile?.role ?? null,
    platformAccessEnabled: profile?.platform_access_enabled ?? null,
    hasEmail: Boolean(profile?.email?.trim()),
  })

  if (profile?.role !== 'professionnel' || !profile.email?.trim()) {
    return jsonResponse({ error: 'Profil professionnel introuvable.' }, 404)
  }

  if (profile.platform_access_enabled === false) {
    return jsonResponse(
      {
        skipped: true,
        reason: 'platform_access_disabled',
        pendingBefore: previousPendingCount,
        pendingAfter,
      },
      200
    )
  }

  const professionalName =
    profile.full_name?.trim() || profile.email.trim() || 'Professionnel'
  const appUrl = getAppUrl()
  const subject = 'Nouvelle assignation disponible'
  const text = [
    `Bonjour ${professionalName},`,
    '',
    'Une ou plusieurs nouvelles assignations ont été ajoutées à votre compte PsychoÉducAction.',
    '',
    'Veuillez vous connecter à la plateforme afin de consulter vos assignations et mettre à jour leur statut.',
    '',
    'Accéder à la plateforme :',
    appUrl,
    '',
    'Merci,',
    'Clinique PsychoÉducAction',
  ].join('\n')

  try {
    await sendEmail({ to: profile.email.trim(), subject, text })
  } catch (error) {
    console.error(
      "[professional-assignment-notification] Erreur d'envoi courriel:",
      error
    )
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur inconnue pendant l'envoi courriel.",
      },
      500
    )
  }

  return jsonResponse({ success: true }, 200)
}
