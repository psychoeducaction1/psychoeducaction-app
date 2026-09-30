import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

const MARKETING_NAME = 'Camille Payette'
const MARKETING_EMAIL = 'camille.payette@psychoeducaction.com'

function response(body: object, status: number) {
  return NextResponse.json(body, { status })
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length).trim()
    : ''
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const accessToken = getBearerToken(request)

  if (!supabaseUrl || !supabaseAnonKey) {
    return response({ error: 'Configuration Supabase publique manquante.' }, 500)
  }
  if (!accessToken) return response({ error: 'Non autorisé.' }, 401)

  const supabaseServer = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userData } = await supabaseServer.auth.getUser()
  if (!userData.user) return response({ error: 'Utilisateur introuvable.' }, 401)

  const { data: currentProfile } = await supabaseServer
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (currentProfile?.role !== 'direction') {
    return response({ error: 'Accès réservé à la direction.' }, 403)
  }

  let admin
  try {
    admin = getSupabaseAdmin()
  } catch (error) {
    return response(
      { error: error instanceof Error ? error.message : 'Configuration Supabase invalide.' },
      500
    )
  }

  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers()
  if (usersError) return response({ error: usersError.message }, 500)

  let marketingUser = usersData.users.find(
    (user) => user.email?.toLowerCase() === MARKETING_EMAIL
  )
  let invitationSent = false

  if (!marketingUser) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(MARKETING_EMAIL, {
      data: { full_name: MARKETING_NAME, role: 'marketing' },
      redirectTo: `${appUrl.replace(/\/$/, '')}/auth/invitation`,
    })
    if (error || !data.user) {
      return response({ error: error?.message ?? "L'invitation n'a pas pu être créée." }, 500)
    }
    marketingUser = data.user
    invitationSent = true
  }

  const { error: profileError } = await admin.from('profiles').upsert(
    {
      id: marketingUser.id,
      full_name: MARKETING_NAME,
      email: MARKETING_EMAIL,
      role: 'marketing',
      platform_access_enabled: true,
    },
    { onConflict: 'id' }
  )
  if (profileError) return response({ error: profileError.message }, 500)

  const { error: staffError } = await admin
    .from('marketing_staff')
    .update({ profile_id: marketingUser.id, is_active: true })
    .eq('email', MARKETING_EMAIL)
  if (staffError) return response({ error: staffError.message }, 500)

  return response(
    {
      success: true,
      invitation_sent: invitationSent,
      message: invitationSent
        ? `Invitation envoyée à ${MARKETING_EMAIL}.`
        : 'Le compte existant a été relié à l’espace marketing.',
    },
    200
  )
}
