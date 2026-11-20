export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  return Response.json({ error: 'La synthèse des PDF est désactivée. Le PDF demeure l’archive de référence.' },
    { status: 410, headers: { 'Cache-Control': 'private, no-store' } })
}
