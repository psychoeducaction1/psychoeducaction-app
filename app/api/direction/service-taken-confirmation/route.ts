import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getDirectionContext } from '@/lib/directionServer'
import { sendResendEmail } from '@/lib/resendEmail'
import { getBearerToken } from '@/lib/superAdminServer'

type Body = { assignedClientId?: unknown }

function json(body: object, status: number) {
  return NextResponse.json(body, { status })
}

export async function POST(request: NextRequest) {
  const directionResult = await getDirectionContext(request)
  if (directionResult.error) {
    return json({ error: directionResult.error.message }, directionResult.error.status)
  }

  const payload = (await request.json().catch(() => null)) as Body | null
  const assignedClientId =
    typeof payload?.assignedClientId === 'string'
      ? payload.assignedClientId.trim()
      : ''
  if (!assignedClientId) {
    return json({ error: "L'identifiant de l'assignation est requis." }, 400)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ error: 'Configuration Supabase manquante.' }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${getBearerToken(request)}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: assignment, error: assignmentError } = await supabase
    .from('assigned_clients')
    .select('id, first_name, last_name, email, professional_id, is_active, canceled_at')
    .eq('id', assignedClientId)
    .limit(1)
    .maybeSingle()
  if (assignmentError) return json({ error: assignmentError.message }, 500)
  if (!assignment) return json({ error: 'Assignation introuvable.' }, 404)
  if (assignment.canceled_at) return json({ error: 'Cette assignation est annulée.' }, 409)
  if (assignment.is_active !== true) {
    return json({ error: 'Le service pris doit être confirmé avant cet envoi.' }, 409)
  }

  const clientEmail = assignment.email?.trim() ?? ''
  if (!clientEmail) return json({ error: 'Le courriel du client est manquant.' }, 400)
  if (!assignment.professional_id) {
    return json({ error: 'Le professionnel associé est introuvable.' }, 404)
  }

  const { data: professional, error: professionalError } = await supabase
    .from('profiles')
    .select('full_name, email, professional_phone, role')
    .eq('id', assignment.professional_id)
    .limit(1)
    .maybeSingle()
  if (professionalError) return json({ error: professionalError.message }, 500)
  if (professional?.role !== 'professionnel') {
    return json({ error: 'Profil professionnel introuvable.' }, 404)
  }

  const professionalName = professional.full_name?.trim() || 'Votre professionnel'
  const professionalEmail = professional.email?.trim() ?? ''
  const professionalPhone = professional.professional_phone?.trim() ?? ''
  if (!professionalEmail) {
    return json({ error: 'Le courriel du professionnel est manquant.' }, 400)
  }
  if (!professionalPhone) {
    return json({ error: 'Le téléphone du professionnel est manquant.' }, 400)
  }

  const { data: existingAudit } = await supabase
    .from('audit_logs')
    .select('id')
    .eq('action', 'service_taken_confirmation_email_sent')
    .eq('entity_type', 'assigned_client')
    .eq('entity_id', assignedClientId)
    .limit(1)
    .maybeSingle()
  if (existingAudit) {
    return json({ skipped: true, reason: 'deja_envoye' }, 200)
  }

  const clientFirstName = assignment.first_name?.trim() || 'Bonjour'
  const subject = 'Confirmation de votre rendez-vous – Clinique PsychoÉducAction'
  const text = [
    `Bonjour ${clientFirstName},`,
    '',
    `Nous vous confirmons qu’un rendez-vous a été réservé avec ${professionalName} dans le cadre de votre demande de service auprès de la Clinique PsychoÉducAction.`,
    '',
    'Coordonnées de votre professionnel :',
    '',
    `Nom : ${professionalName}`,
    `Courriel : ${professionalEmail}`,
    `Téléphone : ${professionalPhone}`,
    '',
    'Votre professionnel est en copie conforme de ce courriel afin de faciliter vos communications concernant le rendez-vous.',
    '',
    'Important : pour les rencontres en présentiel à nos bureaux, merci de vous présenter à l’heure exacte de votre rendez-vous.',
    'Le professionnel vous ouvrira la porte à l’heure prévue.',
    'Si vous arrivez en avance, nous vous invitons à patienter dans votre voiture ou à l’extérieur du bâtiment jusqu’à l’heure de votre rendez-vous.',
    '',
    'Merci!',
    '',
    'Clinique PsychoÉducAction',
    'Tél. : (438) 500-1388',
    'Courriel : contact@psychoeducaction.com',
    'www.psychoeducaction.com',
  ].join('\n')

  try {
    await sendResendEmail({
      to: clientEmail,
      cc: [professionalEmail],
      subject,
      text,
    })
  } catch (caughtError) {
    return json(
      {
        error:
          caughtError instanceof Error
            ? caughtError.message
            : 'Le courriel de confirmation n’a pas pu être envoyé.',
      },
      500
    )
  }

  const actor = directionResult.context
  try {
    await supabase.from('audit_logs').insert({
      actor_profile_id: actor.user.id,
      actor_name: actor.profile.full_name ?? actor.profile.email ?? actor.user.email ?? null,
      actor_role: actor.profile.role,
      action: 'service_taken_confirmation_email_sent',
      entity_type: 'assigned_client',
      entity_id: assignedClientId,
      description: `Confirmation de rendez-vous envoyée à ${assignment.first_name ?? ''} ${assignment.last_name ?? ''}.`.trim(),
      metadata: {
        assigned_client_id: assignedClientId,
        client_name: `${assignment.first_name ?? ''} ${assignment.last_name ?? ''}`.trim() || null,
        recipient_email: clientEmail,
        cc_email: professionalEmail,
        professional_id: assignment.professional_id,
        professional_name: professionalName,
      },
    })
  } catch (auditError) {
    console.error('[service-taken-confirmation] Audit impossible:', auditError)
  }

  return json({
    success: true,
    recipient: clientEmail,
    cc: professionalEmail,
  }, 200)
}
