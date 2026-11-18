import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {createElement,Children,isValidElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
const require=createRequire(import.meta.url),id='98110000-0000-4000-8000-000000000001',rid='98110000-0000-4000-8000-000000000002'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function nodes(n){if(!isValidElement(n))return[];if(typeof n.type==='function')return nodes(n.type(n.props));return[n,...Children.toArray(n.props.children).flatMap(nodes)]}
function harness(file,fetcher,confirm=()=>true){
 const states=[],refs=[],effects=[],forms=[];let cursor=0,refCursor=0
 const hooks={useState(v){const i=cursor++;if(!(i in states))states[i]=typeof v==='function'?v():v;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=refCursor++;return refs[i]??={current:v}},useEffect(fn){effects.push(fn)},useCallback(fn){return fn}}
 class ApiError extends Error{constructor(message,status){super(message);this.status=status}}
 const exports={},code=ts.transpileModule(readFileSync(new URL('../components/clinical-admission/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 runInNewContext(code,{exports,Error,URLSearchParams,crypto:{randomUUID:()=>id},window:{confirm},require(name){
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return require(name)
  if(name==='@/components/Ui')return{buttonClass:()=>'',Badge:({children})=>children}
  if(name==='@/components/clinical-workspace/NavigationGuard')return{useClinicalNavigation:()=>({canLeave:async()=>true}),useClinicalFormGuard(){}}
  if(name==='@/lib/clinical-unification/authClient')return{clinicalSessionFetch:fetcher}
  if(name==='@/lib/clinical-workspace/api')return{ClinicalApiError:ApiError}
  if(name==='@/lib/assignmentRequestComment')return{assignmentRequestComment:v=>({notes:[v]})}
  if(name==='./shared')return{panelClass:'',text:v=>String(v??''),ActionForm:props=>{forms.push(props);return createElement('form',null,createElement('button',null,props.submitLabel))}}
  if(name==='./AdministrativeCapacityPanel')return{AdministrativeCapacityPanel:props=>createElement('p',{'data-professional':props.professionalId},'Gestion administrative')}
  return new Proxy({},{get:()=>()=>null})
 }})
 return{states,effects,forms,render(name,props){cursor=0;refCursor=0;forms.length=0;return exports[name](props)}}
}
const request={id:rid,professionalId:id,requestedCount:3,comment:'Fictif',offerSlots:[],enabled:true,version:4,createdAt:'2026-01-01T12:00:00Z'}
test('professionnel sans activation clinique : la fiche administrative présente la gestion des demandes',()=>{
 const h=harness('ProfessionalPanel.tsx'),ui={data:{mode:'isolated_unified',context:'administration',professionals:[],capacityRequests:[request],assignments:[],notifications:[]},query:new URLSearchParams()}
 const html=renderToStaticMarkup(h.render('ProfessionalPanel',{workspace:{},ui,section:'requests',professionalId:id,accessibleClientIds:[]}))
 assert.match(html,/Gestion administrative/);assert.doesNotMatch(html,/capacité de pratique|espace professionnel n/)
 assert.match(html,new RegExp(id))
})
test('toutes les demandes administratives sont modifiables ; suppression confirmée, reprise idempotente sans courriel',async()=>{
 let approved=false,fail=true;const calls=[],commands=[]
 const fetcher=async(url,options={})=>{calls.push({url,options});if(options.method==='DELETE'&&fail){fail=false;throw Error('FICTITIOUS_NETWORK_LOSS')}return{ok:true,json:async()=>options.method==='DELETE'?{success:true,id:rid}:{canDelete:true,version:4,summary:{linkedClients:2,serviceTaken:1,serviceNotTaken:0,pending:1}}}}
 const h=harness('AdministrativeCapacityPanel.tsx',fetcher,()=>approved),props={ui:{data:{actorId:id},busy:false,run:async(...args)=>commands.push(args),refresh:async()=>{},invalidate(){}},professionalId:id,requests:[request,{...request,id:'98110000-0000-4000-8000-000000000003',enabled:false}],renderSummary:()=>createElement('p',null,'Résumé fictif')}
 h.render('AdministrativeCapacityPanel',props);h.effects[0]();await tick()
 let tree=h.render('AdministrativeCapacityPanel',props);renderToStaticMarkup(tree)
 assert.equal(h.forms.length,3);await h.forms[0].onSubmit({requestedCount:'7',comment:'Mis à jour fictif',enabled:true})
 assert.deepEqual(JSON.parse(JSON.stringify(commands[0])),['capacities.update',rid,{expectedVersion:4,requestedCount:7,comment:'Mis à jour fictif',enabled:true}])
 let buttons=nodes(tree).filter(n=>n.type==='button')
 assert.equal(buttons.filter(n=>n.props.children==='Supprimer la demande').length,2)
 assert.equal(buttons.filter(n=>n.props.children==='Clore la demande').length,1)
 await buttons.find(n=>n.props.children==='Clore la demande').props.onClick();assert.equal(commands.length,1,'no closure without confirmation')
 buttons.find(n=>n.props.children==='Supprimer la demande').props.onClick();await tick();assert.equal(calls.filter(c=>c.options.method==='DELETE').length,0)
 approved=true;tree=h.render('AdministrativeCapacityPanel',props);nodes(tree).find(n=>n.type==='button'&&n.props.children==='Supprimer la demande').props.onClick();await tick()
 tree=h.render('AdministrativeCapacityPanel',props);nodes(tree).find(n=>n.type==='button'&&n.props.children==='Supprimer la demande').props.onClick();await tick()
 const deletes=calls.filter(c=>c.options.method==='DELETE');assert.equal(deletes.length,2)
 assert.equal(deletes[0].options.headers['Idempotency-Key'],deletes[1].options.headers['Idempotency-Key']);assert.equal(deletes[0].options.headers['If-Match'],'4')
 assert.ok(calls.every(c=>c.url.startsWith('/api/direction/assignment-requests/')))
})
