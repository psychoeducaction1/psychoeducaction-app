import { NextRequest, NextResponse } from 'next/server'
import { getClinicalNotesContext } from '@/lib/clinicalNotesServer'
import { CLINICAL_AUDIO_MAX_BYTES, CLINICAL_TRANSCRIPT_MAX_CHARS } from '@/lib/clinicalNotesAi'
import { ClinicalNotesAiError, generateClinicalDemo, isClinicalNotesAiEnabled, readClinicalNotesBody, transcribeClinicalDemo } from '@/lib/clinicalNotesAiServer'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }

export async function POST(request: NextRequest) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers })
  const context = await getClinicalNotesContext(request)
  if (context.error) return reply({ error: context.error.message }, context.error.status)
  if (!isClinicalNotesAiEnabled()) return reply({ error: 'L’essai IA n’est pas encore activé côté serveur.' }, 503)
  try {
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.startsWith('multipart/form-data;')) {
      const body = await readClinicalNotesBody(request, CLINICAL_AUDIO_MAX_BYTES + 65_536)
      const form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData()
      if (form.get('fictional') !== 'true') return reply({ error: 'Confirmez que cet extrait est entièrement fictif.' }, 400)
      const file = form.get('audio')
      if (!(file instanceof File)) return reply({ error: 'Fichier audio manquant.' }, 400)
      return reply({ transcript: await transcribeClinicalDemo(file) })
    }
    if (!contentType.startsWith('application/json')) return reply({ error: 'Format de requête non pris en charge.' }, 415)
    const body = JSON.parse((await readClinicalNotesBody(request, 80_000)).toString('utf8'))
    if (body.fictional !== true || typeof body.transcript !== 'string' || !body.transcript.trim() || body.transcript.length > CLINICAL_TRANSCRIPT_MAX_CHARS) {
      return reply({ error: 'Une transcription fictive non vide de moins de 16 000 caractères est requise.' }, 400)
    }
    return reply({ draft: await generateClinicalDemo(body.transcript.trim()) })
  } catch (error) {
    if (error instanceof ClinicalNotesAiError) return reply({ error: error.message }, error.status)
    return reply({ error: 'Requête invalide. Aucun nouvel essai automatique.' }, 400)
  }
}
