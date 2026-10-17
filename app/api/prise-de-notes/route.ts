import { NextRequest, NextResponse } from 'next/server'
import { getClinicalNotesContext } from '@/lib/clinicalNotesServer'
import { isClinicalNotesAiEnabled } from '@/lib/clinicalNotesAiServer'
import { createDemoSessions } from '@/lib/clinicalNotesDemo'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }

// Lecture du profil avec le JWT utilisateur et les RLS. Aucune cle privilegiee,
// table clinique, sauvegarde, requete IA ou transmission audio dans ce pilote.
export async function GET(request: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers })
  const context = await getClinicalNotesContext(request)
  if (context.error) return reply({ error: context.error.message }, context.error.status)
  return reply({ viewerId: context.user.id, mode: 'demo', sessions: createDemoSessions(), aiEnabled: isClinicalNotesAiEnabled() })
}
