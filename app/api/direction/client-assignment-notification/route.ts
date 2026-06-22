import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type NotificationBody = {
  assignedClientId?: unknown
}

type AssignedClientRow = {
  id: string
  email: string | null
  professional_id: string | null
  client_assignment_notified_at: string | null
}

type ProfessionalProfileRow = {
  full_name: string | null
  email: string | null
  professional_title: string | null
  professional_phone: string | null
  professional_license_number: string | null
  role: string | null
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

function getRequiredEnv(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} est manquant.`)
  }

  return value
}

function formatOptionalLine(label: string, value: string | null) {
  const normalizedValue = value?.trim()

  return normalizedValue ? `${label} : ${normalizedValue}` : null
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
  console.log('[client-assignment-notification] Resend response:', {
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
  console.log('[client-assignment-notification] Route appelee.')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(
      { error: 'Configuration Supabase publique manquante cote serveur.' },
      500
    )
  }

  const accessToken = getBearerToken(request)

  if (!accessToken) {
    return jsonResponse({ error: 'Non autorise.' }, 401)
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
    return jsonResponse({ error: 'Utilisateur connecte introuvable.' }, 401)
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
    return jsonResponse({ error: 'Acces reserve a la direction.' }, 403)
  }

  let body: NotificationBody

  try {
    body = (await request.json()) as NotificationBody
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const assignedClientId = normalizeId(body.assignedClientId)

  console.log('[client-assignment-notification] Payload recu:', {
    assignedClientId,
  })

  if (!assignedClientId) {
    return jsonResponse({ error: "L'identifiant de l'assignation est requis." }, 400)
  }

  const { data: assignedClientData, error: assignedClientError } =
    await supabaseServer
      .from('assigned_clients')
      .select('id, email, professional_id, client_assignment_notified_at')
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

  if (assignedClient.client_assignment_notified_at) {
    return jsonResponse(
      { skipped: true, reason: 'deja_notifie', assignedClientId },
      200
    )
  }

  const recipientEmail = assignedClient.email?.trim()

  console.log('[client-assignment-notification] Assignation trouvee:', {
    assignedClientId,
    professionalId: assignedClient.professional_id,
    hasContactEmail: Boolean(recipientEmail),
    alreadyNotified: Boolean(assignedClient.client_assignment_notified_at),
  })

  if (!recipientEmail) {
    return jsonResponse(
      { skipped: true, reason: 'courriel_contact_absent', assignedClientId },
      200
    )
  }

  if (!assignedClient.professional_id) {
    return jsonResponse({ error: 'Professionnel associe introuvable.' }, 404)
  }

  const { data: professionalProfileData, error: professionalProfileError } =
    await supabaseServer
      .from('profiles')
      .select(
        'full_name, email, professional_title, professional_phone, professional_license_number, role'
      )
      .eq('id', assignedClient.professional_id)
      .limit(1)
      .maybeSingle()

  if (professionalProfileError) {
    return jsonResponse({ error: professionalProfileError.message }, 500)
  }

  const professionalProfile =
    professionalProfileData as ProfessionalProfileRow | null

  console.log('[client-assignment-notification] Profil professionnel:', {
    professionalId: assignedClient.professional_id,
    role: professionalProfile?.role ?? null,
    hasName: Boolean(professionalProfile?.full_name?.trim()),
    hasEmail: Boolean(professionalProfile?.email?.trim()),
    hasTitle: Boolean(professionalProfile?.professional_title?.trim()),
    hasPhone: Boolean(professionalProfile?.professional_phone?.trim()),
    hasLicenseNumber: Boolean(
      professionalProfile?.professional_license_number?.trim()
    ),
  })

  if (professionalProfile?.role !== 'professionnel') {
    return jsonResponse({ error: 'Profil professionnel introuvable.' }, 404)
  }

  const professionalName =
    professionalProfile.full_name?.trim() || 'votre professionnel'
  const professionalTitle = professionalProfile.professional_title?.trim()
  const professionalNameWithTitle = professionalTitle
    ? `${professionalName}, ${professionalTitle}`
    : professionalName
  const contactLines = [
    formatOptionalLine('Courriel', professionalProfile.email),
    formatOptionalLine('Téléphone', professionalProfile.professional_phone),
    formatOptionalLine(
      'Numéro de permis',
      professionalProfile.professional_license_number
    ),
  ].filter(Boolean)

  const subject = 'Assignation de votre dossier - Clinique PsychoÉducAction'
  const text = [
    'Bonjour,',
    '',
    'Nous espérons que vous allez bien.',
    '',
    `Nous avons le plaisir de vous informer que votre demande auprès de la Clinique PsychoÉducAction a été assignée à ${professionalNameWithTitle}.`,
    '',
    `${professionalName} communiquera avec vous par courriel ou par téléphone dans les prochains jours afin de convenir d'une première rencontre.`,
    '',
    'Coordonnées du professionnel',
    '',
    ...contactLines,
    '',
    "Si vous avez des questions, n'hésitez pas à nous écrire par courriel ou à communiquer avec la clinique.",
    '',
    'Bien cordialement,',
    '',
    'Fatima Zahra Benlahcen',
    'Agente administrative',
    'Clinique PsychoÉducAction',
    'T : (438) 500-1388',
    'C : contact@psychoeducaction.com',
    'www.psychoeducaction.com',
  ].join('\n')

  try {
    await sendEmail({ to: recipientEmail, subject, text })
  } catch (error) {
    console.error(
      "[client-assignment-notification] Erreur d'envoi courriel:",
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
    .update({ client_assignment_notified_at: new Date().toISOString() })
    .eq('id', assignedClientId)

  if (updateNotificationError) {
    return jsonResponse({ error: updateNotificationError.message }, 500)
  }

  return jsonResponse({ success: true }, 200)
}
