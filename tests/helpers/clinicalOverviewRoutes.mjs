import assert from 'node:assert/strict'
import {registerHooks}from'node:module'
const uid='10000000-0000-4000-8000-000000000001'
let scenario='coordinator',calls=[]
process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.example.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-public'
globalThis.__overviewClient=(_url,key,options)=>{
 assert.equal(key,'fixture-public');assert.equal(options.global.headers.Authorization,'Bearer fixture')
 return {auth:{getUser:async()=>({data:{user:scenario==='bad_token'?null:{id:uid,email:'fixture@example.invalid'}}})},from(table){return {select(){return this},eq(){return this},async maybeSingle(){
  if(table==='profiles')return {data:scenario==='missing_profile'?null:{role:scenario==='direction'?'direction':scenario==='unknown_role'?'other':'professionnel',platform_access_enabled:scenario!=='disabled'},error:null}
  assert.equal(table,'clinical_coordination_staff')
  return {data:scenario==='other'?null:{id:'staff',profile_id:scenario==='forged_member'?'different':uid,is_active:scenario!=='inactive'},error:scenario==='membership_failure'?{message:'fixture'}:null}
 }}},async rpc(name,args){calls.push({name,args});return scenario==='rpc_denied'?{error:{code:'42501'}}:scenario==='rpc_failure'?{error:{code:'XX000'}}:{data:{professionals:[]},error:null}}
 }
}
const url=code=>`data:text/javascript,${encodeURIComponent(code)}`
registerHooks({resolve(s,c,next){if(s==='server-only')return{url:url('export {}'),shortCircuit:true};if(s==='@supabase/supabase-js')return{url:url('export const createClient=globalThis.__overviewClient'),shortCircuit:true};if(s==='next/server')return next('next/server.js',c);return next(s,c)}})
const {NextRequest}=await import('next/server.js')
const route=await import('../../app/api/clinical-overview/route.ts')
assert.deepEqual(Object.keys(route),['GET'],'Aucune route de mutation')
for(const [name,status]of [['anonymous',401],['bad_token',401],['missing_profile',403],['disabled',403],['unknown_role',403],['other',403],['forged_member',403],['inactive',403],['membership_failure',503],['coordinator',200],['direction',200],['rpc_denied',403],['rpc_failure',503]]){
 scenario=name;calls=[]
 const response=await route.GET(new NextRequest('https://fixture.example.invalid/api/clinical-overview?view=preferences',{headers:name==='anonymous'?{}:{Authorization:'Bearer fixture'}}))
 assert.equal(response.status,status,name);assert.match(response.headers.get('cache-control'),/private.*no-store/)
 if(!['coordinator','direction','rpc_denied','rpc_failure'].includes(name))assert.equal(calls.length,0,'Pas de RPC avant autorisation')
}
scenario='coordinator';calls=[]
for(const view of ['dashboard','waiting-list','preferences'])assert.equal((await route.GET(new NextRequest('https://fixture.example.invalid/api/clinical-overview?view='+view,{headers:{Authorization:'Bearer fixture'}}))).status,200)
assert.deepEqual(calls.map(c=>c.args.requested_view),['dashboard','waiting-list','preferences'])
for(const view of ['', 'profiles','../direction','preferences;update'])assert.equal((await route.GET(new NextRequest('https://fixture.example.invalid/api/clinical-overview?view='+encodeURIComponent(view),{headers:{Authorization:'Bearer fixture'}}))).status,400)
assert.equal(calls.length,3)
console.log('API lecture seule : sessions, adhésion, révocation, rôle direction, projections et absence de mutation vérifiés.')
