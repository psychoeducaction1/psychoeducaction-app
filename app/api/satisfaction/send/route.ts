import { NextRequest, NextResponse } from 'next/server'
import { getDirectionContext } from '@/lib/directionServer'
import { sendResendEmail } from '@/lib/resendEmail'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  buildSatisfactionEmail,
  getFirstName,
} from '@/lib/satisfaction'

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getAppUrl() {
  const configured = normalizeText(process.env.NEXT_PUBLIC_APP_URL).replace(
    /\/+$/,
    ''
  )
  return configured || 'https://app.psychoeducaction.com'
}

/**
 * POST /api/satisfaction/send
 * Envoie l'invitation au sondage à UN client éligible, après vérification
 * manuelle par la direction. Chaque envoi est journalisé ; en cas d'échec,
 * l'éligible reste « en_attente » pour une nouvelle tentative.
 */
export async function POST(request: NextRequest) {
  const directionResult = await getDirectionContext(request)

  if (directionResult.error) {
    return jsonResponse(
      { error: directionResult.error.message },
      directionResult.error.status
    )
  }

  const actor = directionResult.context

  let body: { eligibleId?: unknown }

  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const eligibleId = normalizeText(body.eligibleId)

  if (!eligibleId) {
    return jsonResponse({ error: 'eligibleId est requis.' }, 400)
  }

  const supabaseAdmin = getSupabaseAdmin()

  const { data: eligible, error: eligibleError } = await supabaseAdmin
    .from('satisfaction_eligibles')
    .select(
      'id, client_nom, destinataire_nom, destinataire_email, statut, jeton_reponse, jeton_desabonnement'
    )
    .eq('id', eligibleId)
    .maybeSingle()

  if (eligibleError) {
    return jsonResponse({ error: eligibleError.message }, 500)
  }

  if (!eligible) {
    return jsonResponse({ error: 'Éligible introuvable.' }, 404)
  }

  if (eligible.statut !== 'en_attente') {
    return jsonResponse(
      { error: 'Ce client a déjà été traité (envoi, exclusion ou désabonnement).' },
      400
    )
  }

  const recipientEmail = normalizeText(eligible.destinataire_email)

  if (!recipientEmail) {
    return jsonResponse(
      {
        error:
          'Courriel introuvable : complétez le courriel du destinataire avant l’envoi.',
      },
      400
    )
  }

  const appUrl = getAppUrl()
  const lienReponse = `${appUrl}/satisfaction/reponse/${eligible.jeton_reponse}`
  const lienDesabonnement = `${appUrl}/api/satisfaction/unsubscribe?token=${eligible.jeton_desabonnement}`

  const email = buildSatisfactionEmail({
    destinatairePrenom: getFirstName(eligible.destinataire_nom),
    lienReponse,
    lienDesabonnement,
  })

  try {
    await sendResendEmail({
      to: recipientEmail,
      subject: email.subject,
      text: email.text,
      html: email.html,
    })
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Erreur inconnue pendant l'envoi."

    try {
      await supabaseAdmin.from('satisfaction_envois').insert({
        eligible_id: eligible.id,
        destinataire_email: recipientEmail,
        sujet: email.subject,
        statut: 'erreur',
        erreur: errorMessage,
        envoye_par: actor.user.id,
      })

      await supabaseAdmin.from('audit_logs').insert({
        actor_profile_id: actor.user.id,
        actor_name: actor.profile.full_name ?? actor.user.email ?? null,
        actor_role: actor.profile.role,
        action: 'satisfaction_email_failed',
        entity_type: 'satisfaction_eligible',
        entity_id: eligible.id,
        description: `Échec d'envoi du sondage à ${eligible.destinataire_nom}.`,
        metadata: {
          eligible_id: eligible.id,
          destinataire_nom: eligible.destinataire_nom,
          destinataire_email: recipientEmail,
          erreur: errorMessage,
        },
      })
    } catch (logError) {
      console.error('[satisfaction-send] Journalisation non bloquante:', {
        message:
          logError instanceof Error ? logError.message : 'Erreur inconnue',
      })
    }

    return jsonResponse({ error: errorMessage }, 500)
  }

  try {
    await supabaseAdmin.from('satisfaction_envois').insert({
      eligible_id: eligible.id,
      destinataire_email: recipientEmail,
      sujet: email.subject,
      statut: 'envoye',
      envoye_par: actor.user.id,
    })

    const { error: updateError } = await supabaseAdmin
      .from('satisfaction_eligibles')
      .update({ statut: 'envoye' })
      .eq('id', eligible.id)

    if (updateError) throw updateError

    await supabaseAdmin.from('audit_logs').insert({
      actor_profile_id: actor.user.id,
      actor_name: actor.profile.full_name ?? actor.user.email ?? null,
      actor_role: actor.profile.role,
      action: 'satisfaction_email_sent',
      entity_type: 'satisfaction_eligible',
      entity_id: eligible.id,
      description: `Sondage de satisfaction envoyé à ${eligible.destinataire_nom}.`,
      metadata: {
        eligible_id: eligible.id,
        client_nom: eligible.client_nom,
        destinataire_nom: eligible.destinataire_nom,
        destinataire_email: recipientEmail,
      },
    })
  } catch (error) {
    console.error('[satisfaction-send] Journalisation non bloquante:', {
      message: error instanceof Error ? error.message : 'Erreur inconnue',
    })
  }

  return jsonResponse({ success: true }, 200)
}
