import assert from 'node:assert/strict'
import {registerHooks}from'node:module'
import {SUPER_ADMIN_EMAIL}from'../../lib/superAdmin.ts'
const userId='10000000-0000-4000-8000-000000000001',staffId='20000000-0000-4000-8000-000000000001',taskId='30000000-0000-4000-8000-000000000001'
let scenario='coordinator',sends=[],businessReads=0
const staff={id:staffId,profile_id:userId,full_name:'Coordinatrice fictive',email:'coordinator@example.invalid',is_active:true}
process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.example.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-public'
globalThis.__coordinationSend=async x=>{sends.push(x)}
globalThis.__coordinationClient=(_url,key)=>{assert.equal(key,'fixture-public');return{auth:{getUser:async()=>({data:{user:scenario==='bad_token'?null:{id:userId,email:scenario==='manager'?SUPER_ADMIN_EMAIL:'coordinator@example.invalid'}}})},from(table){if(table!=='profiles')businessReads++;return{select(){return this},eq(){return this},async maybeSingle(){if(table==='profiles')return{data:{role:['assistantA','assistantB','manager'].includes(scenario)?'direction':'professionnel',full_name:'Profil fictif',platform_access_enabled:scenario!=='disabled',email:'coordinator@example.invalid'},error:null};if(table==='clinical_coordination_staff')return{data:scenario==='missing'?null:{...staff,profile_id:scenario==='other'?taskId:userId},error:scenario==='storage_failure'?{message:'fixture'}:null};if(table==='clinical_coordination_tasks')return{data:{id:taskId,staff_id:staffId,created_by:scenario==='foreign_task'?taskId:userId},error:null};assert.fail(table)}}}}}
const url=code=>`data:text/javascript,${encodeURIComponent(code)}`
registerHooks({resolve(s,c,next){if(s==='server-only')return{url:url('export {}'),shortCircuit:true};if(s==='@supabase/supabase-js')return{url:url('export const createClient=globalThis.__coordinationClient'),shortCircuit:true};if(s==='@/lib/resendEmail')return{url:url('export const sendResendEmail=globalThis.__coordinationSend'),shortCircuit:true};if(s==='next/server')return next('next/server.js',c);return next(s,c)}})
const{NextRequest}=await import('next/server.js');const{GET}=await import('../../app/api/coordination-clinique/context/route.ts');const{POST}=await import('../../app/api/coordination-clinique/task-notification/route.ts')
for(const [name,status]of [['anonymous',401],['bad_token',401],['assistantA',403],['assistantB',403],['disabled',403],['other',403],['missing',403],['storage_failure',503],['coordinator',200],['manager',200]]){
 scenario=name;businessReads=0;sends=[];const headers=name==='anonymous'?{}:{Authorization:'Bearer fixture'};let r=await GET(new NextRequest('https://fixture.example.invalid/context',{headers}));assert.equal(r.status,status,name);assert.match(r.headers.get('cache-control'),/no-store/)
 if(status!==200){r=await POST(new NextRequest('https://fixture.example.invalid/notification',{method:'POST',headers,body:JSON.stringify({taskId,to:'forged@example.invalid'})}));assert.equal(r.status,status,name);assert.equal(sends.length,0)}
 if(['anonymous','bad_token','assistantA','assistantB','disabled'].includes(name))assert.equal(businessReads,0,'Pas de lecture métier avant autorisation')
}
for(const [name,status]of [['foreign_task',403],['coordinator',200],['manager',200]]){
 scenario=name;sends=[];const r=await POST(new NextRequest('https://fixture.example.invalid/notification',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({taskId,to:'forged@example.invalid',message:'DÉTAIL FICTIF PRIVÉ'})}));assert.equal(r.status,status,name);assert.equal(sends.length,status===200?1:0);if(status===200){assert.equal(sends[0].to,'coordinator@example.invalid');assert.deepEqual(sends[0].cc,name==='manager'?undefined:[SUPER_ADMIN_EMAIL]);assert.ok(sends[0].idempotencyKey.includes(taskId));assert.doesNotMatch(sends[0].text,/DÉTAIL FICTIF|Titre|description/)}
}
console.log('Routes coordination : sessions, adjointes, UUID, droits, panne et notification sans donnée clinique vérifiés hors ligne.')
