import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createReferenceDatabase } from '../scripts/clinical-db/run-reference.mjs'
import { isMandateWorkspace } from '../lib/clinical-mandates/transport.ts'

const source = p => readFile(new URL('../'+p,import.meta.url),'utf8')
test('migration individuelle : transaction complète, historique, mandat validé et signatures différées', async t => {
 const db=await createReferenceDatabase()
 try {
  await db.exec(`alter table public.profiles alter column full_name set not null,alter column role set not null,alter column is_active set not null,alter column platform_access_enabled set not null;
   alter table public.waiting_list_clients alter column service_requested set not null,alter column consultation_reason set not null;
   alter table public.assigned_clients alter column professional_id set not null,alter column first_name set not null,alter column last_name set not null,alter column dossier_closed set not null,alter column dossier_closed set default false;
   alter table public.profiles add column administrative_access text not null default 'none';
   drop table pea_reference.fixture_marker;set pea.unification_pilot='true';`)
  const manifest=(await source('scripts/clinical-db/run-real-isolated.mjs')).match(/const migrations = \[([\s\S]*?)\n\]/)[1]
  const initial=[...manifest.matchAll(/'([^']+\.sql)'/g)].map(m=>m[1])
  // 820 also rewrites unrelated marketing/payroll RPCs absent from this clinical
  // fixture. Its operator capability column is represented below, without grants.
  const extra=(await readdir(new URL('../supabase/clinical/',import.meta.url))).filter(n=>/^real-(4[6-9]\d|[5-8]\d\d)-.*\.sql$/.test(n)&&!n.startsWith('real-820-')).sort()
  extra.splice(extra.indexOf('real-530-unified-mandates.sql'),0,extra.splice(extra.indexOf('real-535-unified-pdf-renderers.sql'),1)[0])
  for(const name of [...initial,...extra,'real-910-mandate-date-guards.sql','real-920-individual-client-migration.sql']) {
   if(name==='real-920-individual-client-migration.sql')await db.exec('alter table clinical.migration_operators add column can_import boolean not null default true')
   try {await db.exec(await source('supabase/clinical/'+name))} catch(error){throw new Error('Fixture migration '+name+': '+error.message,{cause:error})}
  }
  const admin='98300000-0000-4000-8000-000000000001',pro='98300000-0000-4000-8000-000000000002'
  await db.exec('create table auth.users(id uuid primary key,email text,aud text,role text)')
  const fixture=(await source('scripts/clinical-db/verify-mandate-supervision.sql')).split("set local request.jwt.claim.sub='98300000-0000-4000-8000-000000000002';")[0]
  await db.exec(fixture.replace(/insert into clinical\.professional_signatures[\s\S]*?;\s*set local request/, 'set local request'))
  await db.exec(`insert into clinical.migration_operators values('${admin}',true);select set_config('request.jwt.claim.sub','${admin}',false);select set_config('pea.clinical_context','administration',false);`)
  const command=async(action,batch,data)=>{
   await db.exec('set role authenticated')
   try {return (await db.query('select public.clinical_migration_command($1,$2,$3) q',[action,batch,data])).rows[0].q} finally {await db.exec('reset role')}
  }
  const preparation={contactDate:'2023-01-05',startDate:'2023-01-05',outcome:'active',additionalEmails:'',additionalPhones:'',consultationReason:'Motif fictif',modalities:'Présentiel',availability:'Soir',comments:'Fictif',requesters:[{key:'requester-1',fullName:'Responsable Fictif',email:'payer@example.invalid',phone:'',address:'',relationship:''}],payers:[{key:'requester-1',basisPoints:10000}],rateCents:13500,rateSource:'file',clinicalText:'',administrativeText:'',settingsFingerprint:'',validated:true}
  const row={sourceKey:'fixture-individual:client-1',firstName:'Client',lastName:'Migration fictive',birthDate:'',email:'client@example.invalid',phone:'',address:'',service:'Psychoéducation',professionalId:pro,supervisorId:null,decision:'create',patientId:'',patientVersion:0,caseId:'',associationConfirmed:false,documents:[],dates:[],warnings:[],preparation}
  const batch=randomUUID()
  let state=await command('prepare',batch,{label:'Lot fictif',clientByClient:true,files:[],items:[row,{...row,sourceKey:'fixture-individual:client-2',lastName:'Deuxième fictif'}]})
  await t.test('préparer le lot ne crée aucun dossier ou mandat',async()=>{assert.equal(state.items.length,2);assert.equal((await db.query("select count(*)::int n from clinical.patients where last_name='Migration fictive'")).rows[0].n,0)})
  await t.test('l’ancien appel item ne contourne pas la validation individuelle',async()=>{
   await assert.rejects(command('item',batch,{sourceKey:row.sourceKey,documents:[],staged:true}),e=>e.code==='22023')
  })
  await t.test('enregistrer un seul client crée le mandat complet sans naissance ni signature',async()=>{
   state=await command('client.save',batch,{sourceKey:row.sourceKey,expectedVersion:state.batch.version,payload:row,documents:[],staged:true})
   assert.equal(state.items.find(x=>x.source_key===row.sourceKey).status,'imported',JSON.stringify(state.items.map(x=>x.error_code)))
   assert.equal(state.items.filter(x=>x.status==='imported').length,1)
   const result=state.items.find(x=>x.source_key===row.sourceKey).result
   const revision=(await db.query('select r.* from clinical.mandate_revisions r join clinical.mandates m on m.current_revision_id=r.id where m.id=$1',[result.mandateId])).rows[0]
   assert.equal(revision.status,'prepared');assert.equal(revision.rate_cents,13500);assert.equal(revision.unified_draft.serviceDate,'2023-01-05')
   const workspace=(await db.query(`select public.clinical_unified_mandate_query('administration',$1,$2) q`,[result.mandateId,result.patientId])).rows[0].q
   assert.equal(isMandateWorkspace(workspace,'administration',admin),true)
   assert.ok(revision.clinical_text.length);assert.equal((await db.query('select count(*)::int n from clinical.mandate_signatures where revision_id=$1',[revision.id])).rows[0].n,0)
   const history=(await db.query('select w.contact_date::text,a.is_active from public.waiting_list_clients w join public.assigned_clients a on a.waiting_list_client_id=w.id join clinical.legacy_assignment_links l on l.source_id=a.id where l.patient_id=$1',[result.patientId])).rows[0]
   assert.equal(String(history.contact_date).slice(0,10),'2023-01-05');assert.equal(history.is_active,true)
  })
  await t.test('reprise identique sans doublon et hors-lot refusé',async()=>{
   const before=(await db.query('select count(*)::int n from clinical.patients')).rows[0].n
   await command('client.save',batch,{sourceKey:row.sourceKey,expectedVersion:1,payload:row,documents:[],staged:true})
   assert.equal((await db.query('select count(*)::int n from clinical.patients')).rows[0].n,before)
   await assert.rejects(command('client.save',randomUUID(),{sourceKey:row.sourceKey,payload:row}),e=>e.code==='P0002')
  })
  await t.test('ajout différé de signature : date de migration conservée, preuve datée séparément, consentement client absent',async()=>{
   const rid=(await db.query('select current_revision_id id from clinical.mandates where id=$1',[state.items.find(x=>x.source_key===row.sourceKey).result.mandateId])).rows[0].id
   const original=(await db.query('select sha256 from clinical.mandate_documents where revision_id=$1 order by audience',[rid])).rows
   const accepted=(await db.query('select effective_at from clinical.mandate_professional_acceptances where revision_id=$1 and profile_id=$2',[rid,pro])).rows[0].effective_at
   await db.query(`insert into clinical.professional_signatures(professional_id,version,strokes,signature_hash,created_by) values($1,1,'[[{"x":0.1,"y":0.7},{"x":0.3,"y":0.2},{"x":0.6,"y":0.6}]]','fixture',$1)`,[pro])
   const signatures=(await db.query('select signed_at,evidence from clinical.mandate_signatures where revision_id=$1',[rid])).rows
   assert.equal(signatures.length,1);assert.equal(signatures[0].signed_at.toISOString(),accepted.toISOString())
   assert.ok(signatures[0].evidence.graphicAddedAt);assert.ok(signatures[0].evidence.strokes)
   assert.deepEqual((await db.query('select sha256 from clinical.mandate_documents where revision_id=$1 order by audience',[rid])).rows,original)
   assert.equal((await db.query('select status from clinical.mandate_revisions where id=$1',[rid])).rows[0].status,'partially_signed')
   assert.equal((await db.query('select clinical.unified_mandate_revision_json($1,true) q',[rid])).rows[0].q.professionalSignatureStatus,'ready')
  })
  const saveFresh=async(candidate)=>{
   const bid=randomUUID();const prepared=await command('prepare',bid,{label:'Autre lot fictif',clientByClient:true,files:[],items:[candidate]})
   return command('client.save',bid,{sourceKey:candidate.sourceKey,expectedVersion:prepared.batch.version,payload:candidate,documents:[],staged:true})
  }
  await t.test('client existant : valeurs renseignées remplacées, blancs conservés, requérant ajouté et ancienne convention immuable',async()=>{
   const first=state.items.find(x=>x.source_key===row.sourceKey).result
   const oldMandate=(await db.query('select current_revision_id id from clinical.mandates where id=$1',[first.mandateId])).rows[0].id
   const version=(await db.query('select version from clinical.patients where id=$1',[first.patientId])).rows[0].version
   const original=(await db.query('select sha256 from clinical.mandate_documents where revision_id=$1 order by audience',[oldMandate])).rows
   const updated={...row,decision:'link',patientId:first.patientId,patientVersion:version,caseId:first.caseId,associationConfirmed:true,email:'',phone:'5145550199',preparation:{...preparation,requesters:[...preparation.requesters,{key:'requester-2',fullName:'Deuxième Responsable',email:'two@example.invalid',phone:'',address:'',relationship:''}],payers:[{key:'requester-1',basisPoints:6000},{key:'requester-2',basisPoints:4000}]}}
   const answer=await saveFresh(updated);assert.equal(answer.items[0].status,'imported',answer.items[0].error_code)
   const patient=(await db.query('select email,phone from clinical.patients where id=$1',[first.patientId])).rows[0]
   assert.equal(patient.email,row.email);assert.equal(patient.phone,'5145550199')
   assert.equal((await db.query('select count(*)::int n from clinical.patient_contacts where patient_id=$1',[first.patientId])).rows[0].n,2)
   const current=(await db.query('select current_revision_id id from clinical.mandates where id=$1',[first.mandateId])).rows[0].id
   assert.notEqual(current,oldMandate);assert.deepEqual((await db.query('select sha256 from clinical.mandate_documents where revision_id=$1 order by audience',[oldMandate])).rows,original)
   assert.deepEqual((await db.query('select basis_points from clinical.mandate_payers where revision_id=$1 order by basis_points',[current])).rows.map(x=>x.basis_points),[4000,6000])
   assert.equal((await db.query('select count(*)::int n from public.assigned_clients a join clinical.legacy_assignment_links l on l.source_id=a.id where l.patient_id=$1',[first.patientId])).rows[0].n,1)
  })
  await t.test('champs absents et payeurs non renseignés : migration possible sans créer de payeur fictif',async()=>{
   const candidate={...row,sourceKey:'fixture-individual:empty',lastName:'Sans données fictif',email:'',preparation:{...preparation,contactDate:'',startDate:'',consultationReason:'',requesters:[],payers:[],rateCents:null,comments:'',modalities:'',availability:''}}
   const answer=await saveFresh(candidate);assert.equal(answer.items[0].status,'imported',answer.items[0].error_code)
   const result=answer.items[0].result
   assert.equal((await db.query('select birth_date from clinical.patients where id=$1',[result.patientId])).rows[0].birth_date,null)
   assert.equal((await db.query('select count(*)::int n from clinical.mandate_payers p join clinical.mandate_revisions r on r.id=p.revision_id where r.mandate_id=$1',[result.mandateId])).rows[0].n,0)
  })
  await t.test('mandat ordinaire : supervision sans image non bloquante et date automatique conservée à la préparation',async()=>{
   const created=(await db.query(`select public.clinical_create_patient('Acceptation','Ordinaire fictive','2000-01-01') id`)).rows[0].id
   const ep=(await db.query(`select public.clinical_create_episode($1,null,'Suivi fictif') id`,[created])).rows[0].id
   await db.query(`select public.clinical_create_case($1,'Cas fictif',jsonb_build_array(jsonb_build_object('actorId',$2::uuid,'canRead',true,'canWrite',true,'canCosign',false,'requiresCosignature',false,'supervisorId',null)))`,[ep,pro])
   const d=(await db.query(`select clinical.unified_mandate_initial_draft($1,$2,'95200000-0000-4000-8000-000000000002',current_date) d`,[created,pro])).rows[0].d
   d.supervisorId='98300000-0000-4000-8000-000000000003';d.legalReview={confirmed:true,context:'Vérification fictive',exceptionReason:''}
   const ack=(await db.query(`select public.clinical_unified_mandate_command('administration','mandate.create',$1,$2) q`,[{clientId:created,episodeId:ep,draft:d},randomUUID()])).rows[0].q
   const rid=ack.revisionId
   // Owner-only fixture clock change, never a supported application operation.
   await db.query("update clinical.mandate_professional_acceptances set effective_at='2020-01-02T12:00Z' where revision_id=$1",[rid])
   const v=(await db.query('select version from clinical.mandate_revisions where id=$1',[rid])).rows[0].version
   await db.query(`select public.clinical_unified_mandate_command('administration','mandate.prepare',$1,$2) q`,[{mandateId:ack.id,revisionId:rid,expectedVersion:v},randomUUID()])
   const sig=(await db.query('select signed_at from clinical.mandate_signatures where revision_id=$1 and person_id=$2',[rid,pro])).rows[0]
   assert.equal(sig.signed_at.toISOString(),'2020-01-02T12:00:00.000Z')
   assert.equal((await db.query('select count(*)::int n from clinical.mandate_signatures where revision_id=$1 and person_id=$2',[rid,d.supervisorId])).rows[0].n,0)
  })
  await t.test('résultats non pris et terminé : historique archivé sans place consommée',async()=>{
   const before=(await db.query('select id,remaining_count from public.assignment_requests order by id')).rows
   for(const outcome of ['not_taken','closed']){
    const candidate={...row,sourceKey:'fixture-individual:'+outcome.replace('_','-'),lastName:'Statut fictif '+outcome,preparation:{...preparation,outcome}}
    const answer=await saveFresh(candidate);assert.equal(answer.items[0].status,'imported',answer.items[0].error_code)
    const result=answer.items[0].result
    assert.equal((await db.query('select status from clinical.care_cases where id=$1',[result.caseId])).rows[0].status,'closed')
    const history=(await db.query('select a.is_active,a.dossier_closed from public.assigned_clients a join clinical.legacy_assignment_links l on l.source_id=a.id where l.patient_id=$1',[result.patientId])).rows[0]
    assert.equal(history.is_active,outcome!=='not_taken');assert.equal(history.dossier_closed,outcome==='closed')
    if(outcome==='closed'){
     const version=(await db.query('select version from clinical.patients where id=$1',[result.patientId])).rows[0].version
     const again=await saveFresh({...candidate,decision:'link',patientId:result.patientId,patientVersion:version,caseId:result.caseId,associationConfirmed:true,phone:'5145550102'})
     assert.equal(again.items[0].status,'imported',again.items[0].error_code)
     assert.equal(again.items[0].result.caseId,result.caseId)
    }
   }
   assert.deepEqual((await db.query('select id,remaining_count from public.assignment_requests order by id')).rows,before)
  })
  await t.test('révocation, lecture seule, total erroné et configuration modifiée refusés sans dossier créé',async()=>{
   const before=(await db.query('select count(*)::int n from clinical.patients')).rows[0].n
   const bad={...row,sourceKey:'fixture-individual:bad',lastName:'Refus fictif',preparation:{...preparation,payers:[{key:'requester-1',basisPoints:5000}]}}
   await assert.rejects(saveFresh(bad),e=>e.code==='22023')
   await db.exec(`update clinical.migration_operators set can_import=false where profile_id='${admin}'`)
   await assert.rejects(command('prepare',randomUUID(),{label:'Refus',clientByClient:true,items:[row]}),e=>e.code==='42501')
   await db.exec(`update clinical.migration_operators set can_import=true,enabled=false where profile_id='${admin}'`)
   await assert.rejects(command('client.defaults',randomUUID(),{professionalId:pro,service:'Psychoéducation'}),e=>e.code==='42501')
   await db.exec(`update clinical.migration_operators set enabled=true where profile_id='${admin}'`)
   const stale=await saveFresh({...row,sourceKey:'fixture-individual:stale',lastName:'Config fictive',preparation:{...preparation,settingsFingerprint:'0'.repeat(64)}})
   assert.equal(stale.items[0].status,'error');assert.equal((await db.query('select count(*)::int n from clinical.patients')).rows[0].n,before)
  })
  await t.test('adjointe explicitement autorisée : migration permise sans droit général de gérer les accès',async()=>{
   const assistant='98300000-0000-4000-8000-000000000005'
   await db.query(`insert into public.profiles(id,role,full_name,email,is_active,platform_access_enabled) values($1,'direction','Adjointe fictive','assistant@example.invalid',true,true)`,[assistant])
   await db.query(`insert into clinical.actor_capabilities(profile_id,actor_kind,manage_patients,manage_clinical_access) values($1,'assistant',true,false)`,[assistant])
   await db.query(`insert into clinical.migration_operators values($1,true,true)`,[assistant])
   await db.exec(`select set_config('request.jwt.claim.sub','${assistant}',false)`)
   const answer=await saveFresh({...row,sourceKey:'fixture-individual:assistant',lastName:'Adjointe fictive',preparation:{...preparation}})
   assert.equal(answer.items[0].status,'imported',answer.items[0].error_code)
   assert.equal((await db.query('select clinical.can_manage_access() allowed')).rows[0].allowed,false)
   await db.exec('set role authenticated')
   await assert.rejects(db.query('select clinical.migration_create_case($1,$2,$3)',[randomUUID(),'Refus',[]]),e=>e.code==='42501')
   await db.exec('reset role')
   await db.query('update clinical.migration_operators set enabled=false where profile_id=$1',[assistant])
   await assert.rejects(command('prepare',randomUUID(),{label:'Refus',clientByClient:true,items:[row]}),e=>e.code==='42501')
  })
  await t.test('assignation opérationnelle existante : rattachement sans recréer l’assignation',async()=>{
   await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false)`)
   const wid=randomUUID(),aid=randomUUID()
   await db.query(`insert into public.waiting_list_clients(id,status,priority_level,service_requested,client_name,birth_date,consultation_reason) values($1,'assigned','normal','Psychoéducation','Opérationnel Fictif','2000-01-01','Motif fictif')`,[wid])
   await db.query(`insert into public.assigned_clients(id,professional_id,waiting_list_client_id,first_name,last_name,email,contacted,is_active,dossier_closed) values($1,$2,$3,'Opérationnel','Fictif','',true,true,false)`,[aid,pro,wid])
   const fingerprint=(await db.query("select encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') f from public.assigned_clients a where id=$1",[aid])).rows[0].f
   const before=(await db.query('select count(*)::int n from public.assigned_clients')).rows[0].n
   const answer=await saveFresh({...row,sourceKey:'fixture-individual:operational',firstName:'Opérationnel',lastName:'Fictif',birthDate:'2000-01-01',decision:'operational',assignmentId:aid,assignmentFingerprint:fingerprint,associationConfirmed:true})
   assert.equal(answer.items[0].status,'imported',answer.items[0].error_code)
   assert.equal((await db.query('select count(*)::int n from public.assigned_clients')).rows[0].n,before)
   const result=answer.items[0].result
   assert.equal((await db.query("select source_id from clinical.legacy_assignment_links where patient_id=$1 and source_table='assigned_clients'",[result.patientId])).rows[0].source_id,aid)
  })
  await t.test('mineur : représentant déjà vérifié conservé, requérant financier sans pouvoir de consentement',async()=>{
   const pid=(await db.query(`select public.clinical_create_patient('Mineur','Représentation fictive','2018-01-01') id`)).rows[0].id
   const ep=(await db.query(`select public.clinical_create_episode($1,null,'Suivi mineur') id`,[pid])).rows[0].id
   const cid=(await db.query(`select public.clinical_create_case($1,'Dossier mineur',jsonb_build_array(jsonb_build_object('actorId',$2::uuid,'canRead',true,'canWrite',true,'canCosign',false,'requiresCosignature',false,'supervisorId',null))) id`,[ep,pro])).rows[0].id
   const rep=(await db.query(`insert into clinical.patient_representatives(patient_id,full_name,relationship,authority_verified) values($1,'Représentant Fictif','Parent',true) returning id`,[pid])).rows[0].id
   const version=(await db.query('select version from clinical.patients where id=$1',[pid])).rows[0].version
   const answer=await saveFresh({...row,sourceKey:'fixture-individual:minor',firstName:'Mineur',lastName:'Représentation fictive',birthDate:'2018-01-01',decision:'link',patientId:pid,patientVersion:version,caseId:cid,associationConfirmed:true})
   assert.equal(answer.items[0].status,'imported',answer.items[0].error_code)
   const mid=answer.items[0].result.mandateId
   const signers=(await db.query(`select s.person_id,p.role from clinical.mandate_signers s join clinical.mandate_revisions r on r.id=s.revision_id join clinical.mandate_people p on p.revision_id=r.id and p.id=s.person_id where r.mandate_id=$1 and s.required and s.audience='clinical'`,[mid])).rows
   assert.deepEqual(signers.map(x=>x.person_id),[rep])
   const payers=(await db.query(`select p.can_consent from clinical.mandate_people p join clinical.mandate_revisions r on r.id=p.revision_id where r.mandate_id=$1 and p.role='payer'`,[mid])).rows
   assert.ok(payers.length);assert.ok(payers.every(x=>x.can_consent===false))
  })
 } finally {await db.close()}
})
