import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

type ResendProfessionalAccessBody = {
  professionalId?: unknown
  email?: unknown
}

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''

  if (!authorization.toLowerCase().startsWith('bearer ')) return ''

  return authorization.slice('bearer '.length).trim()
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(
      { error: 'Configuration Supabase publique manquante côté serveur.' },
      500
    )
  }

  const accessToken = getBearerToken(request)

  if (!accessToken) {
    return jsonResponse({ error: 'Non autorisé.' }, 401)
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
    data: { user: currentUser },
    error: userError,
  } = await supabaseServer.auth.getUser()

  if (userError || !currentUser) {
    return jsonResponse({ error: 'Utilisateur connecté introuvable.' }, 401)
  }

  const { data: currentProfile, error: profileError } = await supabaseServer
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .limit(1)
    .maybeSingle()

  if (profileError) {
    return jsonResponse({ error: profileError.message }, 500)
  }

  if (currentProfile?.role !== 'direction') {
    return jsonResponse({ error: 'Accès réservé à la direction.' }, 403)
  }

  let body: ResendProfessionalAccessBody

  try {
    body = (await request.json()) as ResendProfessionalAccessBody
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const professionalId = normalizeId(body.professionalId)
  const email = normalizeEmail(body.email)

  if (!professionalId && !email) {
    return jsonResponse(
      { error: "L'identifiant ou le courriel du professionnel est requis." },
      400
    )
  }

  if (email && !isValidEmail(email)) {
    return jsonResponse({ error: 'Le courriel est invalide.' }, 400)
  }

  let profileQuery = supabaseServer
    .from('profiles')
    .select('id, email, role, is_active, platform_access_enabled')
    .eq('role', 'professionnel')

  if (professionalId) {
    profileQuery = profileQuery.eq('id', professionalId)
  } else {
    profileQuery = profileQuery.eq('email', email)
  }

  const { data: professionalProfile, error: professionalProfileError } =
    await profileQuery.limit(1).maybeSingle()

  if (professionalProfileError) {
    return jsonResponse({ error: professionalProfileError.message }, 500)
  }

  if (!professionalProfile?.email) {
    return jsonResponse({ error: 'Profil professionnel introuvable.' }, 404)
  }

  if (professionalProfile.platform_access_enabled === false) {
    return jsonResponse(
      { error: "L'accès plateforme est désactivé pour ce professionnel." },
      400
    )
  }

  let supabaseAdmin

  try {
    supabaseAdmin = getSupabaseAdmin()
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Configuration Supabase admin invalide.',
      },
      500
    )
  }

  const redirectTo = `${appUrl.replace(/\/$/, '')}/auth/invitation`
  const { error: resendError } =
    await supabaseAdmin.auth.resetPasswordForEmail(professionalProfile.email, {
      redirectTo,
    })

  if (resendError) {
    return jsonResponse({ error: resendError.message }, 500)
  }

  return jsonResponse(
    {
      success: true,
      email: professionalProfile.email,
      is_active: professionalProfile.is_active,
    },
    200
  )
}
