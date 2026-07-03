import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

type NotificationBody = {
  assignedClientId?: unknown
}

type AssignedClientRow = {
  id: string
  professional_id: string | null
  assignment_request_id: string | null
  waiting_list_client_id: string | null
  first_name: string | null
  last_name: string | null
  canceled_at: string | null
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

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.psychoeducaction.com').replace(
    /\/$/,
    ''
  )
}

function getClientName(client: AssignedClientRow) {
  return [client.first_name, client.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
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

  if (!apiKey) throw new Error('RESEND_API_KEY est manquant.')

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

  if (!response.ok) {
    throw new Error(
      `Erreur Resend ${response.status}: ${responseText || response.statusText}`
    )
  }
}

export async function POST(request: NextRequest) {
  const directionResult = await getDirectionContext(request)

  if (directionResult.error) {
    return jsonResponse(
      { error: directionResult.error.message },
      directionResult.error.status
    )
  }

  let body: NotificationBody

  try {
    body = (await request.json()) as NotificationBody
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const assignedClientId = normalizeId(body.assignedClientId)

  if (!assignedClientId) {
    return jsonResponse({ error: "L'identifiant de l'assignation est requis." }, 400)
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data: assignedClientData, error: assignedClientError } =
    await supabaseAdmin
      .from('assigned_clients')
      .select(
        'id, professional_id, assignment_request_id, waiting_list_client_id, first_name, last_name, canceled_at'
      )
      .eq('id', assignedClientId)
      .limit(1)
      .maybeSingle()

  if (assignedClientError) {
    return jsonResponse({ error: assignedClientError.message }, 500)
  }

  const assignedClient = assignedClientData as AssignedClientRow | null

  if (!assignedClient) {
    return jsonResponse({ error: 'Assignation introuvable.' }, 404)
  }

  if (assignedClient.canceled_at) {
    return jsonResponse({ error: 'Assignation annulée.' }, 409)
  }

  if (!assignedClient.professional_id) {
    return jsonResponse({ error: 'Professionnel associé introuvable.' }, 404)
  }

  const { data: professionalProfile, error: professionalProfileError } =
    await supabaseAdmin
      .from('profiles')
      .select('full_name, email, role, platform_access_enabled')
      .eq('id', assignedClient.professional_id)
      .limit(1)
      .maybeSingle()

  if (professionalProfileError) {
    return jsonResponse({ error: professionalProfileError.message }, 500)
  }

  const profile = professionalProfile as ProfileRow | null

  if (profile?.role !== 'professionnel' || !profile.email?.trim()) {
    return jsonResponse({ error: 'Profil professionnel introuvable.' }, 404)
  }

  if (profile.platform_access_enabled === false) {
    return jsonResponse(
      { skipped: true, reason: 'platform_access_disabled', assignedClientId },
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

  const actor = directionResult.context
  const clientName = getClientName(assignedClient)

  await supabaseAdmin.from('audit_logs').insert({
    actor_profile_id: actor.user.id,
    actor_name: actor.profile.full_name ?? actor.user.email ?? null,
    actor_role: actor.profile.role,
    action: 'professional_assignment_email_resent',
    entity_type: 'assigned_client',
    entity_id: assignedClient.id,
    description: `Courriel professionnel renvoyé à ${professionalName}.`,
    metadata: {
      client_name: clientName || null,
      professional_id: assignedClient.professional_id,
      professional_name: professionalName,
      professional_email: profile.email.trim(),
      assignment_request_id: assignedClient.assignment_request_id,
      waiting_list_client_id: assignedClient.waiting_list_client_id,
      notification_type: 'professional_assignment_resend',
    },
  })

  return jsonResponse({ success: true }, 200)
}
