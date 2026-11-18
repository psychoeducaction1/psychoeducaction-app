import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {Children,createElement,isValidElement,type ReactNode,type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {emptyMigrationRow,spreadsheetMigrationRows} from '../lib/clinical-migration/model.ts'
import * as preparation from '../lib/clinical-migration/preparation.ts'
import {handleMigration} from '../lib/clinical-unification/migrationHttp.ts'

test('préparation : montant du fichier prioritaire, premières dates connues, courriels multiples et champs absents',()=>{
 const row=spreadsheetMigrationRows([['Fictif','Client','135,50 $',new Date('2020-01-02T12:00Z'),'a@example.invalid; b@example.invalid']],{lastName:0,firstName:1,email:4},'fixture-source',['Nom','Prénom','Tarif',"DATE D'APPEL INITIAL",'Courriel'])[0]
 assert.equal(row.preparation?.rateCents,13550);assert.equal(row.preparation?.startDate,'2020-01-02')
 assert.equal(row.email,'a@example.invalid');assert.equal(row.preparation?.additionalEmails,'b@example.invalid')
 assert.equal(preparation.migrationDefaultRate('Intervention psychoéducative'),10000)
 assert.equal(preparation.migrationDefaultRate('Psychoéducation'),13500)
 assert.equal(preparation.importedAmount('135x'),null)
 assert.deepEqual(preparation.preparationErrors(preparation.preparationFromSource(emptyMigrationRow('fixture:empty'))),[])
})
test('API : nouveaux appels gardent le contexte, le JWT, les limites et le verrou d’activation',async()=>{
 const previousMerge=process.env.PEA_CONTROLLED_MERGE,previousImport=process.env.PEA_CLINICAL_IMPORT_ENABLED
 const calls:unknown[]=[]
 const identity={context:'administration' as const,token:'fictional-jwt',transport:{authenticate:async()=>null,rpc:async(...args:unknown[])=>{calls.push(args);return{}}}}
 try{
  process.env.PEA_CONTROLLED_MERGE='true';delete process.env.PEA_CLINICAL_IMPORT_ENABLED
  for(const action of ['prepare','client.defaults','client.save','report.hide']){
   const req=()=>new Request('https://example.invalid/api/clinical-workspace/migration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,batchId:'30000000-0000-4000-8000-000000000001',data:{}})})
   assert.equal((await handleMigration(req(),['migration'],identity))?.status,403)
   process.env.PEA_CLINICAL_IMPORT_ENABLED='true'
   assert.equal((await handleMigration(req(),['migration'],{...identity,context:'clinical'}))?.status,403)
   assert.equal((await handleMigration(req(),['migration'],identity))?.status,200)
   delete process.env.PEA_CLINICAL_IMPORT_ENABLED
  }
  assert.equal(calls.length,4);assert.ok(calls.every(call=>Array.isArray(call)&&call[2]==='fictional-jwt'))
 }finally{
  if(previousMerge===undefined)delete process.env.PEA_CONTROLLED_MERGE;else process.env.PEA_CONTROLLED_MERGE=previousMerge
  if(previousImport===undefined)delete process.env.PEA_CLINICAL_IMPORT_ENABLED;else process.env.PEA_CLINICAL_IMPORT_ENABLED=previousImport
 }
})

const require=createRequire(import.meta.url)
function elements(node:ReactNode):ReactElement<Record<string,unknown>>[]{
 if(!isValidElement<Record<string,unknown>>(node))return[]
 if(typeof node.type==='function')return elements((node.type as (props:Record<string,unknown>)=>ReactNode)(node.props))
 return[node,...Children.toArray(node.props.children as ReactNode).flatMap(elements)]
}
test('fiche réelle : champs facultatifs, parts multiples, montant modifiable et validation individuelle',()=>{
 const exports:Record<string,unknown>={}
 const source=readFileSync(new URL('../components/clinical-migration/MigrationClientPreparation.tsx',import.meta.url),'utf8')
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 runInNewContext(js,{exports,crypto:{randomUUID:()=> 'requester-2'},require:(specifier:string)=>{
  if(specifier==='react/jsx-runtime')return require(specifier)
  if(specifier==='@/components/Ui')return{buttonClass:()=>''}
  if(specifier==='@/components/clinical-mandates/primitives')return{inputClass:'',Field:({label,children}:{label:string;children:ReactNode})=>createElement('label',null,label,children)}
  if(specifier==='@/lib/clinical-migration/preparation')return preparation
  throw Error('Unexpected import '+specifier)
 }})
 let row={...emptyMigrationRow('fixture:ui'),firstName:'Client',lastName:'Fictif',decision:'create' as const}
 row={...row,preparation:{...preparation.preparationFromSource(row),requesters:[{key:'requester-1',fullName:'Parent Fictif',email:'',phone:'',address:'',relationship:''}]}}
 let saved=0
 const render=(locked=false,identityErrors:string[]=[])=>(exports.MigrationClientPreparation as (props:Record<string,unknown>)=>ReactNode)({row,identityErrors,disabled:false,saved:locked,onChange:(value:preparation.MigrationPreparation)=>{row={...row,preparation:value}},onDefaults(){},onSave(){saved++}})
 const markup=renderToStaticMarkup(render())
 assert.match(markup,/Motif de consultation/)
 assert.doesNotMatch(markup,/Autres courriels|Autres téléphones|Contenu clinique de la nouvelle convention|Conditions et modalités administratives|Charger le contenu depuis les paramètres/)
 let checks=elements(render()).filter(node=>node.type==='input'&&node.props.type==='checkbox')
 ;(checks[0].props.onChange as (e:unknown)=>void)({target:{checked:true}})
 checks=elements(render()).filter(node=>node.type==='input'&&node.props.type==='checkbox')
 ;(checks[1].props.onChange as (e:unknown)=>void)({target:{checked:true}})
 assert.match(renderToStaticMarkup(render()),/doivent totaliser 100/)
 const labels=elements(render()).filter(node=>node.type==='input'&&String(node.props['aria-label']).startsWith('Part de ')).map(node=>node.props['aria-label'])
 for(const label of labels){const input=elements(render()).find(node=>node.type==='input'&&node.props['aria-label']===label)!;(input.props.onChange as(e:unknown)=>void)({target:{value:'50'}})}
 const button=elements(render()).find(node=>node.type==='button'&&node.props.children==='Enregistrer et valider ce client')!
 assert.equal(button.props.disabled,false);(button.props.onClick as()=>void)();assert.equal(saved,1)
 const blocked=elements(render(false,['La date de naissance diffère.'])).find(node=>node.type==='button'&&node.props.children==='Enregistrer et valider ce client')!
 assert.equal(blocked.props.disabled,true);assert.match(renderToStaticMarkup(render(false,['La date de naissance diffère.'])),/date de naissance diffère/)
 assert.equal(elements(render(true)).find(node=>node.type==='button'&&node.props.children==='Client enregistré et validé')?.props.disabled,true)
})

test('préparation : coordonnées associées au requérant nommé, sans doublon ni attribution à un inconnu',()=>{
 const row=emptyMigrationRow('fixture:requesters')
 row.intake={initialCallDate:'',firstAppointmentDate:'',consultationReason:'',referredBy:'',originalMandates:[],clientele:'',sourceActive:'',billingResponsible:'',interlocutor:'',relationship:'',requesters:[{fullName:'Parent Fictif',email:'parent@example.invalid',city:'',postalCode:''}]}
 const p=preparation.preparationFromSource(row,['Nom requérant 1','Courriel correspondance 1','Téléphone requérant 1','Nom requérant 3','Courriel correspondance 3','Téléphone 3'],['Parent Fictif','parent@example.invalid','555-0101','Autre Fictif','autre@example.invalid','555-0103'])
 assert.equal(p.requesters.length,2)
 assert.equal(p.requesters[0].phone,'555-0101')
 assert.equal(p.requesters[1].email,'autre@example.invalid')
 assert.equal(p.requesters[1].phone,'555-0103')
 assert.equal(new Set(p.requesters.map(r=>r.key)).size,2)
 const unknown=preparation.preparationFromSource(emptyMigrationRow('fixture:unknown'),['Courriel correspondance 1'],['unknown@example.invalid'])
 assert.equal(unknown.requesters.length,0)
 const ambiguous={...row,intake:{...row.intake!,requesters:[{fullName:'Parent Fictif',email:'first@example.invalid',city:'',postalCode:''},{fullName:'Parent Fictif',email:'second@example.invalid',city:'',postalCode:''}]}}
 const kept=preparation.preparationFromSource(ambiguous,['Nom requérant 1','Téléphone 1'],['Parent Fictif','555-0199'])
 assert.deepEqual(kept.requesters.map(person=>person.email),['first@example.invalid','second@example.invalid'])
 assert.ok(kept.requesters.every(person=>!person.phone))
})

test('liste à traiter : seule une confirmation importée masque le client, y compris après reprise',()=>{
 const rows=['one','two','three'].map(key=>emptyMigrationRow('fixture:'+key))
 assert.deepEqual(preparation.pendingMigrationEntries(rows).map(e=>e.index),[0,1,2])
 const items=[{source_key:rows[0].sourceKey,status:'imported'},{source_key:rows[1].sourceKey,status:'error'},{source_key:rows[2].sourceKey,status:'pending'}]
 assert.deepEqual(preparation.pendingMigrationEntries(rows,items).map(e=>e.index),[1,2])
 assert.deepEqual(preparation.pendingMigrationEntries(rows,items).map(e=>e.row.sourceKey),['fixture:two','fixture:three'])
 assert.equal(rows.length,3)
})

test('requérants : seuil de 14 ans, identité du client et conservation des autres personnes',()=>{
 const row={...emptyMigrationRow('fictional:age'),firstName:'Alex',lastName:'Exemple',birthDate:'2012-11-17',email:'alex@example.invalid'}
 const base=preparation.preparationFromSource(row)
 const original={...base,requesters:[{key:'requester-1',fullName:'Alex Exemple',email:row.email,phone:'',address:'',relationship:'je suis le parent'},{key:'requester-2',fullName:'Parent Exemple',email:'parent@example.invalid',phone:'',address:'',relationship:'Parent'}],payers:[{key:'requester-1',basisPoints:3000},{key:'requester-2',basisPoints:7000}]}
 const fourteen=preparation.normalizeMigrationRequesters(row,original,'2026-11-17')
 assert.equal(fourteen.requesters.length,2)
 assert.equal(fourteen.requesters[0].key,'client')
 assert.equal(fourteen.requesters[0].relationship,'Lui-même')
 assert.equal(fourteen.requesters[1].relationship,'Parent')
 assert.deepEqual(fourteen.payers,[{key:'client',basisPoints:3000},{key:'requester-2',basisPoints:7000}])
 assert.deepEqual(preparation.normalizeMigrationRequesters(row,fourteen,'2026-11-17'),fourteen)
 const thirteen=preparation.normalizeMigrationRequesters(row,original,'2026-11-16')
 assert.deepEqual(thirteen.requesters.map(person=>person.fullName),['Parent Exemple'])
 assert.equal(thirteen.payers.reduce((sum,payer)=>sum+payer.basisPoints,0),10000)
 const unknown=preparation.normalizeMigrationRequesters({...row,birthDate:''},{...base,requesters:[]},'2026-11-17')
 assert.deepEqual(unknown.requesters,[])
 const added=preparation.normalizeMigrationRequesters(row,{...base,requesters:[original.requesters[1]]},'2026-11-17')
 assert.equal(added.requesters[0].relationship,'Lui-même')
 assert.equal(added.requesters[0].email,row.email)
})
