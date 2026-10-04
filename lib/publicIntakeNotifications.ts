import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { sendResendEmail } from '@/lib/resendEmail'

const ADMIN_EMAIL = 'contact@psychoeducaction.com'
const CLINIC_PHONE = '(438) 500-1388'

function formatAppointmentDate(value: string) {
  return new Intl.DateTimeFormat('fr-CA', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Toronto',
  }).format(new Date(value))
}

export async function notifyPublicIntakeAppointment(appointmentId: string) {
  const supabase = getSupabaseAdmin()
  const { data: claimed } = await supabase
    .from('intake_appointments')
    .update({ notification_claimed_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .is('notification_claimed_at', null)
    .select('id, start_at, prospect_id')
    .maybeSingle()

  if (!claimed) return

  const { data: prospect } = await supabase
    .from('public_intake_prospects')
    .select('first_name, last_name, email, phone')
    .eq('id', claimed.prospect_id)
    .maybeSingle()

  const prospectName = [prospect?.first_name, prospect?.last_name]
    .filter(Boolean)
    .join(' ')

  try {
    if (prospect?.email) {
      await sendResendEmail({
        to: prospect.email,
        subject: 'Confirmation de votre appel avec la Clinique PsychoÉducAction',
        text: [
          `Bonjour ${prospect.first_name?.trim() || ''},`,
          '',
          `Votre appel téléphonique de 15 minutes est réservé pour le ${formatAppointmentDate(claimed.start_at)}.`,
          `Nous communiquerons avec vous au ${prospect.phone || 'numéro indiqué dans votre demande'}.`,
          '',
          `Pour modifier votre demande, contactez-nous au ${CLINIC_PHONE}.`,
          '',
          'Clinique PsychoÉducAction',
        ].join('\n'),
      })
    }

    await sendResendEmail({
      to: ADMIN_EMAIL,
      subject: 'Nouveau rendez-vous téléphonique réservé',
      text: [
        'Un rendez-vous téléphonique a été réservé depuis le site web.',
        '',
        `Prospect : ${prospectName || 'Nom à consulter dans la plateforme'}`,
        `Téléphone : ${prospect?.phone || 'À consulter dans la plateforme'}`,
        `Rendez-vous : ${formatAppointmentDate(claimed.start_at)}`,
        '',
        'Ouvrez le calendrier de la plateforme pour consulter la fiche.',
      ].join('\n'),
    })

    await supabase
      .from('intake_appointments')
      .update({
        confirmation_sent_at: new Date().toISOString(),
        admin_notification_sent_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
  } catch (error) {
    await supabase
      .from('intake_appointments')
      .update({ notification_claimed_at: null })
      .eq('id', appointmentId)
    throw error
  }
}

export async function notifyRapidCallback(prospectId: string) {
  const supabase = getSupabaseAdmin()
  const { data: claimed } = await supabase
    .from('public_intake_prospects')
    .update({ notification_claimed_at: new Date().toISOString() })
    .eq('id', prospectId)
    .is('notification_claimed_at', null)
    .select('id, first_name, last_name, phone, rapid_callback_requested_at')
    .maybeSingle()

  if (!claimed) return

  try {
    await sendResendEmail({
      to: ADMIN_EMAIL,
      subject: `Rappel rapide demandé – ${[claimed.first_name, claimed.last_name].filter(Boolean).join(' ') || 'Nouveau prospect'}`,
      text: [
        'Une demande de rappel rapide prioritaire vient d’être reçue.',
        '',
        `Prospect : ${[claimed.first_name, claimed.last_name].filter(Boolean).join(' ') || 'Nom à consulter dans la plateforme'}`,
        `Téléphone : ${claimed.phone || 'À consulter dans la plateforme'}`,
        claimed.rapid_callback_requested_at
          ? `Demande reçue : ${formatAppointmentDate(claimed.rapid_callback_requested_at)}`
          : '',
        '',
        'La tâche est disponible dans la section Tâches administratives.',
      ].filter(Boolean).join('\n'),
    })
    await supabase
      .from('public_intake_prospects')
      .update({ notification_sent_at: new Date().toISOString() })
      .eq('id', prospectId)
  } catch (error) {
    await supabase
      .from('public_intake_prospects')
      .update({ notification_claimed_at: null })
      .eq('id', prospectId)
    throw error
  }
}
