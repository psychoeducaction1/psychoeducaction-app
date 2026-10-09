import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { sendResendEmail } from '@/lib/resendEmail'

export const dynamic = 'force-dynamic'

const TEST_RECIPIENT = 'hicham.boukili.psychoeducaction@outlook.com'
const PREFERENCES_URL = 'https://app.psychoeducaction.com/professionnel/preferences'
const SUBJECT = 'Nouvelle section de préférences sur la plateforme d’assignation'
const CAMPAIGN_KEY = 'professional_preferences_announcement_2026_10'
const EXPECTED_RECIPIENT_COUNT = 20
const EXCLUDED_EMAILS = new Set([
  'nancy.alkayal.pea@outlook.com',
  'sylvainturgeon@videotron.ca',
])
const NO_LINK_EMAILS = new Set([
  'megan.dallaire.pea@outlook.com',
  'roxanne.bouchard.pea@outlook.com',
])

type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
}

type CampaignAuditRow = {
  metadata: {
    recipient_email?: unknown
  } | null
}

function buildMessage(includeLink: boolean) {
  const linkText = includeLink
    ? `\nAccéder directement à mes préférences : ${PREFERENCES_URL}\n`
    : ''
  const text = `Bonjour à toutes et à tous,

J’espère que vous allez bien !

Nous souhaitons vous informer qu’une petite nouveauté a été ajoutée à notre plateforme d’assignation afin de faciliter l’attribution des nouveaux clients en fonction de vos préférences et de vos champs de pratique.

Vous avez maintenant la possibilité de préciser plusieurs éléments dans votre profil, notamment :

- Les clientèles et les groupes d’âge auprès desquels vous souhaitez intervenir ;
- Les services offerts et vos modalités de consultation ;
- Vos bureaux et lieux de pratique ;
- Vos motifs de consultation et champs d’intérêt clinique ;
- Vos exclusions ou limites cliniques ;
- Toute autre précision pertinente pour l’assignation des clients.

Nous avons déjà pris soin de remplir ces informations pour la majorité d’entre vous, selon les renseignements dont nous disposions.

Nous vous invitons donc simplement à vous connecter à la plateforme afin de vérifier vos préférences et, au besoin, d’ajouter, de modifier ou de retirer certains éléments pour que votre profil reflète bien votre pratique actuelle.
${linkText}
L’objectif est de nous permettre de vous proposer des dossiers qui correspondent davantage à vos intérêts, à votre expertise et à vos préférences cliniques, tout en facilitant le processus d’assignation.

Merci à toutes et à tous de prendre quelques minutes pour effectuer cette vérification !

Bonne journée,

L’équipe de la Clinique PsychoÉducAction`

  const linkHtml = includeLink
    ? `<p style="margin:24px 0"><a href="${PREFERENCES_URL}" style="display:inline-block;background:#915b35;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Accéder directement à mes préférences</a></p>`
    : ''
  const html = `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:680px">
    <p>Bonjour à toutes et à tous,</p>
    <p>J’espère que vous allez bien !</p>
    <p>Nous souhaitons vous informer qu’une petite nouveauté a été ajoutée à notre <strong>plateforme d’assignation</strong> afin de faciliter l’attribution des nouveaux clients en fonction de vos préférences et de vos champs de pratique.</p>
    <p>Vous avez maintenant la possibilité de préciser plusieurs éléments dans votre profil, notamment :</p>
    <ul>
      <li>Les clientèles et les groupes d’âge auprès desquels vous souhaitez intervenir ;</li>
      <li>Les services offerts et vos modalités de consultation ;</li>
      <li>Vos bureaux et lieux de pratique ;</li>
      <li>Vos motifs de consultation et champs d’intérêt clinique ;</li>
      <li>Vos exclusions ou limites cliniques ;</li>
      <li>Toute autre précision pertinente pour l’assignation des clients.</li>
    </ul>
    <p><strong>Nous avons déjà pris soin de remplir ces informations pour la majorité d’entre vous</strong>, selon les renseignements dont nous disposions.</p>
    <p>Nous vous invitons donc simplement à vous connecter à la plateforme afin de <strong>vérifier vos préférences et, au besoin, d’ajouter, de modifier ou de retirer certains éléments</strong> pour que votre profil reflète bien votre pratique actuelle.</p>
    ${linkHtml}
    <p>L’objectif est de nous permettre de vous proposer des dossiers qui correspondent davantage à vos intérêts, à votre expertise et à vos préférences cliniques, tout en facilitant le processus d’assignation.</p>
    <p>Merci à toutes et à tous de prendre quelques minutes pour effectuer cette vérification !</p>
    <p>Bonne journée,</p>
    <p><strong>L’équipe de la Clinique PsychoÉducAction</strong></p>
  </div>`

  return { text, html }
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET est manquant.' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null
  if (body?.mode !== 'test' && body?.mode !== 'send') {
    return NextResponse.json(
      { error: 'Le mode doit être « test » ou « send ».' },
      { status: 400 }
    )
  }

  const admin = getSupabaseAdmin()

  if (body.mode === 'send') {
    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'professionnel')
      .eq('is_active', true)
      .order('full_name', { ascending: true })

    if (profilesError) {
      return NextResponse.json({ error: profilesError.message }, { status: 500 })
    }

    const recipients = ((profiles ?? []) as ProfileRow[]).filter((profile) => {
      const email = profile.email?.trim().toLowerCase()
      return Boolean(email) && !EXCLUDED_EMAILS.has(email!)
    })

    if (recipients.length !== EXPECTED_RECIPIENT_COUNT) {
      return NextResponse.json(
        {
          error: `Envoi annulé : ${recipients.length} destinataires trouvés au lieu de ${EXPECTED_RECIPIENT_COUNT}.`,
          recipients: recipients.map((profile) => profile.full_name),
        },
        { status: 409 }
      )
    }

    const { data: previousAuditRows, error: previousAuditError } = await admin
      .from('audit_logs')
      .select('metadata')
      .eq('action', 'professional_preferences_announcement_recipient_sent')
      .contains('metadata', { campaign_key: CAMPAIGN_KEY })

    if (previousAuditError) {
      return NextResponse.json({ error: previousAuditError.message }, { status: 500 })
    }

    const alreadySent = new Set(
      ((previousAuditRows ?? []) as CampaignAuditRow[])
        .map((row) => row.metadata?.recipient_email)
        .filter((email): email is string => typeof email === 'string')
        .map((email) => email.toLowerCase())
    )
    const sent: string[] = []
    const skipped: string[] = []
    const failed: Array<{ recipient: string; error: string }> = []

    for (const recipient of recipients) {
      const email = recipient.email!.trim().toLowerCase()
      if (alreadySent.has(email)) {
        skipped.push(email)
        continue
      }

      const includeLink = !NO_LINK_EMAILS.has(email)
      const message = buildMessage(includeLink)

      try {
        await sendResendEmail({
          to: email,
          subject: SUBJECT,
          text: message.text,
          html: message.html,
        })

        const { error: auditError } = await admin.from('audit_logs').insert({
          actor_profile_id: null,
          actor_name: 'Envoi automatique des préférences professionnelles',
          actor_role: null,
          action: 'professional_preferences_announcement_recipient_sent',
          entity_type: 'profile',
          entity_id: recipient.id,
          description: `Annonce des préférences envoyée à ${recipient.full_name ?? email}.`,
          metadata: {
            campaign_key: CAMPAIGN_KEY,
            recipient_email: email,
            include_preferences_link: includeLink,
          },
        })

        if (auditError) throw auditError
        sent.push(email)
      } catch (error) {
        failed.push({
          recipient: email,
          error: error instanceof Error ? error.message : 'Erreur inconnue.',
        })
      }
    }

    return NextResponse.json(
      {
        success: failed.length === 0,
        mode: 'send',
        sentCount: sent.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
        sent,
        skipped,
        failed,
      },
      { status: failed.length === 0 ? 200 : 207 }
    )
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'professionnel')
    .eq('is_active', true)
    .ilike('email', TEST_RECIPIENT)
    .limit(1)
    .maybeSingle()

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }
  const recipient = profile as ProfileRow | null
  if (!recipient?.email) {
    return NextResponse.json({ error: 'Hicham Boukili est introuvable.' }, { status: 404 })
  }

  const message = buildMessage(true)
  await sendResendEmail({
    to: recipient.email,
    subject: `[TEST] ${SUBJECT}`,
    text: message.text,
    html: message.html,
  })

  return NextResponse.json({
    success: true,
    mode: 'test',
    recipient: recipient.email,
  })
}
