import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const id='10000000-0000-4000-8000-000000000001'
function harness({status,role='professionnel',fail=false,pages=false}={}){
 const calls=[];let privileged=0
 const db={from(table){const c={table};calls.push(c);const chain={select(v){c.columns=v;return chain},eq(k,v){c.filter=[k,v];return chain},is(k,v){c.is=[k,v];return chain},order(k){c.order=k;return chain},range(a,b){c.range=[a,b];return chain},maybeSingle(){return Promise.resolve({data:{id,role,full_name:'Professionnel fictif'},error:null})},then(ok,no){const data=pages&&table==='assigned_clients'&&c.range[0]===0?Array.from({length:500},(_,i)=>({id:String(i)})):[];return Promise.resolve(fail?{error:new Error('CONFIDENTIAL_DATABASE_PAYLOAD')}:{data,error:null}).then(ok,no)}};return chain}}
 const exports={};const code=ts.transpileModule(readFileSync('app/api/direction/professionals/[id]/preview/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 runInNewContext(code,{exports,URL,Error,Promise,require(n){if(n==='next/server')return{NextResponse:{json:(b,i)=>Response.json(b,i)}};if(n==='@/lib/directionServer')return{getDirectionContext:async()=>status?{error:{status}}:{context:{user:{id}}}};if(n==='@/lib/supabaseAdmin')return{getSupabaseAdmin(){privileged++;return db}};throw Error(n)}})
 return{calls,get privileged(){return privileged},get:(target=id,query='')=>exports.GET(new Request('https://app.example.test/api/direction/professionals/'+target+'/preview'+query),{params:Promise.resolve({id:target})})}
}
test('refuse anonyme et professionnel avant tout acces privilegie',async()=>{for(const status of [401,403]){const h=harness({status}),r=await h.get();assert.equal(r.status,status);assert.equal(h.privileged,0);assert.equal(h.calls.length,0)}})
test('cible valide obligatoire; aucun parametre supplementaire',async()=>{for(const [id,q] of [['invalid',''],[undefined,'?actor=other']]){const h=harness(),r=await h.get(id,q);assert.equal(r.status,400);assert.equal(h.privileged,0)}})
test('profil professionnel exact, pas de comptes crees ni de sessions cibles',async()=>{const h=harness({role:'direction'}),r=await h.get();assert.equal(r.status,404);assert.equal(h.calls.length,1)})
test('lecture paginee limitee au professionnel et exclusion des assignations annulees',async()=>{
 const h=harness({pages:true}),r=await h.get();assert.equal(r.status,200);const body=await r.json();assert.equal(body.assignments.length,500);assert.equal(h.calls.filter(c=>c.table==='assigned_clients').length,2)
 for(const c of h.calls.filter(c=>c.table!=='profiles'))assert.deepEqual(Array.from(c.filter),['professional_id',id])
 assert.deepEqual(Array.from(h.calls.find(c=>c.table==='assigned_clients').is),['canceled_at',null]);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('vary'),'Authorization');assert.equal(h.calls.find(c=>c.table==='profiles').filter[1],id)
})
test('erreur sans fuite de payload ni retour partiel',async()=>{const r=await harness({fail:true}).get();assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/CONFIDENTIAL/)} )
