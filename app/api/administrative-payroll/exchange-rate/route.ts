import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdministrativePayrollAuthorized } from '@/lib/payrollAccess'
import { getBearerToken } from '@/lib/superAdminServer'
import { hasPlatformAccess } from '@/lib/platformAccess'

type FrankfurterRate = {
  date?: unknown
  base?: unknown
  quote?: unknown
  rate?: unknown
}

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const accessToken = getBearerToken(request)

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: 'Configuration Supabase publique manquante.' },
      { status: 500 }
    )
  }

  if (!accessToken) {
    return NextResponse.json({ error: 'Non autorise.' }, { status: 401 })
  }

  const supabaseServer = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const {
    data: { user },
    error: authError,
  } = await supabaseServer.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Utilisateur introuvable.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabaseServer
    .from('profiles')
    .select('role, platform_access_enabled, administrative_access')
    .eq('id', user.id)
    .limit(1)
    .maybeSingle()

  if (profileError) return NextResponse.json({ error: 'Impossible de vérifier les droits.' }, { status: 500 })
  if (!hasPlatformAccess(profile) || !isAdministrativePayrollAuthorized({ email: user.email }, profile)) {
    return NextResponse.json({ error: 'Acces refuse.' }, { status: 403 })
  }

  try {
    const response = await fetch(
      'https://api.frankfurter.dev/v2/rate/MAD/CAD',
      { cache: 'no-store' }
    )

    if (!response.ok) {
      throw new Error(`Service de taux indisponible (${response.status}).`)
    }

    const payload = (await response.json()) as FrankfurterRate
    const rate = Number(payload.rate)
    const rateDate = typeof payload.date === 'string' ? payload.date : ''

    if (!Number.isFinite(rate) || rate <= 0 || !rateDate) {
      throw new Error('Taux MAD/CAD invalide.')
    }

    return NextResponse.json({
      rate,
      rateDate,
      source: 'Frankfurter',
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Impossible de recuperer le taux MAD/CAD.',
      },
      { status: 502 }
    )
  }
}
