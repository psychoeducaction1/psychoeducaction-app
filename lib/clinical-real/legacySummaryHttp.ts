import { realClinicalTransport } from './transport.ts'
import { ClinicalNotesAiError, isClinicalNotesAiEnabled, readClinicalNotesBody, requestClinicalStructured } from '@/lib/clinicalNotesAiServer'
import { summarizeLegacyHistory } from './legacyHistorySummary.ts'
import type { ClinicalStructuredRequester } from '@/lib/clinicalNoteAnalysisServer'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers })

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export async function handleRealLegacySummary(request: Request,
  requester: ClinicalStructuredRequester = requestClinicalStructured): Promise<Response> {
  let stage: 'connection' | 'access' | 'synthesis' = 'connection'
  try {
    if (request.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
      return reply({ error: 'Contenu JSON requis.' }, 400)
    const transport = realClinicalTransport()
    const token = await transport.authenticate(request)
    if (!token) return reply({ error: 'Connexion requise.' }, 401)
    if (process.env.PEA_REAL_AI_SERVER_ENABLED !== 'true' || !isClinicalNotesAiEnabled())
      return reply({ error: 'La synthèse IA n’est pas activée.' }, 503)
    stage = 'access'
    const body: unknown = JSON.parse((await readClinicalNotesBody(request, 90_000)).toString('utf8'))
    if (!object(body) || typeof body.caseId !== 'string' || !uuid.test(body.caseId)
      || typeof body.documentId !== 'string' || !uuid.test(body.documentId)
      || !['part', 'finish'].includes(String(body.action))) return reply({ error: 'Source invalide.' }, 400)
    const [allowed, documents, overview] = await Promise.all([
      transport.rpc('clinical_legacy_import_allowed', { p_case_id: body.caseId }, token),
      transport.rpc('clinical_list_legacy_documents', { p_case_id: body.caseId }, token),
      transport.rpc('clinical_case_overview', { p_case_id: body.caseId }, token),
    ])
    if (allowed !== true || !Array.isArray(documents) || !documents.some(item =>
      object(item) && item.id === body.documentId && typeof item.label === 'string' && item.label.includes('Notes')))
      return reply({ error: 'Archive ou accès indisponible.' }, 403)
    if (!object(overview) || typeof overview.firstName !== 'string' || typeof overview.lastName !== 'string')
      throw new Error('CASE_INVALID')
    stage = 'synthesis'
    const summary = await summarizeLegacyHistory(body, `${overview.firstName} ${overview.lastName}`, requester,
      AbortSignal.any([request.signal, AbortSignal.timeout(240_000)]))
    return reply({ summary })
  } catch (error) {
    if (error instanceof ClinicalNotesAiError) return reply({ error: error.message }, error.status)
    if (error instanceof Error && error.message === 'INVALID_INPUT') return reply({ error: 'Source invalide.' }, 400)
    if (error instanceof Error && error.message === 'SUMMARY_UNGROUNDED')
      return reply({ error: 'La synthèse ne satisfait pas au contrôle de fidélité des notes. Le PDF reste archivé.' }, 422)
    if (error instanceof Error && ['IDENTIFIER_LIMIT', 'IDENTIFIER_REMAINS'].includes(error.message))
      return reply({ error: 'Le masquage des noms et coordonnées a échoué. Aucun texte n’a été envoyé à l’IA.' }, 422)
    const step = stage === 'access' ? 'Vérification du dossier indisponible.'
      : stage === 'synthesis' ? 'Préparation de la synthèse indisponible.'
        : 'Connexion au service clinique indisponible.'
    return reply({ error: `${step} Le PDF reste archivé sans contexte automatique.` }, 503)
  }
}
