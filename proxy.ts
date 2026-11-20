import { NextResponse, type NextRequest } from 'next/server'
import { stagingRouteAllowed } from './lib/clinical-staging/routes.ts'
import { canonicalAppAddress } from './lib/canonicalAppAddress.ts'

export function proxy(request: NextRequest) {
  const canonical = canonicalAppAddress(request.url, request.method, process.env.PEA_CONTROLLED_MERGE === 'true')
  if (canonical) return NextResponse.redirect(canonical, 308)
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
