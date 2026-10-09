import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { sendResendEmail } from '@/lib/resendEmail'

export const dynamic = 'force-dynamic'

const TEST_RECIPIENT = 'hicham.boukili.psychoeducaction@outlook.com'
const PREFERENCES_URL = 'https://app.psychoeducaction.com/professionnel/preferences'
const SUBJECT = 'Nouvelle section de préférences sur la plateforme d’assignation'

type ProfileRow = {
  full_name: string | null
  email: string | null
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
  if (body?.mode !== 'test') {
    return NextResponse.json(
      { error: 'Seul le mode test est autorisé pour le moment.' },
      { status: 400 }
    )
  }

  const admin = getSupabaseAdmin()
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('full_name, email')
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
