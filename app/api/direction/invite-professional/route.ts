import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

type InviteProfessionalBody = {
  full_name?: unknown
  email?: unknown
  professional_title?: unknown
  professional_phone?: unknown
  professional_license_number?: unknown
}

function jsonResponse(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeName(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalText(value: unknown) {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''

  return normalizedValue || null
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''

  if (!authorization.toLowerCase().startsWith('bearer ')) return ''

  return authorization.slice('bearer '.length).trim()
}

function isAlreadyExistingUserError(message: string) {
  const normalizedMessage = message.toLowerCase()

  return (
    normalizedMessage.includes('already') ||
    normalizedMessage.includes('registered') ||
    normalizedMessage.includes('exists')
  )
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

  if (!appUrl) {
    return jsonResponse(
      { error: 'NEXT_PUBLIC_APP_URL est requis pour générer le lien invitation.' },
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

  let body: InviteProfessionalBody

  try {
    body = (await request.json()) as InviteProfessionalBody
  } catch {
    return jsonResponse({ error: 'Body JSON invalide.' }, 400)
  }

  const fullName = normalizeName(body.full_name)
  const email = normalizeEmail(body.email)
  const professionalTitle = normalizeOptionalText(body.professional_title)
  const professionalPhone = normalizeOptionalText(body.professional_phone)
  const professionalLicenseNumber = normalizeOptionalText(
    body.professional_license_number
  )

  if (!fullName) {
    return jsonResponse({ error: 'Le nom complet est requis.' }, 400)
  }

  if (!email || !isValidEmail(email)) {
    return jsonResponse({ error: 'Le courriel est invalide.' }, 400)
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
  const { data: invitationData, error: invitationError } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: fullName,
        role: 'professionnel',
      },
      redirectTo,
    })

  if (invitationError) {
    return jsonResponse(
      { error: invitationError.message },
      isAlreadyExistingUserError(invitationError.message) ? 409 : 500
    )
  }

  const invitedUserId = invitationData.user?.id

  if (!invitedUserId) {
    return jsonResponse(
      { error: "Supabase n'a pas retourné l'identifiant du professionnel invité." },
      500
    )
  }

  const { error: upsertProfileError } = await supabaseAdmin
    .from('profiles')
    .upsert(
      {
        id: invitedUserId,
        full_name: fullName,
        email,
        role: 'professionnel',
        professional_title: professionalTitle,
        professional_phone: professionalPhone,
        professional_license_number: professionalLicenseNumber,
      },
      { onConflict: 'id' }
    )

  if (upsertProfileError) {
    return jsonResponse({ error: upsertProfileError.message }, 500)
  }

  return jsonResponse(
    {
      success: true,
      user_id: invitedUserId,
      email,
    },
    201
  )
}
