import { JsonBodyError, readBoundedJsonObject } from '../boundedJsonBody.ts'
import { procedureUuid, validProcedureArticle, type ProcedureArticleInput, type ProcedureLibrary } from './model.ts'

export type ProcedureBackend = {
  canEdit: boolean
  homeHref: '/administration' | '/clinique'
  load: () => Promise<ProcedureLibrary>
  saveArticle: (input: ProcedureArticleInput) => Promise<{ id: string; version: number }>
  saveSection: (input: { id: string; title: string; expectedVersion: number }) => Promise<{ id: string; version: number }>
}
export type ProcedureAuthorization = { backend: ProcedureBackend; status?: never; error?: never } | { backend?: never; status: number; error: string }
const reply = (payload: unknown, status = 200) => Response.json(payload, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization' } })

export async function handleProcedureRequest(request: Request, authorize: () => Promise<ProcedureAuthorization>): Promise<Response> {
  try {
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) return reply({ error: 'Origine refusée.' }, 403)
    const auth = await authorize()
    if (!auth.backend) return reply({ error: auth.error }, auth.status)
    const backend = auth.backend
    if (request.method === 'GET') {
      if (new URL(request.url).searchParams.get('access') === '1') return reply({ canRead: true, canEdit: backend.canEdit, homeHref: backend.homeHref })
      return reply(await backend.load())
    }
    if (request.method !== 'POST') return reply({ error: 'Méthode non permise.' }, 405)
    if (!backend.canEdit) return reply({ error: 'La modification des procédures n’est pas autorisée pour ce compte.' }, 403)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return reply({ error: 'Format JSON requis.' }, 415)
    const input = await readBoundedJsonObject(request, 180000)
    if (input.action === 'article.save' && input.data && typeof input.data === 'object' && !Array.isArray(input.data) && Object.keys(input).every(key => ['action', 'data'].includes(key)) && validProcedureArticle(input.data as Record<string, unknown>)) {
      return reply(await backend.saveArticle(input.data as ProcedureArticleInput))
    }
    if (input.action === 'section.save' && input.data && typeof input.data === 'object' && !Array.isArray(input.data) && Object.keys(input).every(key => ['action', 'data'].includes(key))) {
      const data = input.data as Record<string, unknown>
      if (Object.keys(data).every(key => ['id', 'title', 'expectedVersion'].includes(key)) && typeof data.id === 'string' && procedureUuid.test(data.id) && typeof data.title === 'string' && data.title.trim().length > 0 && data.title.length <= 120 && Number.isSafeInteger(data.expectedVersion) && Number(data.expectedVersion) >= 0)
        return reply(await backend.saveSection(data as { id: string; title: string; expectedVersion: number }))
    }
    return reply({ error: 'Vérifiez le titre, la section, le contenu et les mots-clés.' }, 400)
  } catch (cause) {
    if (cause instanceof JsonBodyError) return reply({ error: cause.status === 413 ? 'Le contenu est trop volumineux.' : 'Format JSON invalide.' }, cause.status)
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
    if (code === '42501') return reply({ error: 'L’accès aux procédures a été retiré. Vos changements n’ont pas été enregistrés.' }, 403)
    if (code === '40001' || code === '23505') return reply({ error: 'Cette fiche a été modifiée ailleurs ou cet enregistrement existe déjà. Votre saisie est conservée : rechargez la liste avant de réessayer.' }, 409)
    if (code === '22023' || code === '23503') return reply({ error: 'Vérifiez le contenu et la section choisie.' }, 400)
    return reply({ error: 'Bibliothèque temporairement indisponible. L’enregistrement n’est pas confirmé ; conservez votre saisie et actualisez la liste avant de recommencer.' }, 503)
  }
}
