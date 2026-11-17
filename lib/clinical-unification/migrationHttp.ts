import { JsonBodyError, readBoundedJsonObject } from '../boundedJsonBody.ts'
import { unifiedJson, type UnifiedDomainHandler } from './http.ts'
export const handleMigration: UnifiedDomainHandler = async (request, segments, identity) => {
  if (segments[0] !== 'migration') return null
  if (identity.context !== 'administration') return unifiedJson({error:'Accès réservé aux administrateurs autorisés.'},403)
  // A visible preview must not enable imports through a direct API request.
  if (process.env.PEA_CONTROLLED_MERGE === 'true' && request.method !== 'GET'
    && process.env.PEA_CLINICAL_IMPORT_ENABLED !== 'true') {
    return unifiedJson({error:'Centre en préparation : les imports et les modifications ne sont pas encore activés.'},403)
  }
  try {
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
  if(segments[1]&&!uuid.test(segments[1]))return unifiedJson({error:'Identifiant de lot invalide.'},400)
  const url=new URL(request.url)
  if(url.search || segments.length>5) return unifiedJson({error:'Requête invalide.'},400)
  if(request.method==='GET'&&segments.length===5&&segments[2]==='files') {
    if(!/^[a-f0-9]{64}$/.test(segments[3])||!/^(0|[1-3]?[0-9])$/.test(segments[4]))return unifiedJson({error:'Fragment invalide.'},400)
    return unifiedJson(await identity.transport.rpc('clinical_migration_source_file_part',{p_batch:segments[1],p_sha:segments[3],p_part:Number(segments[4])},identity.token))
  }
  if(request.method==='GET'&&segments.length===4&&segments[2]==='files') {
    if(!/^[a-f0-9]{64}$/.test(segments[3]))return unifiedJson({error:'Empreinte invalide.'},400)
    return unifiedJson(await identity.transport.rpc('clinical_migration_source_file',{p_batch:segments[1],p_sha:segments[3]},identity.token))
  }
  if(request.method==='GET'&&segments.length<=2) return unifiedJson(await identity.transport.rpc('clinical_migration_query',{p_batch:segments[1]??null},identity.token))
  if(request.method!=='POST'||segments.length!==1) return unifiedJson({error:'Requête invalide.'},405)
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')??''))return unifiedJson({error:'JSON requis.'},400)
  const body=await readBoundedJsonObject(request,2*1024*1024)
  if(Object.keys(body).some(k=>!['action','batchId','data'].includes(k))||!['simulate','confirm','item','preset','file','correct','upload.chunk'].includes(String(body.action))||!body.data||typeof body.data!=='object'||Array.isArray(body.data))return unifiedJson({error:'Requête invalide.'},400)
  if(body.action!=='preset'&&!uuid.test(String(body.batchId)))return unifiedJson({error:'Identifiant de lot invalide.'},400)
  return unifiedJson(await identity.transport.rpc('clinical_migration_command',{p_action:body.action,p_batch:body.batchId??null,p_data:body.data},identity.token))
  } catch(error) { if(error instanceof JsonBodyError)return unifiedJson({error:'Fichier ou requête trop volumineux ou invalide.'},error.status);throw error }
}
