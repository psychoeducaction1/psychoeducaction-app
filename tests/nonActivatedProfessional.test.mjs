import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const tick=()=>new Promise(r=>setImmediate(r))
function harness(result){
 let state=false,effect,callback,resolvePending
 const exports={}
 const code=ts.transpileModule(readFileSync('lib/clinical-real/useClinicalAssignmentAccess.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
 const hooks={useState:()=>[state,v=>{state=v}],useEffect:fn=>{effect=fn}}
 const supabase={rpc:()=>result==='pending'?new Promise(r=>{resolvePending=r}):Promise.resolve(result),auth:{onAuthStateChange(fn){callback=fn;return{data:{subscription:{unsubscribe(){}}}}}}}
 runInNewContext(code,{exports,process:{env:{NEXT_PUBLIC_PEA_CLINICAL_ASSIGNMENT_NAV:'true'}},setTimeout:fn=>fn(),require:name=>name==='react'?hooks:{supabase}})
 return{render:()=>exports.useClinicalAssignmentAccess(),start:()=>effect(),switch:()=>callback(),resolve:v=>resolvePending(v)}
}
test('activation explicite seulement; erreur et absence conservent le parcours historique',async()=>{
 for(const [result,expected] of [[{data:{enabled:true}},true],[{data:{enabled:false}},false],[{data:null},false],[{data:{enabled:true},error:{}},false]]){
 const h=harness(result);assert.equal(h.render(),false);h.start();await tick();assert.equal(h.render(),expected)
 }
})
test('une réponse tardive après démontage ne réactive pas les fonctions cliniques',async()=>{
 const h=harness('pending');h.render();const cleanup=h.start();cleanup();h.resolve({data:{enabled:true}});await tick();assert.equal(h.render(),false)
})
test('menu et actions utilisent le périmètre du compte',()=>{
 const nav=readFileSync('components/AppNav.tsx','utf8'),page=readFileSync('app/professionnel/clients/page.tsx','utf8')
 assert.ok(nav.includes('isUnifiedClinicalClient() && clinicalReal ?'))
 assert.ok(nav.includes("label: 'Historique'"))
 assert.ok(page.includes("nextStatus === 'taken' && clinicalAssignmentAccess"))
 assert.ok(page.includes('enabled={clinicalAssignmentAccess}'))
})
