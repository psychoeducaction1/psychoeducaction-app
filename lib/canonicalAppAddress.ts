const oldApplicationHost = 'psychoeducaction-app.vercel.app'
const applicationOrigin = 'https://app.psychoeducaction.com'

/** Navigation only: existing APIs, scheduled jobs and writes keep their contract.
 * An alternate address never becomes an additional authorized clinical origin.
 */
export function canonicalAppAddress(url: string, method: string, controlled: boolean): string | null {
  if (!controlled || !['GET', 'HEAD'].includes(method)) return null
  const source = new URL(url)
  if (source.hostname !== oldApplicationHost || source.username || source.password) return null
  if (source.pathname === '/api' || source.pathname.startsWith('/api/')
    || source.pathname === '/_next' || source.pathname.startsWith('/_next/')) return null
  const destination = new URL(applicationOrigin)
  destination.pathname = source.pathname
  destination.search = source.search
  destination.hash = source.hash
  return destination.href
}
