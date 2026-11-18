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
  for(const action of ['prepare','client.defaults','client.save']){
   const req=()=>new Request('https://example.invalid/api/clinical-workspace/migration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,batchId:'30000000-0000-4000-8000-000000000001',data:{}})})
   assert.equal((await handleMigration(req(),['migration'],identity))?.status,403)
   process.env.PEA_CLINICAL_IMPORT_ENABLED='true'
   assert.equal((await handleMigration(req(),['migration'],{...identity,context:'clinical'}))?.status,403)
   assert.equal((await handleMigration(req(),['migration'],identity))?.status,200)
   delete process.env.PEA_CLINICAL_IMPORT_ENABLED
  }
  assert.equal(calls.length,3);assert.ok(calls.every(call=>Array.isArray(call)&&call[2]==='fictional-jwt'))
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
 const render=(locked=false)=>(exports.MigrationClientPreparation as (props:Record<string,unknown>)=>ReactNode)({row,disabled:false,saved:locked,onChange:(value:preparation.MigrationPreparation)=>{row={...row,preparation:value}},onDefaults(){},onSave(){saved++}})
 assert.match(renderToStaticMarkup(render()),/Date de contact|Motif de consultation|Conditions et modalités administratives/)
 let checks=elements(render()).filter(node=>node.type==='input'&&node.props.type==='checkbox')
 ;(checks[0].props.onChange as (e:unknown)=>void)({target:{checked:true}})
 checks=elements(render()).filter(node=>node.type==='input'&&node.props.type==='checkbox')
 ;(checks[1].props.onChange as (e:unknown)=>void)({target:{checked:true}})
 assert.match(renderToStaticMarkup(render()),/doivent totaliser 100/)
 const labels=elements(render()).filter(node=>node.type==='input'&&String(node.props['aria-label']).startsWith('Part de ')).map(node=>node.props['aria-label'])
 for(const label of labels){const input=elements(render()).find(node=>node.type==='input'&&node.props['aria-label']===label)!;(input.props.onChange as(e:unknown)=>void)({target:{value:'50'}})}
 const button=elements(render()).find(node=>node.type==='button'&&node.props.children==='Enregistrer et valider ce client')!
 assert.equal(button.props.disabled,false);(button.props.onClick as()=>void)();assert.equal(saved,1)
 assert.equal(elements(render(true)).find(node=>node.type==='button'&&node.props.children==='Client enregistré et validé')?.props.disabled,true)
})
