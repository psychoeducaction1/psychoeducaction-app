import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createRequire} from 'node:module'
import {renderToStaticMarkup} from 'react-dom/server'
import {createElement} from 'react'
import ts from 'typescript'
const require=createRequire(import.meta.url),tick=()=>new Promise(r=>setImmediate(r))
function load(file,mocks,env={}){const exports={};const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;runInNewContext(code,{exports,process:{env},require:n=>n in mocks?mocks[n]:require(n)});return exports}
test('fiche operationnelle immediate, redirection uniquement apres activation verifiee',async()=>{
 for(const enabled of [false,true]){
 let effect,resolve;const destinations=[];const Operational=()=>null
 const m=load('components/ProfessionalProfileEntry.tsx',{'react':{useEffect:fn=>{effect=fn}},'next/navigation':{useRouter:()=>({replace:p=>destinations.push(p)})},'@/lib/supabaseClient':{supabase:{rpc:()=>new Promise(r=>{resolve=r})}},'@/components/OperationalProfessionalPage':{default:Operational}},{NEXT_PUBLIC_PEA_CLINICAL_UNIFICATION:'true'})
 const tree=m.ProfessionalProfileEntry({professionalId:'fixture-professional'});assert.equal(tree.type,Operational);effect();assert.equal(destinations.length,0);resolve({data:{enabled}});await tick();assert.equal(destinations.length,enabled?1:0)
 }
})
test('commentaires visibles en entier pour ancien parcours; presentation recente conservee pour comptes autorises',()=>{
 const m=load('components/RequestHistoryCard.tsx',{'@/components/ui/index':{Badge:({children})=>children,buttonClass:()=>''},'@/components/AssignmentRequestComment':{AssignmentRequestComment:()=>createElement('details',null,'Nouveau rendu')}})
 const card={request:{id:'fixture',requested_count:2,request_comment:'Commentaire fictif complet'},status:'Active',durationLabel:'',createdDate:null,completionDate:null,serviceTakenCount:0,serviceNotTakenCount:0,remainingCount:2,notContactedCount:0,pendingCount:0}
 const legacy=renderToStaticMarkup(m.RequestHistoryCard({card,legacyPresentation:true,onToggle(){},children:null}));assert.match(legacy,/Commentaire fictif complet/);assert.doesNotMatch(legacy,/<details/)
 const current=renderToStaticMarkup(m.RequestHistoryCard({card,legacyPresentation:false,onToggle(){},children:null}));assert.match(current,/<details/)
})
test('deconnexion clinique reservee aux comptes actives',()=>{assert.ok(readFileSync('components/AppNav.tsx','utf8').includes('if (isUnifiedClinicalClient() && clinicalReal) await signOutUnifiedSession()'))})
