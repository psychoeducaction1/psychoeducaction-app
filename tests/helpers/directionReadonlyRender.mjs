import assert from 'node:assert/strict'
import {registerHooks}from'node:module'
import{readFileSync,existsSync}from'node:fs'
import{fileURLToPath,pathToFileURL}from'node:url'
import ts from'typescript'
import * as React from'react'
import{renderToStaticMarkup}from'react-dom/server'
const reactUrl=import.meta.resolve('react'),root=new URL('../../',import.meta.url)
let mode='waiting',index=0,readOnly=true
const client={id:'fixture',status:'waiting',client_name:'Client Fictif',first_requester_name:'Requérante Fictive',birth_date:'2016-01-01',city:'Montréal',priority_level:'urgent',service_requested:'Psychoéducation',contact_date:'2026-10-20',contact_email:'fixture@example.invalid',contact_emails:[],contact_phones:[],meeting_modality:['Visioconférence'],internal_notes:'Note fictive conservée',consultation_reason:'Motif fictif',availability:'Soir'}
globalThis.__readonlyState=initial=>{
 const i=index++
 if(mode==='waiting')return [i===0?[client,{...client,id:'history',status:'closed',client_name:'Historique Fictif'}]:i===5?false:initial,()=>{}]
 if(i===0)return [[{id:'p',fullName:'Professionnelle Fictive',email:'pro@example.invalid',totalAssignedClients:4,activeClients:1,noResponseClients:3,pendingClients:1,requestActive:true,requestedCount:5,assignedCount:2,remainingCount:3,unassignedCount:3,requestComment:'Demande fictive',requestCompleted:false}],()=>{}]
 return [i===1?{waiting:1,urgent:1}:i===2?false:initial,()=>{}]
}
const data=code=>'data:text/javascript,'+encodeURIComponent(code)
registerHooks({resolve(s,c,next){
 if(s==='react' && /Direction(WaitingList|Dashboard)\.tsx$/.test(c.parentURL ?? ''))return{url:data(`export * from ${JSON.stringify(reactUrl)};export{default}from ${JSON.stringify(reactUrl)};export const useState=globalThis.__readonlyState;`),shortCircuit:true}
 if(s==='next/navigation')return{url:data('export const useRouter=()=>({push(){throw Error("Navigation inattendue")}})'),shortCircuit:true}
 if(s==='next/link')return{url:data(`import React from ${JSON.stringify(reactUrl)};export default function Link(p){return React.createElement("a",p,p.children)}`),shortCircuit:true}
 if(s==='@/components/AppNav')return{url:data('export const AppNav=()=>null'),shortCircuit:true}
 if(s==='@/components/EmailComposerModal')return{url:data('export const EmailComposerModal=()=>{throw Error("Compositeur affiché")};'),shortCircuit:true}
 if(s==='@/lib/supabaseClient')return{url:data('export const supabase={auth:{},from(){throw Error("Accès DB inattendu pendant rendu")}}'),shortCircuit:true}
 if(s.startsWith('@/')){const path=fileURLToPath(new URL(s.slice(2),root));if(existsSync(path+'.tsx'))return next(pathToFileURL(path+'.tsx').href,c)}
 return next(s,c)
},load(url,c,next){if(url.endsWith('.tsx'))return{format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText,shortCircuit:true};return next(url,c)}})
const{DirectionWaitingList}=await import('../../components/DirectionWaitingList.tsx')
const{DirectionDashboard}=await import('../../components/DirectionDashboard.tsx')
function render(component){index=0;return renderToStaticMarkup(React.createElement(component,{readOnly}))}
const waiting=render(DirectionWaitingList)
for(const label of ['Clients en attente','Historique clients','Requérante Fictive','Note fictive conservée','Professionnel suggéré','Âge minimum'])assert.ok(waiting.includes(label),label)
assert.doesNotMatch(waiting,/>\s*(Assigner|Modifier|Ajouter un client|Supprimer définitivement|Démarrer une assignation|Suggestions|Tâche aux adjointes|Hors plateforme)\s*</)
assert.doesNotMatch(waiting,/mailto:|<form|Actions<\/th>/)
readOnly=false;assert.match(render(DirectionWaitingList),/Ajouter un client/,'Direction conserve les actions')
mode='dashboard';readOnly=true
const dashboard=render(DirectionDashboard)
for(const label of ['Clients assignés en attente','Services non pris','Demandes nécessitant attention','Professionnels disponibles pour assignation'])assert.ok(dashboard.includes(label),label)
assert.doesNotMatch(dashboard,/href="\/professionnel\//)
assert.match(dashboard,/href="\/preferences-professionnels"/)
readOnly=false;assert.match(render(DirectionDashboard),/href="\/professionnel\/p"/)
console.log('Vrais composants partagés : sections et filtres identiques, coordonnées et historique visibles, écritures et fiches absentes pour Ève; actions direction conservées.')
