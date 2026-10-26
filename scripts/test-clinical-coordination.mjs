import assert from 'node:assert/strict'
import {readFile}from'node:fs/promises'
import{pathToFileURL}from'node:url'
if(!process.env.PGLITE_MODULE_PATH)throw Error('PGLITE_MODULE_PATH requis (base en mémoire uniquement)')
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);const db=new PGlite()
const manager='10000000-0000-4000-8000-000000000001',coordinator='10000000-0000-4000-8000-000000000002',assistant='10000000-0000-4000-8000-000000000003',other='10000000-0000-4000-8000-000000000004',staff='20000000-0000-4000-8000-000000000001',task='30000000-0000-4000-8000-000000000001'
try{
await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create schema storage;
create function auth.uid() returns uuid language sql as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
grant usage on schema auth,public,storage to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;
create table profiles(id uuid primary key,role text,full_name text,email text,platform_access_enabled boolean default true);
grant select on profiles to authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text);
alter table storage.objects enable row level security;grant all on storage.objects to authenticated,anon;
create policy old_global_policy on storage.objects for all to authenticated,anon using(true) with check(true);
insert into profiles(id,role,full_name,email)values('${manager}','direction','Direction fictive','contact@psychoeducaction.com'),('${coordinator}','professionnel','Coordinatrice fictive','coordinator@example.invalid'),('${assistant}','direction','Adjointe fictive','assistant@example.invalid'),('${other}','professionnel','Autre profil fictif','other@example.invalid');`)
await db.exec(await readFile('supabase/clinical-coordination-workspace.sql','utf8'))
await db.exec(`insert into clinical_coordination_staff(id,profile_id,full_name,email)values('${staff}','${coordinator}','Coordinatrice fictive','coordinator@example.invalid');insert into clinical_coordination_tasks(id,staff_id,title,created_by)values('${task}','${staff}','Tâche fictive','${manager}');insert into storage.objects(bucket_id,name)values('clinical-coordination-task-files','${staff}/${task}/document.txt'),('clinical-coordination-task-files','malforme'),('autre-bucket','fichier');`)
async function asUser(id,email,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,email})]);await db.exec('set role '+role)}
async function count(table){return (await db.query('select count(*)::int n from '+table)).rows[0].n}
for(const [id,email,allowed]of [[coordinator,'coordinator@example.invalid',true],[manager,'contact@psychoeducaction.com',true],[assistant,'assistant@example.invalid',false],[other,'coordinator@example.invalid',false]]){
 await asUser(id,email);assert.equal(await count('clinical_coordination_staff'),allowed?1:0);assert.equal(await count('clinical_coordination_tasks'),allowed?1:0)
 assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='clinical-coordination-task-files'")).rows[0].n,allowed?1:0)
 if(!allowed){await assert.rejects(db.query('select update_own_clinical_coordination_task_status($1,$2)',[task,'completed']),/Accès refusé/);await assert.rejects(db.query("insert into clinical_coordination_task_notes(task_id,note,author_id,author_name)values($1,'Note fictive',$2,'faux')",[task,id]),/row-level security/);await assert.rejects(db.query("insert into clinical_coordination_availability_slots(staff_id,start_at,end_at,created_by)values($1,now(),now()+interval '1 hour',$2)",[staff,id]),/row-level security/)}
}
await asUser(coordinator,'coordinator@example.invalid');assert.equal((await db.query("update clinical_coordination_tasks set title='Titre falsifié' where id=$1 returning id",[task])).rows.length,0)
await db.query("select update_own_clinical_coordination_task_status($1,'completed')",[task]);assert.equal((await db.query('select status from clinical_coordination_tasks where id=$1',[task])).rows[0].status,'completed')
await assert.rejects(db.query("select update_own_clinical_coordination_task_status($1,'canceled')",[task]),/réservée à la direction/)
await db.query("insert into clinical_coordination_task_notes(task_id,note,author_id,author_name)values($1,'Note fictive',$2,'Nom falsifié')",[task,coordinator]);assert.equal((await db.query('select author_name from clinical_coordination_task_notes')).rows[0].author_name,'Coordinatrice fictive')
await db.query("insert into clinical_coordination_task_files(task_id,storage_path,file_name,file_size,uploaded_by)values($1,$2,'document.txt',12,$3)",[task,staff+'/'+task+'/document.txt',coordinator]);assert.equal(await count('clinical_coordination_task_files'),1)
await assert.rejects(db.query("insert into clinical_coordination_task_files(task_id,storage_path,file_name,uploaded_by)values($1,'malforme','document.txt',$2)",[task,coordinator]),/row-level security/)
await asUser(assistant,'assistant@example.invalid');assert.equal(await count('clinical_coordination_task_notes'),0);assert.equal(await count('clinical_coordination_task_files'),0)
await assert.rejects(db.query("insert into clinical_coordination_tasks(staff_id,title,created_by)values($1,'Tâche interdite',$2)",[staff,assistant]),/row-level security/)
await asUser(coordinator,'coordinator@example.invalid')
await assert.rejects(db.query("insert into clinical_coordination_staff(profile_id,full_name,email)values($1,'Intrus','intrus@example.invalid')",[other]),/permission denied/)
await asUser(manager,'contact@psychoeducaction.com');await db.query("update clinical_coordination_tasks set title='Titre validé' where id=$1",[task]);assert.equal((await db.query('select title from clinical_coordination_tasks')).rows[0].title,'Titre validé')
await db.exec('reset role');await db.query('update profiles set platform_access_enabled=false where id=$1',[coordinator]);await asUser(coordinator,'coordinator@example.invalid');assert.equal(await count('clinical_coordination_tasks'),0);assert.equal(await count('clinical_coordination_task_notes'),0);assert.equal(await count('clinical_coordination_task_files'),0);assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='clinical-coordination-task-files'")).rows[0].n,0)
await asUser(null,null,'anon');assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='clinical-coordination-task-files'")).rows[0].n,0)
console.log('Coordination clinique : RLS, rôle direction insuffisant, UUID, statuts, auteurs, révocation et Storage privé vérifiés en mémoire.')
}finally{await db.close()}
