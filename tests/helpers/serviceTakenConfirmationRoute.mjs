import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { buildServiceTakenConfirmationEmail } from '../../lib/serviceTakenConfirmationEmail.ts'
import { buildServiceAppointment } from '../../lib/serviceAppointment.ts'
let scenario='ok', calls=[], reads=0
const id='10000000-0000-4000-8000-000000000001'
const appointment=buildServiceAppointment({date:'2026-11-10',time:'14:30',modality:'montreal'}, {montreal:'100, rue Fictive, bureau 233, Montréal',longueuil:'200, avenue Fictive'})
process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.example.invalid'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-public'
globalThis.__serviceGuard=async()=>scenario==='anonymous'?{error:{status:401,message:'Session requise'}}:
  scenario==='forbidden'?{error:{status:403,message:'Accès refusé'}}:
    {context:{user:{id,email:'direction@example.invalid'},profile:{role:'direction',full_name:'Direction fictive'}}}
globalThis.__serviceSend=async args=>{calls.push(args)}
globalThis.__serviceClient=()=>({from(table){reads++;return {
  select(){return this},eq(){return this},limit(){return this},
  async maybeSingle(){
    if(table==='assigned_clients') return {data:{id,first_name:'Client fictif',last_name:'Fixture',email:'client@example.invalid',professional_id:id,
      is_active:scenario==='pending'?null:true,canceled_at:scenario==='canceled'?'2026-10-01':null,
      service_appointment:scenario==='legacy'?null:scenario==='corrupt'?{...appointment,time:'12:00'}:appointment},error:null}
    if(table==='profiles')return {data:{full_name:'Professionnel fictif',professional_civility:'Mme',email:'pro@example.invalid',professional_phone:'000-000-0000',role:'professionnel'},error:null}
    if(table==='audit_logs')return {data:scenario==='already_sent'?{id}:null,error:scenario==='audit_failure'?{message:'Erreur fictive'}:null}
    assert.fail('Table inattendue')
  },
  async insert(value){assert.deepEqual(value.metadata.service_appointment,appointment);return {error:null}}
}}})
const codeUrl=code=>`data:text/javascript,${encodeURIComponent(code)}`
registerHooks({resolve(specifier,context,next){
  if(specifier==='server-only')return {url:codeUrl('export {}'),shortCircuit:true}
  if(specifier==='@/lib/directionServer')return {url:codeUrl('export const getDirectionContext=globalThis.__serviceGuard'),shortCircuit:true}
  if(specifier==='@/lib/resendEmail')return {url:codeUrl('export const sendResendEmail=globalThis.__serviceSend'),shortCircuit:true}
  if(specifier==='@supabase/supabase-js')return {url:codeUrl('export const createClient=globalThis.__serviceClient'),shortCircuit:true}
  if(specifier==='next/server')return next('next/server.js',context)
  return next(specifier,context)
}})
const {NextRequest}=await import('next/server.js')
const {POST}=await import('../../app/api/direction/service-taken-confirmation/route.ts')
const template=buildServiceTakenConfirmationEmail({clientFullName:'Client fictif Fixture',professionalName:'Professionnel fictif',professionalCivility:'Mme',professionalEmail:'pro@example.invalid',professionalPhone:'000-000-0000',appointment})
for(const [name,status]of [['anonymous',401],['forbidden',403],['pending',409],['canceled',409],['legacy',409],['corrupt',409],['audit_failure',500],['already_sent',200],['ok',200]]){
  scenario=name;calls=[];reads=0
  const response=await POST(new NextRequest('https://fixture.example.invalid/service-confirmation',{method:'POST',headers:{Authorization:'Bearer fixture'},
    body:JSON.stringify({assignedClientId:id,action:'send',subject:template.subject,message:template.text,appointment:{date:'1999-01-01',time:'00:00',modality:'home'},to:'forged@example.invalid'})}))
  assert.equal(response.status,status,name)
  if(name==='anonymous'||name==='forbidden')assert.equal(reads,0)
  if(name!=='ok')assert.equal(calls.length,0,name)
  else {
    assert.equal(calls.length,1)
    assert.match(calls[0].text,/Mme Professionnel fictif/)
    assert.equal(calls[0].text.split('Client fictif Fixture').length - 1,1)
    assert.doesNotMatch(calls[0].text,/heure exacte|voiture|extérieur|ouvrira/)
    assert.ok(calls[0].html)
    assert.equal(calls[0].to,'client@example.invalid')
    assert.deepEqual(calls[0].cc,['pro@example.invalid'])
    assert.match(calls[0].text,/10 novembre 2026/);assert.match(calls[0].text,/14 h 30/)
    assert.ok(calls[0].text.includes(appointment.address));assert.doesNotMatch(calls[0].text,/1999|domicile/)
    assert.equal(calls[0].idempotencyKey,`service-taken-confirmation/${id}`)
  }
}
console.log('Courriel de rendez-vous vérifié hors ligne : droits, données persistées, historique, copie professionnelle et clé de réessai.')

scenario='ok';calls=[]
let response=await POST(new NextRequest('https://fixture.example.invalid/service-confirmation',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({assignedClientId:id,action:'preview'})}))
assert.equal(response.status,200)
let preview=await response.json()
assert.equal(preview.message,template.text)
assert.equal(preview.recipient,'client@example.invalid')
assert.equal(preview.cc,'pro@example.invalid')
assert.equal(calls.length,0,'Aucun envoi pendant un aperçu')
for(const body of [{assignedClientId:id},{assignedClientId:id,action:'send',subject:'',message:'Texte'}, {assignedClientId:id,action:'send',subject:'Sujet\nInjecté',message:'Texte'}, {assignedClientId:id,action:'send',subject:'Sujet',message:'a'.repeat(30001)}]){
  reads=0
  response=await POST(new NextRequest('https://fixture.example.invalid/service-confirmation',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify(body)}))
  assert.equal(response.status,400)
  assert.equal(reads,0)
  assert.equal(calls.length,0)
}
response=await POST(new NextRequest('https://fixture.example.invalid/service-confirmation',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({assignedClientId:id,action:'send',subject:'Sujet personnalisé',message:'Message personnalisé <script>test</script>',to:'forged@example.invalid',cc:'forged@example.invalid'})}))
assert.equal(response.status,200)
assert.equal(calls.length,1)
assert.equal(calls[0].subject,'Sujet personnalisé')
assert.equal(calls[0].text,'Message personnalisé <script>test</script>')
assert.doesNotMatch(calls[0].html,/<script>/)
assert.match(calls[0].html,/&lt;script&gt;/)
assert.equal(calls[0].to,'client@example.invalid')
assert.deepEqual(calls[0].cc,['pro@example.invalid'])
console.log('Aperçu sans envoi, envoi explicite, personnalisation, limites et destinataires persistés vérifiés.')
