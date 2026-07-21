import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { buildClientAssignmentEmailTemplate } from '@/lib/assignmentEmailTemplates'

type NotificationBody = {
  assignedClientId?: unknown
}

type AssignedClientRow = {
  id: string
  email: string | null
  professional_id: string | null
  assignment_request_id: string | null
  waiting_list_client_id: string | null
  first_name: string | null
  last_name: string | null
  canceled_at: string | null
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

function getRequiredEnv(name: string) {
  const value = process.env[name]

  if (!value) throw new Error(`${name} est manquant.`)

  return value
}

function getClientName(client: AssignedClientRow) {
  return [client.first_name, client.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
}

async function sendEmail({
  to,
  cc,
  subject,
  text,
}: {
  to: string
  cc?: string[]
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
      ...(cc && cc.length > 0 ? { cc } : {}),
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
        'id, email, professional_id, assignment_request_id, waiting_list_client_id, first_name, last_name, canceled_at'
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

  const recipientEmail = assignedClient.email?.trim()

  if (!recipientEmail) {
    return jsonResponse(
      { skipped: true, reason: 'courriel_contact_absent', assignedClientId },
      200
    )
  }

  if (!assignedClient.professional_id) {
    return jsonResponse({ error: 'Professionnel associé introuvable.' }, 404)
  }

  const { data: professionalProfileData, error: professionalProfileError } =
    await supabaseAdmin
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

  if (professionalProfile?.role !== 'professionnel') {
    return jsonResponse({ error: 'Profil professionnel introuvable.' }, 404)
  }

  const professionalName =
    professionalProfile.full_name?.trim() || 'votre professionnel'
  const defaultEmail = buildClientAssignmentEmailTemplate({
    professionalName,
    professionalEmail: professionalProfile.email,
    professionalTitle: professionalProfile.professional_title,
    professionalPhone: professionalProfile.professional_phone,
    professionalLicenseNumber: professionalProfile.professional_license_number,
  })
  const subject = defaultEmail.subject
  const text = defaultEmail.message

  try {
    await sendEmail({ to: recipientEmail, cc: defaultEmail.cc, subject, text })
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
    action: 'client_assignment_email_resent',
    entity_type: 'assigned_client',
    entity_id: assignedClient.id,
    description: `Courriel client renvoyé pour ${clientName || 'client sans nom'}.`,
    metadata: {
      client_name: clientName || null,
      client_email: recipientEmail,
      professional_id: assignedClient.professional_id,
      professional_name: professionalName,
      assignment_request_id: assignedClient.assignment_request_id,
      waiting_list_client_id: assignedClient.waiting_list_client_id,
      notification_type: 'client_assignment_resend',
    },
  })

  return jsonResponse({ success: true }, 200)
}
