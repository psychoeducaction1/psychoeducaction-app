import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { getFirstName } from '@/lib/satisfaction'

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

/**
 * GET /api/satisfaction/respond?token=…
 * Public (jeton unique) : retourne le prénom du destinataire et indique
 * si le sondage a déjà été rempli. Aucun accès direct à la base :
 * la clé service-role est utilisée côté serveur après validation du jeton.
 */
export async function GET(request: NextRequest) {
  const token = (request.nextUrl.searchParams.get('token') ?? '').trim()

  if (!token) {
    return jsonResponse({ error: 'Jeton manquant.' }, 400)
  }

  const supabaseAdmin = getSupabaseAdmin()

  const { data: eligible, error } = await supabaseAdmin
    .from('satisfaction_eligibles')
    .select('id, destinataire_nom')
    .eq('jeton_reponse', token)
    .maybeSingle()

  if (error) {
    return jsonResponse({ error: error.message }, 500)
  }

  if (!eligible) {
    return jsonResponse({ error: 'Lien invalide ou expiré.' }, 404)
  }

  const { data: existing } = await supabaseAdmin
    .from('satisfaction_reponses')
    .select('id')
    .eq('eligible_id', eligible.id)
    .maybeSingle()

  return jsonResponse(
    {
      prenom: getFirstName(eligible.destinataire_nom),
      alreadyResponded: Boolean(existing),
    },
    200
  )
}

/**
 * POST /api/satisfaction/respond
 * Public (jeton unique) : enregistre la réponse au sondage. Une seule
 * réponse par client éligible.
 */
export async function POST(request: NextRequest) {
  let body: { token?: unknown; note?: unknown; commentaire?: unknown }

  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const note = typeof body.note === 'number' ? body.note : NaN
  const commentaire =
    typeof body.commentaire === 'string' ? body.commentaire.trim() : ''

  if (!token) {
    return jsonResponse({ error: 'Jeton manquant.' }, 400)
  }

  if (!Number.isInteger(note) || note < 1 || note > 5) {
    return jsonResponse({ error: 'La note doit être entre 1 et 5.' }, 400)
  }

  const supabaseAdmin = getSupabaseAdmin()

  const { data: eligible, error } = await supabaseAdmin
    .from('satisfaction_eligibles')
    .select('id')
    .eq('jeton_reponse', token)
    .maybeSingle()

  if (error) {
    return jsonResponse({ error: error.message }, 500)
  }

  if (!eligible) {
    return jsonResponse({ error: 'Lien invalide ou expiré.' }, 404)
  }

  const { data: existing } = await supabaseAdmin
    .from('satisfaction_reponses')
    .select('id')
    .eq('eligible_id', eligible.id)
    .maybeSingle()

  if (existing) {
    return jsonResponse(
      { error: 'Vous avez déjà répondu à ce sondage. Merci !' },
      409
    )
  }

  const { error: insertError } = await supabaseAdmin
    .from('satisfaction_reponses')
    .insert({
      eligible_id: eligible.id,
      note,
      commentaire: commentaire || null,
    })

  if (insertError) {
    // Course entre deux soumissions simultanées : la contrainte d'unicité
    // protège contre les doublons.
    if (insertError.code === '23505') {
      return jsonResponse(
        { error: 'Vous avez déjà répondu à ce sondage. Merci !' },
        409
      )
    }
    return jsonResponse({ error: insertError.message }, 500)
  }

  return jsonResponse({ success: true }, 200)
}
