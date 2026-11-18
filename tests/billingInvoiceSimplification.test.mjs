import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {createElement,Children,isValidElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {PGlite} from '@electric-sql/pglite'
const require=createRequire(import.meta.url)
const box=({children})=>createElement('div',null,children)
const invoice={id:'30000000-0000-4000-8000-000000000001',clientId:'30000000-0000-4000-8000-000000000002',payerId:'30000000-0000-4000-8000-000000000003',version:1,status:'draft',clientName:'Client Fictif',professionalName:'Professionnel Fictif',payerName:'Payeur Fictif',payerEmail:'payer@example.invalid',totalCents:13500,paidCents:0,refundedCents:0,creditedCents:0,dueCents:13500,refundableCents:0,documents:[],lines:[],serviceDate:'2026-11-18'}
const ui={data:{selected:{invoice,ledger:[]},canManagePayments:true,canCreditRefund:true},busy:false,run:async()=>{throw Error('Unexpected mutation')},refresh:async()=>{}}
function load(file,overrides={}){
 let cursor=0,refCursor=0
 const states=[],refs=[],effects=[],forms=[]
 const hooks={useState(v){const i=cursor++;if(!(i in states))states[i]=v;return[states[i],n=>{states[i]=typeof n==='function'?n(states[i]):n}]},useRef(v){const i=refCursor++;refs[i]??={current:v};return refs[i]},useEffect(fn){effects.push(fn)}}
 const exports={}
 const code=ts.transpileModule(readFileSync(new URL('../components/clinical-billing/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
 runInNewContext(code,{exports,AbortController,URLSearchParams,crypto:{randomUUID:()=>invoice.id},process:{env:{NEXT_PUBLIC_PEA_CONTROLLED_MERGE:'true'}},Error,window:{confirm:()=>false},...overrides.globals,require(name){
  if(overrides[name])return overrides[name]
  if(name==='react')return hooks
  if(name==='react/jsx-runtime')return require(name)
  if(name==='@/components/Ui')return{buttonClass:()=>'',Badge:box}
  if(name==='@/components/clinical-workspace/NavigationGuard')return{useClinicalNavigation:()=>({canLeave:async()=>true}),useClinicalFormGuard(){}}
  if(name==='./primitives')return{clinicalCard:'',inputClass:'',Field:box,read:(form,key)=>form[key]??'',BillingForm:props=>{forms.push(props);return createElement('form',null,props.children,createElement('button',null,props.submitLabel))}}
  if(name==='./model')return{money:n=>String(n/100),moneyInput:n=>(n/100).toFixed(2),parseCents:(v)=>Math.round(Number(v)*100),dateLabel:v=>v,invoiceStatusLabels:{},paymentLabels:{card_demo:'Carte manuelle',cash_demo:'Comptant',transfer_demo:'Virement Interac',deposit_demo:'Dépôt'},reasonLabels:{billing_correction:'Correction'}}
  if(name==='./InvoicePayment')return{InvoicePayment:()=>createElement('section',{id:'invoice-action-payment'},'Paiement et reçu')}
  if(name==='./PaymentCorrections')return{PaymentCorrections:()=>null}
  if(name==='@/lib/clinical-finance/durableClient')return{}
  throw Error('Unexpected module '+name)
 }})
 return{exports,states,effects,forms,render(name,...props){cursor=0;refCursor=0;forms.length=0;return exports[name](...props)}}
}
function elements(node){if(!isValidElement(node))return[];if(typeof node.type==='function')return elements(node.type(node.props));return[node,...Children.toArray(node.props.children).flatMap(elements)]}
test('facture : envoi sous le total, fermeture en dernier, aucune annulation manuelle',()=>{
 const h=load('InvoiceDetail.tsx'),html=renderToStaticMarkup(h.render('InvoiceDetail',{ui}))
 assert.ok(html.indexOf('À payer')<html.indexOf('invoice-action-send'))
 assert.ok(html.indexOf('invoice-action-send')<html.indexOf('invoice-action-payment'))
 assert.ok(html.indexOf('invoice-action-payment')<html.indexOf('invoice-action-close'))
 assert.match(html,/Fermer cette facture/);assert.doesNotMatch(html,/Terminer cette facture|Carte de crédit de/)
 const correction=load('PaymentCorrections.tsx')
 assert.equal(correction.render('PaymentCorrections',{ui}),null)
})
test('paiement : carte présélectionnée seulement si présente, choix manuel possible sans débit automatique',async()=>{
 let card={hasCard:true,brand:'Visa',last4:'4242'}
 const h=load('InvoicePayment.tsx',{'./SavedCardChargePanel':{useSavedPayerCard:()=>({card,error:''}),SavedCardChargePanel:()=>createElement('div',{'data-saved-card':true},'Carte prête')}})
 let nodes=elements(h.render('InvoicePayment',{ui}));assert.equal(nodes.find(x=>x.type==='select').props.value,'saved_card')
 assert.equal(nodes.filter(x=>x.props['data-saved-card']).length,1);assert.equal(h.forms.length,0)
 await nodes.find(x=>x.type==='select').props.onChange({target:{value:'cash_demo'}});await Promise.resolve()
 nodes=elements(h.render('InvoicePayment',{ui}));assert.equal(nodes.find(x=>x.type==='select').props.value,'cash_demo')
 const command=h.forms[0].build({amount:'100.00',reference:'Fictif'},'primary');assert.equal(command.action,'payment.record');assert.equal(command.data.method,'cash_demo');assert.equal(command.data.amountCents,10000)
 card={hasCard:false};nodes=elements(h.render('InvoicePayment',{ui}))
 assert.equal(nodes.some(x=>x.type==='option'&&x.props.value==='saved_card'),false)
 assert.equal(nodes.some(x=>x.props['data-saved-card']),false)
})
test('recherche de carte : identité du payeur, dernier quatre chiffres et purge lors du changement de portée',async()=>{
 const calls=[]
 const h=load('SavedCardChargePanel.tsx',{'@/lib/clinical-unification/authClient':{clinicalSessionFetch:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({hasCard:true,brand:'Visa',last4:'4242'})}}}})
 assert.equal(h.exports.useSavedPayerCard(invoice.clientId,invoice.payerId).card,null)
 const cleanup=h.effects[0]();await new Promise(resolve=>setImmediate(resolve))
 assert.equal(h.render('useSavedPayerCard',invoice.clientId,invoice.payerId).card.hasCard,true)
 assert.equal(h.render('useSavedPayerCard','other','payer').card,null)
 assert.match(calls[0].url,new RegExp(invoice.payerId));assert.equal(calls[0].options.cache,'no-store');cleanup();assert.equal(calls[0].options.signal.aborted,true)
 assert.equal(h.states[0].card.hasCard,true)
})
test('débit enregistré : aucun appel au rendu ou après refus, montant conservé et confirmation explicite avant le POST',async()=>{
 let confirm=false;const calls=[]
 const h=load('SavedCardChargePanel.tsx',{globals:{window:{confirm:()=>confirm}},'@/lib/clinical-unification/authClient':{clinicalSessionFetch:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({status:'confirme'})}}}})
 const props={invoiceId:invoice.id,payerName:'Payeur Fictif',expectedVersion:1,dueCents:13500,disabled:false,refresh:async()=>{},card:{hasCard:true,brand:'Visa',last4:'4242'},amount:'100.00',setAmount(){}}
 let form=elements(h.render('SavedCardChargePanel',props)).find(n=>n.type==='form');assert.equal(calls.length,0)
 form.props.onSubmit({preventDefault(){}});assert.equal(calls.length,0)
 confirm=true;form=elements(h.render('SavedCardChargePanel',props)).find(n=>n.type==='form');form.props.onSubmit({preventDefault(){}})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);assert.match(calls[0].url,/stripe\/charge$/)
 assert.equal(JSON.parse(calls[0].options.body).amountCents,10000);assert.equal(calls[0].options.method,'POST')
})
test('SQL : annulation directe refusée, fermeture et autres commandes déléguées sans toucher aux archives',async()=>{
 const db=new PGlite()
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema clinical;
   create function clinical.unified_context(text) returns void language plpgsql as $$begin if current_setting('test.authorized',true) is distinct from 'yes' then raise exception 'DENIED' using errcode='42501';end if;end $$;
   create function public.clinical_unified_finance_command(p_key uuid,p_action text,p_data jsonb) returns jsonb language sql as $$select jsonb_build_object('action',p_action)$$;`)
  await db.exec(readFileSync(new URL('../supabase/clinical/real-980-disable-manual-invoice-void.sql',import.meta.url),'utf8'))
  await db.exec("set role authenticated;select set_config('test.authorized','yes',false)")
  await assert.rejects(db.query('select public.clinical_unified_finance_command($1,$2,$3)',[invoice.id,'invoice.void',{}]),e=>e.code==='42501')
  assert.equal((await db.query('select public.clinical_unified_finance_command($1,$2,$3) q',[invoice.id,'invoice.issue',{}])).rows[0].q.action,'invoice.issue')
  await assert.rejects(db.query('select public.clinical_unified_finance_command_980_base($1,$2,$3)',[invoice.id,'invoice.void',{}]),e=>e.code==='42501')
 }finally{await db.close()}
})
