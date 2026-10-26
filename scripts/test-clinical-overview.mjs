import assert from 'node:assert/strict'
import {readFile}from'node:fs/promises'
import{pathToFileURL}from'node:url'
if(!process.env.PGLITE_MODULE_PATH)throw Error('PGLITE_MODULE_PATH requis (base en mémoire uniquement)')
const{PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href)
const db=new PGlite()
const director='10000000-0000-4000-8000-000000000001',coordinator='10000000-0000-4000-8000-000000000002',other='10000000-0000-4000-8000-000000000003',client='20000000-0000-4000-8000-000000000001',request='30000000-0000-4000-8000-000000000001'
try{
 await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
 grant usage on schema public,auth,storage to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;
 create table profiles(id uuid primary key,role text,full_name text,email text,platform_access_enabled boolean default true,is_active boolean default true,professional_title text,
 pref_languages text[],pref_age_ranges jsonb,pref_client_groups text[],pref_service_types text[],pref_office_locations text[],pref_meeting_modes text[],pref_motifs text[],pref_exclusions text,pref_matching_notes text,private_salary numeric);
 alter table profiles enable row level security;grant select on profiles to authenticated;create policy own_profile on profiles for select to authenticated using(id=auth.uid());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 create table waiting_list_clients(id uuid primary key,created_at timestamptz default now(),contact_date date,client_name text,birth_date date,priority_level text,service_requested text,city text,meeting_modality text[],availability text,consultation_reason text,status text,contact_email text,internal_notes text);
 create table assignment_processes(waiting_list_client_id uuid,status text);
 create table assignment_requests(id uuid primary key,professional_id uuid,is_active boolean,requested_count integer,request_comment text,created_at timestamptz default now());
 create table assigned_clients(professional_id uuid,assignment_request_id uuid,is_active boolean,canceled_at timestamptz);
 alter table waiting_list_clients enable row level security;alter table assignment_requests enable row level security;alter table assigned_clients enable row level security;
 insert into profiles(id,role,full_name,email,professional_title,pref_languages,pref_age_ranges,pref_motifs,pref_exclusions,private_salary)values
 ('${director}','direction','Direction fictive','direction@example.invalid',null,null,null,null,null,999),
 ('${coordinator}','professionnel','Coordinatrice fictive','coordinator@example.invalid','Intervenante',array['Français'],'[{"min":6,"max":12}]',array['anxiety'],'Exclusion fictive',999),
 ('${other}','professionnel','Autre fictive','other@example.invalid','Psychoéducatrice',null,null,null,null,999);
 insert into waiting_list_clients(id,client_name,status,service_requested,contact_email,internal_notes)values('${client}','Client fictif','waiting','Psychoéducation','private@example.invalid','NE PAS EXPOSER');
 insert into assignment_requests(id,professional_id,is_active,requested_count,request_comment)values('${request}','${other}',true,4,'Demande fictive');
 insert into assigned_clients values('${other}','${request}',true,null),('${other}','${request}',null,null),('${other}','${request}',false,null),('${other}','${request}',true,now());`)
 await db.exec(await readFile('supabase/clinical-coordination-workspace.sql','utf8'))
 await db.exec(`insert into clinical_coordination_staff(profile_id,full_name,email)values('${coordinator}','Coordinatrice fictive','coordinator@example.invalid')`)
 await db.exec(await readFile('supabase/clinical-coordination-readonly-overview.sql','utf8'))
 const as=async(id,run)=>{await db.exec(`set role authenticated;select set_config('request.jwt.claims','${JSON.stringify({sub:id,role:'authenticated'})}',false)`);try{return await run()}finally{await db.exec('reset role')}}
 const read=async view=>(await db.query('select read_clinical_overview($1) as data',[view])).rows[0].data
 await as(coordinator,async()=>{
  const prefs=await read('preferences');assert.equal(prefs.professionals.length,2);assert.ok(prefs.professionals.some(p=>p.pref_exclusions==='Exclusion fictive'));assert.doesNotMatch(JSON.stringify(prefs),/private_salary|999|email/)
  const waiting=await read('waiting-list');assert.equal(waiting.waitingList.length,1);assert.doesNotMatch(JSON.stringify(waiting),/contact_email|internal_notes|NE PAS EXPOSER/)
  const dashboard=await read('dashboard');assert.equal(dashboard.requests[0].accepted_count,1);assert.equal(dashboard.requests[0].occupied_count,2);assert.deepEqual(dashboard.assignmentStats[0],{professional_id:other,active_count:1,pending_count:1,refused_count:1});assert.equal(dashboard.waitingStats.waiting,1)
  assert.equal((await db.query(`select count(*)::int as n from profiles`)).rows[0].n,1,'Pas de lecture générale des profils')
  for(const table of ['profiles','waiting_list_clients','assignment_requests','assigned_clients'])assert.equal((await db.query(`select has_table_privilege('authenticated','${table}','INSERT,UPDATE,DELETE') as permitted`)).rows[0].permitted,false,'Aucun nouveau droit de mutation')
  await assert.rejects(read('other'),/Vue invalide/)
 })
 await as(other,async()=>{await assert.rejects(read('preferences'),/Accès refusé/)})
 await as(director,async()=>{assert.equal((await read('preferences')).professionals.length,2)})
 await db.exec(`insert into assignment_processes values('${client}','interested')`)
 await as(coordinator,async()=>{assert.equal((await read('waiting-list')).waitingList.length,0)})
 await db.exec(`update assignment_processes set status='returned'`)
 await as(coordinator,async()=>{assert.equal((await read('waiting-list')).waitingList.length,1)})
 await db.exec(`update clinical_coordination_staff set is_active=false`)
 await as(coordinator,async()=>{await assert.rejects(read('dashboard'),/Accès refusé/)})
 await db.exec(`update clinical_coordination_staff set is_active=true;update profiles set platform_access_enabled=false where id='${coordinator}'`)
 await as(coordinator,async()=>{await assert.rejects(read('waiting-list'),/Accès refusé/)})
 await db.exec('set role anon');await assert.rejects(read('preferences'),/permission denied/);await db.exec('reset role')
 console.log('Consultation clinique : projections, révocation, refus tiers/anonyme, demandes et absence de nouveaux droits d’écriture vérifiés en mémoire.')
}finally{await db.close()}
