import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {Children,isValidElement,type ReactNode,type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {emptyMigrationRow} from '../lib/clinical-migration/model.ts'
import {migrationReviewQueue} from '../lib/clinical-migration/review.ts'
const require=createRequire(import.meta.url)
function elements(node:ReactNode):ReactElement<Record<string,unknown>>[]{return isValidElement<Record<string,unknown>>(node)?[node,...Children.toArray(node.props.children as ReactNode).flatMap(elements)]:[]}

test('sélecteur réel : avancement, recherche et navigation sans enregistrement implicite',()=>{
 const exports:Record<string,unknown>={}
 const source=readFileSync(new URL('../components/clinical-migration/MigrationReviewQueue.tsx',import.meta.url),'utf8')
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 runInNewContext(js,{exports,require:(specifier:string)=>{
  if(specifier==='react/jsx-runtime')return require(specifier)
  if(specifier==='@/components/Ui')return{buttonClass:()=>''}
  if(specifier==='@/components/clinical-workspace/styles')return{clinicalInput:''}
  throw Error('Unexpected import '+specifier)
 }})
 const first={...emptyMigrationRow('fixture:first'),firstName:'Premier',lastName:'Fictif',professionalId:'pro',service:'Psychoéducation',decision:'create' as const}
 const second={...first,sourceKey:'fixture:second',firstName:'Deuxième',service:'À préciser'}
 const queue=migrationReviewQueue([{index:0,row:first},{index:1,row:second}],[])
 let selected='',search='',filter=''
 const render=(busy=false)=>(exports.MigrationReviewQueue as(props:Record<string,unknown>)=>ReactNode)({entries:queue,visible:queue,activeSource:queue[0].key,search:'',filter:'all',completed:1,total:3,busy,onSearch:(value:string)=>{search=value},onFilter:(value:string)=>{filter=value},onSelect:(value:string)=>{selected=value}})
 const tree=render(),markup=renderToStaticMarkup(tree)
 assert.match(markup,/1 dossier\(s\) traité\(s\) sur 3/);assert.match(markup,/Prêt à enregistrer/);assert.match(markup,/À vérifier/)
 const controls=elements(tree)
 const previous=controls.find(node=>node.type==='button'&&node.props.children==='Précédent')!,next=controls.find(node=>node.type==='button'&&node.props.children==='Suivant')!
 assert.equal(previous.props.disabled,true);assert.equal(next.props.disabled,false);(next.props.onClick as()=>void)();assert.equal(selected,queue[1].key)
 const input=controls.find(node=>node.type==='input'&&node.props.type==='search')!;(input.props.onChange as(event:unknown)=>void)({target:{value:'Fictif'}});assert.equal(search,'Fictif')
 const filterButton=controls.filter(node=>node.type==='button'&&node.props['aria-pressed']!==undefined)[1];(filterButton.props.onClick as()=>void)();assert.equal(filter,'blocked')
 assert.ok(elements(render(true)).filter(node=>node.type==='button').every(node=>node.props.disabled===true))
 assert.doesNotMatch(markup,/Enregistrer et valider/)
})
