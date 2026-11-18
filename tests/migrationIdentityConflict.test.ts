import test from 'node:test'
import assert from 'node:assert/strict'
import {migrationRpcFailure} from '../lib/clinical-migration/errors.ts'
import {emptyMigrationRow,migrationExistingErrors} from '../lib/clinical-migration/model.ts'
import {handleMigration} from '../lib/clinical-unification/migrationHttp.ts'

test('identité : une confirmation ne permet pas de remplacer une naissance différente',()=>{
 const row={...emptyMigrationRow('fixture:identity'),firstName:'Client',lastName:'Fictif',birthDate:'2000-01-02',decision:'link' as const,patientId:'fictional-patient',caseId:'fictional-case',professionalId:'fictional-pro',associationConfirmed:true}
 const person={id:row.patientId,firstName:row.firstName,lastName:row.lastName,birthDate:'2000-01-01',email:'',phone:'',version:1,cases:[{id:row.caseId,label:'Fictif',status:'open',professionalIds:[row.professionalId]}]}
 assert.match(migrationExistingErrors([row],[person])[0],/date de naissance/)
 assert.deepEqual(migrationExistingErrors([{...row,birthDate:person.birthDate}],[person]),[])
 assert.match(migrationExistingErrors([{...row,birthDate:person.birthDate,firstName:'Autre'}],[person])[0],/prénom ou le nom/)
 assert.match(migrationExistingErrors([{...row,birthDate:person.birthDate}],[])[0],/plus disponible/)
 assert.deepEqual(migrationExistingErrors([{...row,decision:'skip'}],[person]),[])
 assert.deepEqual(migrationExistingErrors([{...row,birthDate:''}],[person]),[])
 const operational={...person,id:'fictional-assignment',professionalId:row.professionalId,fingerprint:'fixture',status:'open'}
 assert.match(migrationExistingErrors([{...row,decision:'operational',assignmentId:operational.id}],[],[operational])[0],/date de naissance/)
})
test('erreurs : seuls les codes fixes traversent la frontière RPC',()=>{
 for(const code of ['22023','PT409','40001'])assert.equal(migrationRpcFailure({code,message:'MIGRATION_BIRTH_DATE_MISMATCH'})?.status,409)
 assert.equal(migrationRpcFailure({code:'PATIENT_CHANGED',message:'untrusted input'})?.code,'PATIENT_CHANGED')
 assert.equal(migrationRpcFailure({code:'PT409',message:'SQL avec données fictives privées'}),null)
 assert.equal(migrationRpcFailure({code:'42501',message:'PATIENT_CHANGED'}),null)
})
test('API : refus de naissance clair, sans réessai de la mutation',async()=>{
 let calls=0
 const identity={context:'administration' as const,token:'fictional-token',transport:{authenticate:async()=>null,rpc:async()=>{calls++;throw Object.assign(new Error('MIGRATION_BIRTH_DATE_MISMATCH'),{code:'MIGRATION_BIRTH_DATE_MISMATCH'})}}}
 const previous=process.env.PEA_CLINICAL_IMPORT_ENABLED
 try{
 process.env.PEA_CLINICAL_IMPORT_ENABLED='true'
 const response=await handleMigration(new Request('https://example.invalid/api/clinical-workspace/migration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'client.save',batchId:'96000000-0000-4000-8000-000000000001',data:{}})}),['migration'],identity)
 assert.equal(response?.status,409);assert.equal(calls,1)
 assert.match((await response!.json()).error,/date de naissance/)
 }finally{if(previous===undefined)delete process.env.PEA_CLINICAL_IMPORT_ENABLED;else process.env.PEA_CLINICAL_IMPORT_ENABLED=previous}
})

test('transport réel simulé : le conflit conserve son code métier jusqu’à la réponse HTTP',async()=>{
 const {realClinicalTransport}=await import('../lib/clinical-real/transport.ts')
 const keys=['PEA_CLINICAL_RUNTIME','PEA_CLINICAL_REAL_SUPABASE_URL','PEA_CLINICAL_REAL_ANON_KEY','PEA_CLINICAL_IMPORT_ENABLED'] as const
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]])),originalFetch=globalThis.fetch
 let calls=0
 try{
 Object.assign(process.env,{PEA_CLINICAL_RUNTIME:'real-db',PEA_CLINICAL_REAL_SUPABASE_URL:'https://fictional.supabase.co',PEA_CLINICAL_REAL_ANON_KEY:'sb_publishable_fictionalfixture',PEA_CLINICAL_IMPORT_ENABLED:'true'})
 globalThis.fetch=async()=>{calls++;return Response.json({code:'PT409',message:'PATIENT_CHANGED',details:'fixture non publiée'},{status:409})}
 const response=await handleMigration(new Request('https://example.invalid/api/clinical-workspace/migration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'client.save',batchId:'96000000-0000-4000-8000-000000000001',data:{}})}),['migration'],{context:'administration',token:'fictional-token',transport:realClinicalTransport()})
 assert.equal(response?.status,409);assert.equal(calls,1)
 const body=await response!.json();assert.equal(body.code,'PATIENT_CHANGED');assert.doesNotMatch(JSON.stringify(body),/fixture non publiée/)
 }finally{globalThis.fetch=originalFetch;for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}}
})
