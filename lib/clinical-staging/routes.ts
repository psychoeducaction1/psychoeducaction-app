/** This deployment contains legacy pages too; only the clinical lab is exposed. */
export function stagingRouteAllowed(pathname: string): boolean {
  if (pathname === '/' || pathname.startsWith('/_next/')
    || pathname === '/api/cron/clinical-assignment-reminders'
    || ['/favicon.ico', '/favicon-16x16.png', '/favicon-32x32.png', '/apple-touch-icon.png',
      '/android-chrome-192x192.png', '/android-chrome-512x512.png', '/site.webmanifest',
      '/psychoeducaction-logo.svg'].includes(pathname)) return true
  return [
    '/connexion', '/auth/invitation', '/auth/reinitialisation', '/clinique', '/administration',
    '/api/lab-auth', '/api/clinical-workspace', '/api/clinical-calendar', '/api/clinical-billing',
  ].some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
