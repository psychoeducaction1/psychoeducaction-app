import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createHash } from 'node:crypto'
import { SUPER_ADMIN_EMAIL } from '../../lib/superAdmin.ts'
import { calculatePayroll } from '../../lib/payrollCalculator.ts'
import { toPayrollInvoiceData } from '../../lib/generatePayrollInvoiceDocx.ts'
import { payrollInvoiceSnapshot } from '../../lib/payrollInvoiceRegistry.ts'

const professionalId='00000000-0000-4000-8000-000000000001'
const invoiceId='00000000-0000-4000-8000-000000000002'
const professional={id:professionalId,fullName:'Fournisseur Fictif',email:'pro@example.invalid',payrollCategory:'psychoeducateur_membre_ordre',professionalTitle:'Titre du profil',professionalAddress:null,professionalPhone:null}
const period={startDate:'2026-10-19',endDate:'2026-11-01',dueDate:'2026-11-06'}
const rows=[['DATE','PROFESSIONNEL','CLIENT','REQUERANT','DESCRIPTION','DETAIL','EMPLACEMENT','PAYE','MONTANT RECLAME','MANDAT'],
  ['2026-10-19\n09:00 - 10:00',professional.fullName,'PATIENT-FICTIF-PRIVE','','Rencontre','','','',110,'']]
const snapshot=payrollInvoiceSnapshot(period,toPayrollInvoiceData(calculatePayroll(rows,[professional],period).professionalResults[0]))
let scenario='ok', adminCalls=0, rpcCalls=0, sealed=null, rpcArgs=null, sent=null
const bytes=Buffer.from('DOCUMENT ORIGINAL FICTIF')
const hash=createHash('sha256').update(bytes).digest('hex')
const archive={snapshot,document_base64:bytes.toString('base64'),document_name:'Facture-fixture.docx',document_sha256:hash}

globalThis.__invoiceGuard=async()=>scenario==='anonymous'?{error:{message:'Non autorisé',status:401}}:
  scenario==='disabled'?{error:{message:'Accès refusé',status:403}}:
  {context:{user:{id:professionalId,email:scenario==='not_payroll'?'no-access@example.invalid':SUPER_ADMIN_EMAIL},profile:{role:'direction',full_name:'Direction fictive'}}}
globalThis.__invoiceAdmin=()=>{adminCalls++; return {
  async rpc(name,args) {assert.equal(name,'prepare_payroll_invoice');rpcCalls++;rpcArgs=args;return scenario==='migration_missing'?{data:null,error:{message:'RPC missing'}}:{data:{id:invoiceId,number:'PEA-2026-000001',version:1,reason:null,snapshot:args.p_action==='import'?null:args.p_snapshot},error:null}},
  from(table) {
    let update=null
    const query={select(){return this},eq(){return this},is(){return this},order(){return this},limit(){return this},
      update(value){update=value;return this},insert(){return this},
      async maybeSingle(){return {data:table==='payroll_invoices'?{professional_id:professionalId,number:'PEA-2026-000001'}:
        scenario==='tampered'?{...archive,document_sha256:'invalid'}:scenario==='historical'?{...archive,snapshot:null}:archive,error:null}},
      then(resolve){if(update)sealed=update;return resolve({data:[],error:null})}}
    return query
  }
}}
globalThis.__invoiceProfiles=()=>({from(){return {select(){return this},eq(){return this},then(resolve){return resolve({data:[{
  id:professionalId,full_name:professional.fullName,email:professional.email,professional_title:professional.professionalTitle,
  payroll_category:professional.payrollCategory,professional_phone:null,professional_address:null}],error:null})}}}})
const url=code=>`data:text/javascript,${encodeURIComponent(code)}`
registerHooks({resolve(specifier,context,next){
  if(specifier==='server-only')return {url:url('export {}'),shortCircuit:true}
  if(specifier==='@/lib/directionServer')return {url:url('export const getDirectionContext=globalThis.__invoiceGuard'),shortCircuit:true}
  if(specifier==='@/lib/supabaseAdmin')return {url:url('export const getSupabaseAdmin=globalThis.__invoiceAdmin'),shortCircuit:true}
  if(specifier==='@supabase/supabase-js')return {url:url('export const createClient=globalThis.__invoiceProfiles'),shortCircuit:true}
  if(specifier==='next/server')return next('next/server.js',context)
  return next(specifier,context)
}})
const {NextRequest}=await import('next/server.js')
const route=await import('../../app/api/direction/payroll-invoices/route.ts')
const emailRoute=await import('../../app/api/direction/payroll-invoice-email/route.ts')
for(const name of ['anonymous','disabled','not_payroll','invalid_rows','zero_duration','forged_total','migration_missing','ok','import']){
  scenario=name;adminCalls=0;rpcCalls=0;sealed=null;rpcArgs=null
  const body={professionalId,period,rows:structuredClone(rows),action:'prepare',grandTotal:1,professionalTitle:'Titre falsifié'}
  if(name==='invalid_rows')body.rows=[{}]
  if(name==='zero_duration')body.rows[1][0]='2026-10-19\n09:00 - 09:00'
  if(name==='import')Object.assign(body,{action:'import',legacyNumber:'PEA-AG-021',originalName:'original.pdf',originalSigned:true,originalBase64:Buffer.from('%PDF-1.7\nORIGINAL FICTIF').toString('base64')})
  const response=await route.POST(new NextRequest('https://fixture.example.invalid/api/direction/payroll-invoices',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture'},body:JSON.stringify(body)}))
  const expected=name==='anonymous'?401:['disabled','not_payroll'].includes(name)?403:name==='invalid_rows'?400:name==='zero_duration'?422:name==='migration_missing'?503:200
  assert.equal(response.status,expected,name)
  assert.equal(response.headers.get('cache-control'),'private, no-store')
  if(['anonymous','disabled','not_payroll','invalid_rows','zero_duration'].includes(name))assert.equal(adminCalls,0,name)
  if(expected===200&&name!=='import'){
    assert.equal(rpcCalls,1)
    assert.equal(rpcArgs.p_snapshot.invoice.grandTotal,66)
    assert.equal(rpcArgs.p_snapshot.invoice.professional.professionalTitle,'Titre du profil')
    assert.doesNotMatch(JSON.stringify(rpcArgs.p_snapshot),/PATIENT-FICTIF|Titre falsifié/)
    assert.match(rpcArgs.p_snapshot.sourceSha256,/^[a-f0-9]{64}$/)
    assert.ok(sealed.document_base64)
  }
  if(name==='import'){assert.equal(rpcArgs.p_snapshot,null);assert.equal(rpcArgs.p_original_signed,true);assert.equal(sealed,null)}
}
scenario='ok'
const downloaded=await route.GET(new NextRequest(`https://fixture.example.invalid/api/direction/payroll-invoices?id=${invoiceId}&version=1`))
assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes,'Régénération télécharge les octets archivés sans rerendre')
scenario='tampered'
assert.equal((await route.GET(new NextRequest(`https://fixture.example.invalid/api/direction/payroll-invoices?id=${invoiceId}&version=1`))).status,409)
process.env.RESEND_API_KEY='fixture-only'
globalThis.fetch=async(endpoint,options)=>{assert.equal(endpoint,'https://api.resend.com/emails');sent=JSON.parse(options.body);return Response.json({id:'fixture'})}
for(const name of ['ok','historical','tampered']){
  scenario=name;sent=null
  const response=await emailRoute.POST(new NextRequest('https://fixture.example.invalid/api/direction/payroll-invoice-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoiceId,version:1,to:'forged@example.invalid',subject:'Facture fictive',message:'Message fictif',attachmentBase64:'forged'})}))
  assert.equal(response.status,name==='ok'?200:409,name)
  if(name==='ok'){assert.deepEqual(sent.to,['pro@example.invalid']);assert.equal(sent.attachments[0].content,archive.document_base64)}
  else assert.equal(sent,null)
}
console.log('Routes de factures : droits, recalcul serveur, archive, intégrité et pièce jointe immuable vérifiés hors ligne.')
