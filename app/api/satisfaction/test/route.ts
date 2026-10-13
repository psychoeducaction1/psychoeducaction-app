import { NextRequest, NextResponse } from 'next/server'
import { getSuperAdminContext } from '@/lib/superAdminServer'
import { sendResendEmail } from '@/lib/resendEmail'
import { buildSatisfactionEmail, getFirstName } from '@/lib/satisfaction'

export async function POST(request: NextRequest) {
  const actor = await getSuperAdminContext(request)
  if (actor.error) return NextResponse.json({ error: actor.error.message }, { status: actor.error.status })
  const body = await request.json().catch(() => null) as
    { email?: unknown; name?: unknown; professionnel?: unknown; confirm?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : ''
  if (body?.confirm !== true || !name || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Indiquez le nom et une adresse valide, puis confirmez cet envoi test.' }, { status: 400 })
  }
  try {
    const message = buildSatisfactionEmail({ destinatairePrenom: getFirstName(name),
      lienReponse: '', lienDesabonnement: '', test: true,
      testAppUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://app.psychoeducaction.com' })
    await sendResendEmail({ to: email, ...message })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Le courriel test n’a pas pu être envoyé. Réessayez plus tard.' }, { status: 502 })
  }
}
