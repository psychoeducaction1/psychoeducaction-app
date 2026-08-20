import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const unreachableFollowupClosureReason =
  'Aucune réponse après les tentatives de contact'

type NotificationBody = {
  assignedClientId?: unknown
}

type AssignedClientRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  professional_id: string | null
  is_active: boolean | null
  closure_reason: string | null
  canceled_at: string | null
  unreachable_followup_sent_at: string | null
}

type ProfileRow = {
  role: string | null
  full_name: string | null
  email: string | null
}

type AuditSupabaseClient = {
  from: (table: 'audit_logs') => {
    insert: (values: Record<string, unknown>) => PromiseLike<{
      error: { message: string } | null
    }>
  }
}

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''

  if (!authorization.toLowerCase().startsWith('bearer ')) return ''

  return authorization.slice('bearer '.length).trim()
}

function getRequiredEnv(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} est manquant.`)
  }

  return value
}

function isUnreachableClosureReason(value: string | null | undefined) {
  return (
    normalizeText(value) === normalizeText(unreachableFollowupClosureReason)
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
  const apiKey = getRequiredEnv('RESEND_API_KEY')
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ??
    'Assignations PsychoÉducAction <onboarding@resend.dev>'

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

async function logAudit({
  supabaseServer,
  actor,
  assignedClient,
  recipientEmail,
}: {
  supabaseServer: AuditSupabaseClient
  actor: { id: string; role: string | null; name: string | null }
  assignedClient: AssignedClientRow
  recipientEmail: string
}) {
  try {
    const clientName = `${assignedClient.first_name ?? ''} ${
      assignedClient.last_name ?? ''
    }`.trim()

    await supabaseServer.from('audit_logs').insert({
      actor_profile_id: actor.id,
      actor_name: actor.name,
      actor_role: actor.role,
      action: 'unreachable_client_followup_sent',
      entity_type: 'assigned_client',
      entity_id: assignedClient.id,
      description: `Courriel de suivi envoyé au client non rejoint${
        clientName ? ` (${clientName})` : ''
      }.`,
      metadata: {
        assigned_client_id: assignedClient.id,
        client_name: clientName || null,
        recipient_email: recipientEmail,
        closure_reason: assignedClient.closure_reason,
      },
    })
  } catch (caughtError) {
    console.error('[unreachable-followup-notification] Audit insert failed:', {
      assignedClientId: assignedClient.id,
      message:
        caughtError instanceof Error
          ? caughtError.message
          : "Erreur inconnue pendant l'écriture de l'audit.",
    })
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

  const { data: currentProfileData, error: currentProfileError } =
    await supabaseServer
      .from('profiles')
      .select('role, full_name, email')
      .eq('id', user.id)
      .limit(1)
      .maybeSingle()

  if (currentProfileError) {
    return jsonResponse({ error: currentProfileError.message }, 500)
  }

  const currentProfile = currentProfileData as ProfileRow | null

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

  const { data: assignedClientData, error: assignedClientError } =
    await supabaseServer
      .from('assigned_clients')
      .select(
        'id, first_name, last_name, email, professional_id, is_active, closure_reason, canceled_at, unreachable_followup_sent_at'
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

  const isDirection = currentProfile?.role === 'direction'
  const isAssignedProfessional = assignedClient.professional_id === user.id

  if (!isDirection && !isAssignedProfessional) {
    return jsonResponse({ error: 'Accès refusé.' }, 403)
  }

  if (assignedClient.canceled_at) {
    return jsonResponse(
      { skipped: true, reason: 'assignation_annulee', assignedClientId },
      200
    )
  }

  if (assignedClient.is_active !== false) {
    return jsonResponse(
      { skipped: true, reason: 'service_pas_classe_non_pris', assignedClientId },
      200
    )
  }

  if (!isUnreachableClosureReason(assignedClient.closure_reason)) {
    return jsonResponse(
      { skipped: true, reason: 'motif_non_applicable', assignedClientId },
      200
    )
  }

  if (assignedClient.unreachable_followup_sent_at) {
    return jsonResponse(
      { skipped: true, reason: 'deja_envoye', assignedClientId },
      200
    )
  }

  const recipientEmail = assignedClient.email?.trim() ?? ''

  if (!recipientEmail) {
    return jsonResponse(
      { skipped: true, reason: 'courriel_client_absent', assignedClientId },
      200
    )
  }

  const subject = 'Suivi concernant votre demande – Clinique PsychoÉducAction'
  const text = [
    'Bonjour,',
    '',
    'Nous vous écrivons concernant votre demande auprès de la Clinique PsychoÉducAction.',
    '',
    'Votre dossier a été assigné à un professionnel, mais nous n’avons pas réussi à confirmer si le contact a bien pu être établi.',
    '',
    'Si vous avez été contacté et que vous ne souhaitez plus recevoir le service, merci de nous l’indiquer.',
    '',
    'Si vous souhaitez toujours recevoir le service, veuillez répondre à ce courriel afin que nous puissions faciliter la mise en contact avec le professionnel assigné.',
    '',
    'Merci,',
    '',
    'Clinique PsychoÉducAction',
    'T : (438) 500-1388',
    'contact@psychoeducaction.com',
    'www.psychoeducaction.com',
  ].join('\n')

  try {
    await sendEmail({ to: recipientEmail, subject, text })
  } catch (error) {
    console.error(
      "[unreachable-followup-notification] Erreur d'envoi courriel:",
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

  const { error: updateNotificationError } = await supabaseServer
    .from('assigned_clients')
    .update({
      unreachable_followup_sent_at: new Date().toISOString(),
      unreachable_followup_sent_by: user.id,
    })
    .eq('id', assignedClientId)
    .is('unreachable_followup_sent_at', null)

  if (updateNotificationError) {
    return jsonResponse({ error: updateNotificationError.message }, 500)
  }

  await logAudit({
    supabaseServer,
    actor: {
      id: user.id,
      role: currentProfile?.role ?? null,
      name: currentProfile?.full_name ?? user.email ?? null,
    },
    assignedClient,
    recipientEmail,
  })

  return jsonResponse({ success: true }, 200)
}
