import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type NotificationBody = {
  requestId?: unknown
}

type AssignmentRequestRow = {
  id: string
  professional_id: string
  requested_count: number | null
  request_comment: string | null
  created_at: string | null
}

type ProfileRow = {
  full_name: string | null
  email: string | null
  role: string | null
  pref_client_types: string[] | null
  pref_modalities: string[] | null
}

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''

  if (!authorization.toLowerCase().startsWith('bearer ')) return ''

  return authorization.slice('bearer '.length).trim()
}

function formatList(value: string[] | null | undefined) {
  return value && value.length > 0 ? value.join(', ') : 'Non précisé'
}

function formatText(value: string | null | undefined) {
  return value?.trim() || 'Non précisé'
}

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    ''
  )
}

async function sendEmail({
  subject,
  text,
}: {
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
      to: ['contact@psychoeducaction.com'],
      subject,
      text,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Erreur Resend ${response.status}: ${errorText || response.statusText}`
    )
  }
}

export async function POST(request: NextRequest) {
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

  let body: NotificationBody

  try {
    body = (await request.json()) as NotificationBody
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const requestId = normalizeId(body.requestId)

  if (!requestId) {
    return jsonResponse({ error: "L'identifiant de la demande est requis." }, 400)
  }

  const { data: assignmentRequest, error: assignmentRequestError } =
    await supabaseServer
      .from('assignment_requests')
      .select('id, professional_id, requested_count, request_comment, created_at')
      .eq('id', requestId)
      .limit(1)
      .maybeSingle()

  if (assignmentRequestError) {
    return jsonResponse({ error: assignmentRequestError.message }, 500)
  }

  const requestRow = assignmentRequest as AssignmentRequestRow | null

  if (!requestRow || requestRow.professional_id !== user.id) {
    return jsonResponse({ error: 'Demande introuvable.' }, 404)
  }

  const { data: profile, error: profileError } = await supabaseServer
    .from('profiles')
    .select('full_name, email, role, pref_client_types, pref_modalities')
    .eq('id', user.id)
    .limit(1)
    .maybeSingle()

  if (profileError) {
    return jsonResponse({ error: profileError.message }, 500)
  }

  const profileRow = profile as ProfileRow | null

  if (profileRow?.role !== 'professionnel' && profileRow?.role !== 'direction') {
    return jsonResponse({ error: 'Accès non autorisé.' }, 403)
  }

  const professionalName =
    profileRow?.full_name?.trim() || profileRow?.email?.trim() || 'Professionnel'
  const appUrl = getAppUrl()
  const directionLink = `${appUrl}/direction/assignations`
  const createdAt = requestRow.created_at
    ? new Intl.DateTimeFormat('fr-CA', {
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(new Date(requestRow.created_at))
    : new Intl.DateTimeFormat('fr-CA', {
        dateStyle: 'long',
        timeStyle: 'short',
      }).format(new Date())

  const subject = `Nouvelle demande d'assignation - ${professionalName}`
  const text = [
    "Une nouvelle demande d'assignation a été soumise.",
    '',
    'Professionnel :',
    professionalName,
    '',
    "Nombre d'assignations demandées :",
    String(requestRow.requested_count ?? 0),
    '',
    'Clientèle :',
    formatList(profileRow?.pref_client_types),
    '',
    'Modalité :',
    formatList(profileRow?.pref_modalities),
    '',
    'Commentaire :',
    formatText(requestRow.request_comment),
    '',
    'Date :',
    createdAt,
    '',
    'Lien direction :',
    directionLink,
  ].join('\n')

  try {
    await sendEmail({ subject, text })
  } catch (error) {
    console.error(
      "[assignment-request-notification] Erreur d'envoi courriel:",
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
