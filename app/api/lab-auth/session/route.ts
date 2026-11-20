import { isClinicalError } from '@/lib/clinical-core/validation'
import { isDurableClinicalRuntime, isStagingClinicalRuntime, readDurableClinicalRuntime, stagingAllowedEmails } from '@/lib/clinical-local/runtime'
import { checkLocalOrigin, localIdentity, localJson, sessionCookie, sessionToken } from '@/lib/clinical-local/http'
import { readBoundedJsonObject, JsonBodyError } from '@/lib/boundedJsonBody'

export const runtime='nodejs'
export const dynamic='force-dynamic'
function closed() { return localJson({error:'La connexion locale durable n’est pas configurée.',code:'LOCAL_NOT_READY'},503) }
export async function GET(request:Request) {
  if (!isDurableClinicalRuntime()) return closed()
  try { const {actor}=await localIdentity(request); return localJson({actor,mode:isStagingClinicalRuntime()?'isolated_stage':'isolated_local',durable:true}) }
  catch(error) { return isClinicalError(error) ? localJson({error:error.message,code:error.code},error.status) : closed() }
}
export async function POST(request:Request) {
  if (!isDurableClinicalRuntime()) return closed()
  try {
    checkLocalOrigin(request)
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))return localJson({error:'Un contenu JSON est requis.'},400)
    const body=await readBoundedJsonObject(request,8192)
    if (typeof body.email!=='string'||typeof body.password!=='string'||body.password.length>200) return localJson({error:'Identifiants invalides.'},400)
    const email=body.email.trim().toLowerCase()
    if (isStagingClinicalRuntime() ? !stagingAllowedEmails().includes(email) : !email.endsWith('.invalid')) return localJson({error:'Ce compte n’est pas autorisé pour cet essai.'},isStagingClinicalRuntime()?403:400)
    const local=readDurableClinicalRuntime()
    const response=await fetch(`${local.supabaseUrl}/auth/v1/token?grant_type=password`,{method:'POST',redirect:'error',cache:'no-store',headers:{apikey:local.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email:body.email,password:body.password}),signal:AbortSignal.timeout(10000)})
    if(!response.ok)return localJson({error:'Identifiants locaux non valides.'},401)
    const result=await response.json()
    if(typeof result.access_token!=='string')return closed()
    const verify=new Request(request.url,{headers:{Authorization:`Bearer ${result.access_token}`}})
    const {actor}=await localIdentity(verify)
    return localJson({actor,mode:isStagingClinicalRuntime()?'isolated_stage':'isolated_local',durable:true},200,{'Set-Cookie':sessionCookie(result.access_token,Number(result.expires_in)||3600)})
  }catch(error){if(error instanceof JsonBodyError)return localJson({error:'Le contenu JSON est invalide ou trop volumineux.'},error.status);return isClinicalError(error)?localJson({error:error.message,code:error.code},error.status):closed()}
}
export async function DELETE(request:Request) {
  if(!isDurableClinicalRuntime())return closed()
  try {checkLocalOrigin(request)}catch(error){return isClinicalError(error)?localJson({error:error.message,code:error.code},error.status):closed()}
  try {const local=readDurableClinicalRuntime();const token=sessionToken(request);if(token)await fetch(`${local.supabaseUrl}/auth/v1/logout`,{method:'POST',redirect:'error',headers:{apikey:local.anonKey,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)})}catch{}
  return localJson({signedOut:true},200,{'Set-Cookie':sessionCookie()})
}
