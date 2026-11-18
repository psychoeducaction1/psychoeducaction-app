import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {PGlite}=require('@electric-sql/pglite')

test('rapports : compte explicite, super-administration, révocation, reprise et préservation des données',async()=>{
 const db=new PGlite();const allowed='3c514611-b530-4f48-84e4-32871b32f320',other='93000000-0000-4000-8000-000000000002',batch='93000000-0000-4000-8000-000000000003'
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema clinical;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,is_active boolean,platform_access_enabled boolean,administrative_access text);
 create table clinical.migration_operators(profile_id uuid,enabled boolean);
 create table clinical.migration_batches(id uuid primary key,version integer);
 create table clinical.migration_events(batch_id uuid,actor_id uuid,action text);
 create table clinical.preserved_documents(id integer primary key,content text);
 create function clinical.can_administer() returns boolean language sql stable as $$select current_setting('test.admin')='true'$$;
 create function clinical.migration_assert() returns void language plpgsql as $$begin if not clinical.can_administer() then raise exception 'MIGRATION_FORBIDDEN';end if;end$$;
 create function public.clinical_migration_query(uuid default null) returns jsonb language sql as $$select jsonb_build_object('batches',(select jsonb_agg(to_jsonb(b)) from clinical.migration_batches b),'patients','[]'::jsonb)$$;
 create function public.clinical_migration_command(text,uuid,jsonb) returns jsonb language sql as $$select '{"delegated":true}'::jsonb$$;
 insert into public.profiles values('${allowed}',true,true,'super_admin'),('${other}',true,true,'super_admin');
 insert into clinical.migration_operators values('${allowed}',true),('${other}',true);
 insert into clinical.migration_batches values('${batch}',3);insert into clinical.preserved_documents values(1,'fictional immutable content');
 set test.admin='true';set test.actor='${allowed}';`)
 await db.exec(readFileSync(new URL('../supabase/clinical/real-930-migration-report-removal.sql',import.meta.url),'utf8'))
 const query=async()=> (await db.query('select public.clinical_migration_query(null) as q')).rows[0].q
 const hide=version=>db.query(`select public.clinical_migration_command('report.hide',$1,$2::jsonb) as q`,[batch,JSON.stringify({expectedVersion:version})])
 assert.equal((await query()).canRemoveReports,true)
 await db.exec(`set test.actor='${other}'`);assert.equal((await query()).canRemoveReports,false);await assert.rejects(hide(3),/MIGRATION_REPORT_FORBIDDEN/)
 await db.exec(`set test.actor='${allowed}';update public.profiles set administrative_access='direction' where id='${allowed}'`);await assert.rejects(hide(3),/MIGRATION_REPORT_FORBIDDEN/)
 await db.exec(`update public.profiles set administrative_access='super_admin' where id='${allowed}';update clinical.migration_operators set enabled=false where profile_id='${allowed}'`);await assert.rejects(hide(3),/MIGRATION_REPORT_FORBIDDEN/)
 await db.exec(`update clinical.migration_operators set enabled=true where profile_id='${allowed}'`)
 await assert.rejects(hide(2),/MIGRATION_CONFLICT/);assert.equal((await query()).batches.length,1)
 assert.equal((await hide(3)).rows[0].q.hidden,true);assert.deepEqual((await query()).batches,[])
 await hide(3);assert.equal((await db.query('select count(*)::integer n from clinical.migration_events')).rows[0].n,1)
 await assert.rejects(db.query('select public.clinical_migration_query($1)',[batch]),/MIGRATION_NOT_FOUND/)
 await assert.rejects(db.query("select public.clinical_migration_command('client.save',$1,'{}')",[batch]),/MIGRATION_NOT_FOUND/)
 assert.equal((await db.query('select count(*)::integer n from clinical.migration_batches')).rows[0].n,1)
 assert.equal((await db.query('select content from clinical.preserved_documents')).rows[0].content,'fictional immutable content')
 assert.equal((await db.query("select has_table_privilege('authenticated','clinical.migration_hidden_reports','select') as allowed")).rows[0].allowed,false)
 assert.equal((await db.query("select has_function_privilege('authenticated','public.clinical_migration_command_930_base(text,uuid,jsonb)','execute') as allowed")).rows[0].allowed,false)
 }finally{await db.close()}
})

test('diagnostic : codes métier uniquement, messages SQL personnels toujours masqués',async()=>{
 const db=new PGlite();try{
 await db.exec(`create function public.clinical_migration_command_805_base(text,uuid,jsonb) returns jsonb language plpgsql as $$declare err text;begin begin raise exception '%', $3->>'message' using errcode='22023';exception when others then err:=sqlstate;return jsonb_build_object('error',case when sqlerrm in('KNOWN_ERROR') then sqlerrm else 'IMPORT_FAILED_'||err end);end;end$$;`)
 await db.exec(readFileSync(new URL('../supabase/clinical/real-940-migration-safe-errors.sql',import.meta.url),'utf8'))
 const run=async message=>(await db.query(`select public.clinical_migration_command_805_base('item',null,$1) q`,[{message}])).rows[0].q.error
 assert.equal(await run('MANDATE_INVALID_PAYER'),'MANDATE_INVALID_PAYER')
 assert.equal(await run('MIGRATION_CLIENT_DATE_INVALID'),'MIGRATION_CLIENT_DATE_INVALID')
 assert.equal(await run('Example fictional person: bad input'),'IMPORT_FAILED_22023')
 assert.equal(await run('MANDATE_INVALID_PAYER: fictional details'),'IMPORT_FAILED_22023')
 }finally{await db.close()}
})
