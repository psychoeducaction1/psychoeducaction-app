import {randomUUID} from 'node:crypto'
import {NextRequest,NextResponse} from 'next/server'
import {createClient} from '@supabase/supabase-js'
import {getSupabaseAdmin} from '@/lib/supabaseAdmin'
import {getBearerToken,getSuperAdminContext} from '@/lib/superAdminServer'
import {ADMISSION_UUID} from '@/lib/clinical-admission/transport'
const jsonResponse=(body:object,status:number)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}})
export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}){
 const access=await getSuperAdminContext(request)
 if(access.error)return jsonResponse({error:access.error.message},access.error.status)
 const {id}=await context.params
 if(!ADMISSION_UUID.test(id))return jsonResponse({error:'Identifiant de demande invalide.'},400)
 const admin=getSupabaseAdmin()
 const {data:record,error}=await admin.from('assignment_requests').select('id,clinical_version').eq('id',id).maybeSingle()
 if(error)return jsonResponse({error:'La demande ne peut pas être vérifiée.'},503)
 if(!record)return jsonResponse({error:'Demande introuvable.'},404)
 const {data:clients,error:readError}=await admin.from('assigned_clients').select('is_active').eq('assignment_request_id',id).is('canceled_at',null)
 if(readError)return jsonResponse({error:'Le résumé ne peut pas être chargé.'},503)
 const rows=clients??[],summary={linkedClients:rows.length,serviceTaken:rows.filter(x=>x.is_active===true).length,serviceNotTaken:rows.filter(x=>x.is_active===false).length,pending:rows.filter(x=>x.is_active===null).length}
 return jsonResponse({...summary,summary,version:record.clinical_version,canDelete:true},200)
}
export async function DELETE(request:NextRequest,context:{params:Promise<{id:string}>}){
 const access=await getSuperAdminContext(request)
 if(access.error)return jsonResponse({error:access.error.message},access.error.status)
 const {id}=await context.params,key=request.headers.get('Idempotency-Key')??randomUUID(),versionHeader=request.headers.get('If-Match')
 if(!ADMISSION_UUID.test(id)||!ADMISSION_UUID.test(key)||versionHeader!==null&&!/^[1-9][0-9]{0,8}$/.test(versionHeader))return jsonResponse({error:'Vérifiez la demande avant de la supprimer.'},400)
 let version=versionHeader===null?null:Number(versionHeader)
 // Compatibility with the previous caller, which did not send a version.
 if(version===null){const {data,error}=await getSupabaseAdmin().from('assignment_requests').select('clinical_version').eq('id',id).maybeSingle();if(error)return jsonResponse({error:'Vérification indisponible.'},503);if(!data)return jsonResponse({error:'Demande introuvable.'},404);version=data.clinical_version}
 const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${getBearerToken(request)}`}},auth:{autoRefreshToken:false,persistSession:false}})
 const {data,error}=await client.rpc('clinical_admin_delete_assignment_request',{p_id:id,p_expected_version:version,p_key:key})
 if(error){const status=error.code==='42501'?403:error.code==='40001'?409:error.code==='P0002'?404:error.code==='22023'?400:503;return jsonResponse({error:status===409?'La demande a changé. Actualisez sa fiche avant de recommencer.':status===403?'Action réservée au super administrateur.':status===404?'Demande introuvable.':'La suppression n’a pas pu être confirmée. Actualisez avant de réessayer.'},status)}
 return jsonResponse(data,200)
}
