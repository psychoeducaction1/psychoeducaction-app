import { NextResponse, type NextRequest } from 'next/server'
import { stagingRouteAllowed } from './lib/clinical-staging/routes.ts'

export function proxy(request: NextRequest) {
  if (process.env.PEA_CLINICAL_RUNTIME !== 'staging-db') return NextResponse.next()
  const { pathname } = request.nextUrl
  if (!stagingRouteAllowed(pathname)) return new Response(null, { status: 404 })
  if (pathname === '/') {
    // Dashboard invitations target the Site URL. Preserve their query parameters;
    // browsers carry an OAuth fragment across this redirect to the activation page.
    const invitation = new URL('/auth/invitation', request.url)
    invitation.search = request.nextUrl.search
    return NextResponse.redirect(invitation)
  }
  return NextResponse.next()
}
