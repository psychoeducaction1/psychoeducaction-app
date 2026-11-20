import { JsonBodyError, readBoundedJsonObject } from '@/lib/boundedJsonBody'
import { ClinicalError, isClinicalError } from '@/lib/clinical-core/validation'
import { contextOf, localIdentity, localJson, localRpc } from './http'
import { isClinicalNoteType } from '@/lib/clinicalNoteTemplates'

const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x)
export async function handleNoteTemplates(request: Request, segments: string[]): Promise<Response> {
  try {
    const { runtime, token, actor } = await localIdentity(request)
    const context = contextOf(request)
    if (context !== 'clinical' || !actor.capabilities?.includes('practice')) throw new ClinicalError(403,'FORBIDDEN','Ces gabarits sont réservés à votre espace clinique personnel.')
    if (segments.length !== 1 || new URL(request.url).search) throw new ClinicalError(400,'INVALID_INPUT','Chemin de gabarit invalide.')
    if (request.method === 'GET') return localJson(await localRpc(runtime,token,'lab_note_template_query',{p_context:context}))
    if (request.method !== 'POST') return localJson({error:'Méthode non autorisée.'},405)
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new ClinicalError(400,'INVALID_INPUT','Un contenu JSON est requis.')
    const data = await readBoundedJsonObject(request,96*1024)
    if (Object.keys(data).length !== 6 || !['id','expectedVersion','title','noteType','document','archived'].every(key => Object.hasOwn(data,key))
      || !(data.id === null || uuid(data.id)) || !Number.isSafeInteger(data.expectedVersion) || Number(data.expectedVersion) < (data.id === null ? 0 : 1)
      || typeof data.title !== 'string' || !data.title.trim() || data.title.length > 120 || !isClinicalNoteType(data.noteType)
      || typeof data.document !== 'string' || !data.document.trim() || data.document.length > 24000 || typeof data.archived !== 'boolean') throw new ClinicalError(400,'INVALID_INPUT','Vérifiez le titre, le type et le texte du gabarit.')
    const key=request.headers.get('Idempotency-Key')
    if (!uuid(key)) throw new ClinicalError(400,'IDEMPOTENCY_REQUIRED','Une clé de reprise est requise.')
    return localJson(await localRpc(runtime,token,'lab_note_template_command',{p_context:context,p_data:data,p_key:key}),201)
  } catch (cause) {
    if (cause instanceof JsonBodyError) return localJson({error:'Le gabarit dépasse la taille permise.',code:'INVALID_BODY'},cause.status)
    if (isClinicalError(cause)) return localJson({error:cause.message,code:cause.code},cause.status)
    return localJson({error:'Les gabarits personnels sont indisponibles. Votre saisie est conservée.',code:'LOCAL_UNAVAILABLE'},503)
  }
}
