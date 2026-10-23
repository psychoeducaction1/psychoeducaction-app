// Base jetable en mémoire, aucune URL et aucun environnement Supabase réel.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { buildServiceAppointment } from '../lib/serviceAppointment.ts'
if (!process.env.PGLITE_MODULE_PATH) throw new Error('PGLITE_MODULE_PATH doit désigner un module PGlite local.')
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href)
const db = new PGlite()
const actor='10000000-0000-4000-8000-000000000001', professional='10000000-0000-4000-8000-000000000002'
const offices={montreal:'100, rue Fictive, Montréal',longueuil:'200, rue Fictive, Longueuil'}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create function auth.role() returns text language sql as $$ select current_setting('request.jwt.role',true) $$;
    create table profiles(id uuid primary key,role text,full_name text,email text,is_active boolean default true,platform_access_enabled boolean default true);
    create table waiting_list_clients(id uuid primary key default gen_random_uuid(),status text,client_name text,first_requester_name text,second_requester_name text,
      contact_email text,contact_emails text[],contact_phone text,contact_phones text[],consultation_reason text,meeting_modality text[],city text,assigned_professional_id uuid,assigned_at timestamptz);
    create table assignment_requests(id uuid primary key default gen_random_uuid(),professional_id uuid,is_active boolean,requested_count integer,assigned_count integer default 0,remaining_count integer,created_at timestamptz default now());
    create table assigned_clients(id uuid primary key default gen_random_uuid(),professional_id uuid,waiting_list_client_id uuid,assignment_request_id uuid,
      first_name text,last_name text,email text,phone text,requester_name text,short_comment text,meeting_modality text,service_address text,assigned_date date,
      contacted boolean,is_active boolean,dossier_closed boolean,closure_reason text,meeting_count integer,canceled_at timestamptz);
    create table assignment_processes(id uuid primary key default gen_random_uuid(),waiting_list_client_id uuid,status text,prospective_professional_id uuid,assigned_at timestamptz);
    create table assignment_process_events(id uuid primary key default gen_random_uuid(),assignment_process_id uuid,event_type text,status text,actor_profile_id uuid,actor_name text,metadata jsonb);
    create table administrative_tasks(id uuid primary key default gen_random_uuid(),source_type text,source_id uuid,status text,completed_at timestamptz);
    create table audit_logs(id uuid primary key default gen_random_uuid(),actor_profile_id uuid,actor_name text,actor_role text,action text,entity_type text,entity_id uuid,description text,metadata jsonb);
    create function public.is_direction() returns boolean language sql as $$ select false $$;
    insert into profiles(id,role,full_name,email) values('${actor}','direction','Direction fictive','direction@example.invalid'),('${professional}','professionnel','Pro fictif','pro@example.invalid');
    insert into assignment_requests(professional_id,is_active,requested_count,remaining_count) values('${professional}',true,10,10);
  `)
  await db.exec(await readFile(new URL('../supabase/waiting-list-assignment-transactions.sql',import.meta.url),'utf8'))
  await db.exec(await readFile(new URL('../supabase/service-taken-appointment.sql',import.meta.url),'utf8'))
  async function fixture() {
    const source=(await db.query("insert into waiting_list_clients(status,client_name,contact_email,city) values('assignment_in_progress','Client Fictif','client@example.invalid','Ville fictive') returning id")).rows[0].id
    const process=(await db.query("insert into assignment_processes(waiting_list_client_id,status,prospective_professional_id) values($1,'interested',$2) returning id",[source,professional])).rows[0].id
    await db.query("insert into administrative_tasks(source_type,source_id,status) values('assignment_process_follow_up',$1,'pending')",[process])
    return {source,process,key:crypto.randomUUID()}
  }
  async function assign(fixture,appointment) {
    return (await db.query('select public.create_scheduled_waiting_list_assignment($1,$2,$3,$4,$5,$6,$7::jsonb) result',
      [fixture.source,professional,'service_taken',fixture.key,fixture.process,actor,JSON.stringify(appointment)])).rows[0].result
  }
  for(const modality of ['telehealth','home','montreal','longueuil']) {
    const f=await fixture(), appointment=buildServiceAppointment({date:'2026-11-10',time:'14:30',modality},offices)
    const result=await assign(f,appointment)
    const saved=(await db.query('select * from assigned_clients where id=$1',[result.assignedClientId])).rows[0]
    assert.equal(saved.is_active,true);assert.equal(saved.contacted,true);assert.deepEqual(saved.service_appointment,appointment)
    assert.equal((await db.query('select status from assignment_processes where id=$1',[f.process])).rows[0].status,'assigned')
    assert.equal((await db.query('select status from administrative_tasks where source_id=$1',[f.process])).rows[0].status,'completed')
    assert.deepEqual((await db.query("select metadata from assignment_process_events where assignment_process_id=$1 and event_type='assigned'",[f.process])).rows[0].metadata.service_appointment,appointment)
    const repeat=await assign(f,appointment)
    assert.equal(repeat.assignedClientId,result.assignedClientId);assert.equal(repeat.reused,true)
    await assert.rejects(assign(f,{...appointment,time:'15:30',startsAt:'2026-11-10T20:30:00.000Z'}),/IDEMPOTENCY_CONFLICT/)
    assert.equal((await db.query('select count(*)::int n from assigned_clients where waiting_list_client_id=$1',[f.source])).rows[0].n,1)
  }
  const missing=await fixture()
  for(const appointment of [null,{}, {date:'2026-11-10',time:'14:30',modality:'montreal',timeZone:'America/Toronto',startsAt:'2026-11-10T19:30:00Z'}]) {
    await assert.rejects(assign(missing,appointment),/SERVICE_APPOINTMENT_REQUIRED/)
  }
  assert.equal((await db.query('select count(*)::int n from assigned_clients where waiting_list_client_id=$1',[missing.source])).rows[0].n,0)
  // Échec après création par le RPC de base : l'ensemble de l'opération doit revenir en arrière.
  await db.exec(`create function reject_fixture_appointment() returns trigger language plpgsql as $$ begin
    if new.service_appointment is not null then raise exception 'FIXTURE_APPOINTMENT_FAILURE'; end if; return new; end $$;
    create trigger fixture_failure before update on assigned_clients for each row execute function reject_fixture_appointment();`)
  const failed=await fixture()
  await assert.rejects(assign(failed,buildServiceAppointment({date:'2026-11-10',time:'14:30',modality:'home'},offices)),/FIXTURE_APPOINTMENT_FAILURE/)
  assert.equal((await db.query('select count(*)::int n from assigned_clients where waiting_list_client_id=$1',[failed.source])).rows[0].n,0)
  assert.equal((await db.query('select count(*)::int n from waiting_list_assignment_receipts where idempotency_key=$1',[failed.key])).rows[0].n,0)
  assert.equal((await db.query('select status from assignment_processes where id=$1',[failed.process])).rows[0].status,'interested')
  assert.equal((await db.query('select status from administrative_tasks where source_id=$1',[failed.process])).rows[0].status,'pending')
  await db.exec(`drop trigger fixture_failure on assigned_clients;
    grant usage on schema auth to authenticated; grant execute on function auth.role() to authenticated;
    grant select,update on assigned_clients to authenticated;
    create policy fixture_visible on assigned_clients for select to authenticated using(true);
    create policy fixture_editable on assigned_clients for update to authenticated using(true) with check(true);`)
  await db.exec("select set_config('request.jwt.role','authenticated',false); set role authenticated;")
  await assert.rejects(assign({source:crypto.randomUUID(),process:crypto.randomUUID(),key:crypto.randomUUID()},{}),/permission denied/)
  await assert.rejects(db.query("update assigned_clients set service_appointment='{}'::jsonb where id=(select id from assigned_clients limit 1)"),/parcours serveur autorisé/)
  await db.exec('reset role;')
  assert.equal((await db.query('select assigned_count from assignment_requests')).rows[0].assigned_count,4)
  console.log('Rendez-vous : quatre modalités, persistance atomique, historique, retries, conflits, rollback et RPC privé vérifiés en PostgreSQL mémoire.')
} finally { await db.close() }
