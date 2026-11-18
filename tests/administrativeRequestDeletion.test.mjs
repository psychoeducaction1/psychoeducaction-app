import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const admin='98100000-0000-4000-8000-000000000001',pro='98100000-0000-4000-8000-000000000002',req='98100000-0000-4000-8000-000000000003',key='98100000-0000-4000-8000-000000000004'
test('suppression administrative atomique, sans activation clinique et sans perte des assignations',async t=>{
 const db=new PGlite()
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema clinical;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,full_name text,role text,is_active boolean default true,platform_access_enabled boolean default true,administrative_access text);
 create function public.is_super_admin() returns boolean language sql security definer set search_path='' as $$select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.platform_access_enabled and p.administrative_access='super_admin')$$;
 create table public.assignment_requests(id uuid primary key,professional_id uuid references public.profiles,requested_count int,clinical_version int);
 create table public.assigned_clients(id int primary key,assignment_request_id uuid references public.assignment_requests,is_active boolean,canceled_at timestamptz,unchanged text);
 create table clinical.capacity_offers(id int primary key,assignment_request_id uuid not null references public.assignment_requests on delete cascade);
 create table public.waiting_list_assignment_receipts(id int primary key,assignment_request_id uuid references public.assignment_requests on delete set null);
 create table clinical.admission_receipts(actor_id uuid references public.profiles,request_key uuid,intent_hash text,result jsonb,created_at timestamptz default now(),primary key(actor_id,request_key));
 create table public.audit_logs(actor_profile_id uuid,actor_name text,actor_role text,action text,entity_type text,entity_id text,description text,metadata jsonb);
 insert into public.profiles values('${admin}','Administration Fictive','professionnel',true,true,'super_admin'),('${pro}','Professionnel Fictif','professionnel',true,true,'none');
 insert into public.assignment_requests values('${req}','${pro}',3,2);
 insert into public.assigned_clients values(1,'${req}',true,null,'original'),(2,'${req}',null,null,'original'),(3,'${req}',false,now(),'annulé conservé');
 insert into clinical.capacity_offers values(1,'${req}');insert into public.waiting_list_assignment_receipts values(1,'${req}');`)
 await db.exec(readFileSync(new URL('../supabase/clinical/real-981-administrative-request-deletion.sql',import.meta.url),'utf8'))
 const actor=async id=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id])
 const remove=(v=2,k=key)=>db.query('select public.clinical_admin_delete_assignment_request($1,$2,$3) q',[req,v,k])
 await db.exec('set role authenticated');await actor(pro);await assert.rejects(remove(),e=>e.code==='42501')
 await actor(admin);await assert.rejects(remove(1),e=>e.code==='40001')
 assert.equal((await db.query('select public.is_super_admin() yes')).rows[0].yes,true)
 await db.exec('reset role')
 // A late failure must roll back even the prior detach and cascades.
 await db.exec(`create function public.fail_audit() returns trigger language plpgsql as $$begin raise exception 'FICTITIOUS_INTERRUPTION';end$$;create trigger fail before insert on public.audit_logs for each row execute function public.fail_audit();set role authenticated`)
 await assert.rejects(remove(),/FICTITIOUS_INTERRUPTION/)
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from public.assigned_clients where assignment_request_id is not null')).rows[0].n,3)
 assert.equal((await db.query('select count(*)::int n from clinical.capacity_offers')).rows[0].n,1)
 await db.exec('drop trigger fail on public.audit_logs;set role authenticated')
 const result=(await remove()).rows[0].q;assert.equal(result.success,true);assert.equal(result.serviceTaken,1);assert.equal(result.pending,1)
 assert.deepEqual((await remove()).rows[0].q,result,'retry returns same receipt')
 await assert.rejects(remove(3),e=>e.code==='40001')
 await db.exec('reset role')
 assert.equal((await db.query('select count(*)::int n from public.assigned_clients')).rows[0].n,3)
 assert.equal((await db.query('select count(*)::int n from public.assigned_clients where assignment_request_id is not null')).rows[0].n,0)
 assert.equal((await db.query('select count(*)::int n from public.waiting_list_assignment_receipts')).rows[0].n,1)
 assert.equal((await db.query('select count(*)::int n from public.audit_logs')).rows[0].n,1)
 assert.equal((await db.query("select has_function_privilege('anon','public.clinical_admin_delete_assignment_request(uuid,integer,uuid)','execute') yes")).rows[0].yes,false)
 assert.equal((await db.query('select administrative_access from public.profiles where id=$1',[pro])).rows[0].administrative_access,'none')
 }finally{await db.close()}
})
