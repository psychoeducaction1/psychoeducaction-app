import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendResendEmail } from '@/lib/resendEmail'

type RequestBody = { assignmentProcessId?: unknown }

function response(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length).trim()
    : ''
}

function normalizeEmails(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    )
  )
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return response({ error: 'Configuration Supabase manquante.' }, 500)
  }

  const token = getBearerToken(request)
  if (!token) return response({ error: 'Non autorisé.' }, 401)

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return response({ error: 'Utilisateur introuvable.' }, 401)

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .limit(1)
    .maybeSingle()
  if (profileError) return response({ error: profileError.message }, 500)
  if (profile?.role !== 'direction') {
    return response({ error: 'Accès réservé à la direction.' }, 403)
  }

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return response({ error: 'Body JSON invalide.' }, 400)
  }
  const processId =
    typeof body.assignmentProcessId === 'string'
      ? body.assignmentProcessId.trim()
      : ''
  if (!processId) return response({ error: 'La démarche est requise.' }, 400)

  const { data: assignmentProcess, error: processError } = await supabase
    .from('assignment_processes')
    .select('id, waiting_list_client_id, status')
    .eq('id', processId)
    .limit(1)
    .maybeSingle()
  if (processError) return response({ error: processError.message }, 500)
  if (!assignmentProcess) return response({ error: 'Démarche introuvable.' }, 404)
  if (['assigned', 'classified', 'returned'].includes(assignmentProcess.status)) {
    return response({ error: 'Cette démarche est déjà terminée.' }, 409)
  }
  if (
    !['no_response', 'voicemail_left', 'text_sent', 'email_sent', 'text_email_sent'].includes(
      assignmentProcess.status
    )
  ) {
    return response(
      { error: 'Sélectionnez d’abord le statut « Aucune réponse ».' },
      409
    )
  }

  const { data: client, error: clientError } = await supabase
    .from('waiting_list_clients')
    .select('id, client_name, contact_email, contact_emails')
    .eq('id', assignmentProcess.waiting_list_client_id)
    .limit(1)
    .maybeSingle()
  if (clientError) return response({ error: clientError.message }, 500)
  if (!client) return response({ error: 'Client introuvable.' }, 404)

  const recipient = normalizeEmails([
    client.contact_email,
    client.contact_emails,
  ])[0]
  if (!recipient) {
    return response({ error: 'Aucun courriel client n’est disponible.' }, 400)
  }

  const firstName = client.client_name?.trim().split(/\s+/)[0] || 'Bonjour'
  const subject = 'Nous avons tenté de vous joindre – Clinique PsychoÉducAction'
  const text = [
    `Bonjour ${firstName},`,
    '',
    'Nous avons tenté de vous joindre concernant votre demande de service auprès de la Clinique PsychoÉducAction, mais nous n’avons pas réussi à vous parler.',
    '',
    'Un professionnel est actuellement disponible pour vous offrir le service. Veuillez nous rappeler au (438) 500-1388 afin que nous puissions finaliser votre assignation et planifier votre premier rendez-vous.',
    '',
    'Nos heures d’ouverture sont du lundi au vendredi, de 8 h à 18 h 30, ainsi que le samedi, de 12 h à 16 h.',
    '',
    'Merci,',
    'Clinique PsychoÉducAction',
    '(438) 500-1388',
    'contact@psychoeducaction.com',
  ].join('\n')

  try {
    await sendResendEmail({ to: recipient, subject, text })
  } catch (error) {
    return response(
      { error: error instanceof Error ? error.message : 'Envoi impossible.' },
      500
    )
  }

  const sentAt = new Date().toISOString()
  const { data: textEvents } = await supabase
    .from('assignment_process_events')
    .select('id')
    .eq('assignment_process_id', processId)
    .eq('event_type', 'contact_attempt')
    .eq('contact_method', 'text')
    .limit(1)
  const nextStatus = textEvents?.length ? 'text_email_sent' : 'email_sent'

  const { error: eventError } = await supabase
    .from('assignment_process_events')
    .insert({
      assignment_process_id: processId,
      event_type: 'contact_attempt',
      status: nextStatus,
      contact_method: 'email',
      note: `Courriel de tentative de contact envoyé à ${recipient}.`,
      actor_profile_id: user.id,
      actor_name: profile.full_name ?? profile.email ?? user.email ?? 'Direction',
      created_at: sentAt,
    })
  if (eventError) return response({ error: eventError.message }, 500)

  const { error: updateError } = await supabase
    .from('assignment_processes')
    .update({ status: nextStatus })
    .eq('id', processId)
  if (updateError) return response({ error: updateError.message }, 500)

  try {
    await supabase.from('audit_logs').insert({
      actor_profile_id: user.id,
      actor_name: profile.full_name ?? profile.email ?? user.email ?? null,
      actor_role: profile.role,
      action: 'assignment_process_client_email_sent',
      entity_type: 'assignment_process',
      entity_id: processId,
      description: `Courriel de tentative de contact envoyé à ${client.client_name ?? 'un client'}.`,
      metadata: {
        assignment_process_id: processId,
        waiting_list_client_id: client.id,
        client_name: client.client_name,
        recipient_email: recipient,
      },
    })
  } catch (error) {
    console.error('[assignment-process-client-email] Audit impossible:', error)
  }

  return response({ success: true, recipient, status: nextStatus, sentAt }, 200)
}
