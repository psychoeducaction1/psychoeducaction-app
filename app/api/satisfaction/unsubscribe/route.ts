import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

function htmlPage(title: string, message: string, actionHtml = '') {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body style="margin:0;font-family:system-ui,-apple-system,sans-serif;background:#fbf7f1;color:#332820;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;">
<main style="max-width:520px;background:#fffdf9;border:1px solid #eadfd2;border-radius:20px;padding:32px;text-align:center;box-shadow:0 8px 24px rgba(109,63,31,0.08);">
<h1 style="font-size:20px;color:#6d3f1f;margin:0 0 12px;">${title}</h1>
<p style="font-size:15px;line-height:1.6;margin:0;">${message}</p>
${actionHtml}
<p style="font-size:13px;color:#8a6f5d;margin:16px 0 0;">Clinique PsychoÉducAction — www.psychoeducaction.com</p>
</main>
</body>
</html>`
}

/**
 * GET /api/satisfaction/unsubscribe?token=…
 * Affiche seulement une confirmation. Les scanners de liens des services de
 * courriel peuvent ainsi ouvrir la page sans désabonner la personne.
 */
export async function GET(request: NextRequest) {
  const token = (request.nextUrl.searchParams.get('token') ?? '').trim()

  if (!token) {
    return new NextResponse(
      htmlPage('Lien invalide', 'Ce lien de désabonnement est invalide.'),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data: eligible, error } = await supabaseAdmin
    .from('satisfaction_eligibles')
    .select('id')
    .eq('jeton_desabonnement', token)
    .maybeSingle()

  if (error || !eligible) {
    return new NextResponse(
      htmlPage(
        'Lien invalide',
        'Ce lien de désabonnement est invalide ou a expiré.'
      ),
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  return new NextResponse(
    htmlPage(
      'Confirmer le désabonnement',
      "Cette option concerne uniquement les futurs courriels de sondage de satisfaction.",
      `<form method="post" style="margin-top:20px;"><input type="hidden" name="token" value="${token}"/><button type="submit" style="border:0;border-radius:10px;background:#9b6a3d;color:white;padding:12px 18px;font-weight:600;cursor:pointer;">Confirmer le désabonnement</button></form>`
    ),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

/** POST : applique le désabonnement après l'action explicite de la personne. */
export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const token = String(formData.get('token') ?? '').trim()

  if (!token) {
    return new NextResponse(
      htmlPage('Lien invalide', 'Ce lien de désabonnement est invalide.'),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data: eligible, error } = await supabaseAdmin
    .from('satisfaction_eligibles')
    .select('id, client_nom_normalise, destinataire_email, statut')
    .eq('jeton_desabonnement', token)
    .maybeSingle()

  if (error || !eligible) {
    return new NextResponse(
      htmlPage('Lien invalide', 'Ce lien de désabonnement est invalide ou a expiré.'),
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  const { error: upsertError } = await supabaseAdmin
    .from('satisfaction_desabonnes')
    .upsert(
      {
        nom_normalise: eligible.client_nom_normalise,
        email: eligible.destinataire_email,
      },
      { onConflict: 'nom_normalise' }
    )

  if (upsertError) {
    return new NextResponse(
      htmlPage('Erreur', 'Une erreur est survenue. Veuillez réessayer plus tard.'),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }

  if (eligible.statut !== 'desabonne') {
    await supabaseAdmin
      .from('satisfaction_eligibles')
      .update({ statut: 'desabonne' })
      .eq('id', eligible.id)
  }

  return new NextResponse(
    htmlPage(
      'Désabonnement confirmé',
      "C'est noté : vous ne recevrez plus d'invitations au sondage de satisfaction de la Clinique PsychoÉducAction."
    ),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}
