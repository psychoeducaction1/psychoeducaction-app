import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
const require=createRequire(import.meta.url)
const id='10000000-0000-4000-8000-000000000001'
function render(section){
 const snapshot={professional:{id,full_name:'Professionnel fictif',email:null,platform_access_enabled:true},requests:[{id:'request',professional_id:id,is_active:true,requested_count:2,created_at:'2026-01-01',request_comment:'Commentaire fictif'}],assignments:[{id:'assignment',assignment_request_id:'request',first_name:'Client',last_name:'Fictif',is_active:true,contacted:true,assigned_date:'2026-01-02',email:null,phone:null,short_comment:null}]}
 let cursor=0;const states=[snapshot,'',section],exports={}
 const code=ts.transpileModule(readFileSync('components/ProfessionalPreviewWorkspace.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 runInNewContext(code,{exports,Intl,Date,Number,require(n){
  if(n==='react')return{useState:()=>[states[cursor++],()=>{}],useEffect(){}}
  if(n==='next/link')return{default:({children,href})=>require('react').createElement('a',{href},children)}
  if(n==='@/lib/supabaseClient')return{supabase:{}}
  if(n==='@/components/Ui')return{buttonClass:()=>''}
  if(n==='@/lib/professionalPreview')return{professionalPreviewSections:[['dashboard','Tableau de bord'],['assignments','Mes assignations'],['request','Ma demande'],['history','Historique'],['preferences','Mes préférences']]}
  if(n==='@/lib/professionalPreferences')return{normalizeStructuredPreferences:()=>({pref_languages:['Français'],pref_age_ranges:[]}),getOptionLabels:()=>[],formatAgeRanges:()=>'-'}
  if(n==='@/app/professionnel/shared')return{getAssignedClientStatus:c=>c.is_active?'taken':'pending',getAssignedClientStatusMeta:()=>({label:'Service pris',className:''}),getAssignmentRequestMetrics:()=>({isActive:true}),getServiceTakenCount:c=>c.filter(v=>v.is_active).length,getUsedAssignmentCount:c=>c.length}
  return require(n)
 }})
 return renderToStaticMarkup(exports.ProfessionalPreviewWorkspace({professionalId:id}))
}
test('les cinq rubriques se consultent sans formulaire ni action destructive',()=>{for(const section of ['dashboard','assignments','request','history','preferences']){const html=render(section);assert.match(html,/lecture seule/);assert.doesNotMatch(html,/<form|<input|<select|Envoyer|Supprimer|Enregistrer/);assert.match(html,/Retour à la Direction/)}})
test('historique contient le commentaire et le client, replis consultables',()=>{const html=render('history');assert.match(html,/Commentaire fictif/);assert.match(html,/Client.*Fictif/);assert.match(html,/<details/);assert.match(html,/Clients sans demande liée/)})
