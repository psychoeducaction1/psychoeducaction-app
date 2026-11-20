-- Explicit administrative pause, using the existing assignment counter.
begin;
create table clinical.capacity_request_pauses (
  request_id uuid primary key references public.assignment_requests(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
alter table clinical.capacity_request_pauses enable row level security;
revoke all on clinical.capacity_request_pauses from public,anon,authenticated,service_role;

create function clinical.keep_paused_capacity() returns trigger
language plpgsql security definer set search_path='' set row_security=off as $$
begin
  if new.is_active and exists(select 1 from clinical.capacity_request_pauses p where p.request_id=old.id) then
    new.is_active:=false;
  end if;
  return new;
end $$;
create trigger capacity_pause_status before update on public.assignment_requests
  for each row execute function clinical.keep_paused_capacity();
revoke all on function clinical.keep_paused_capacity() from public,anon,authenticated,service_role;

create function public.clinical_set_capacity_enabled(p_id uuid,p_version integer,p_enabled boolean,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare r public.assignment_requests; receipt clinical.admission_receipts; target uuid; intent text; ack jsonb; actor uuid:=auth.uid();
begin
  perform clinical.unified_context('administration');
  if not clinical.active_actor() or not clinical.can_administer() then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
  if p_id is null or p_version is null or p_version<1 or p_enabled is null or p_key is null then raise exception 'ADMISSION_INVALID_INPUT' using errcode='22023';end if;
  intent:=encode(sha256(convert_to(jsonb_build_array('administration','capacities.set-enabled',p_id,p_version,p_enabled)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||'/admission/'||p_key::text,0));
  select * into receipt from clinical.admission_receipts where actor_id=actor and request_key=p_key;
  if found then
    if receipt.intent_hash<>intent then raise exception 'ADMISSION_CONFLICT' using errcode='40001';end if;
    return jsonb_build_object('workspace',public.clinical_unified_admission_query('administration'),'result',receipt.result);
  end if;
  select professional_id into target from public.assignment_requests where id=p_id;
  if target is null or not clinical.unified_professional_access('administration',target) then raise exception 'ADMISSION_FORBIDDEN' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('clinical-capacity/'||target::text,0));
  select * into r from public.assignment_requests where id=p_id for update;
  if r.clinical_version is distinct from p_version then raise exception 'ADMISSION_CONFLICT' using errcode='40001';end if;
  if coalesce(r.requested_count,0)<=coalesce(r.assigned_count,0) or (p_enabled and coalesce(r.remaining_count,0)<=0) then
    raise exception 'CAPACITY_NO_REMAINING_PLACES' using errcode='40001';
  end if;
  if p_enabled then
    if exists(select 1 from public.assignment_requests where id<>r.id and professional_id=target and is_active and remaining_count>0) then
      raise exception 'CAPACITY_ANOTHER_OPEN_REQUEST' using errcode='40001';
    end if;
    delete from clinical.capacity_request_pauses where request_id=r.id;
  else
    insert into clinical.capacity_request_pauses(request_id,actor_id) values(r.id,actor) on conflict do nothing;
  end if;
  update public.assignment_requests set is_active=p_enabled where id=r.id;
  ack:=jsonb_build_object('kind','capacity','id',r.id);
  insert into clinical.admission_receipts(actor_id,request_key,intent_hash,result) values(actor,p_key,intent,ack);
  insert into public.audit_logs(actor_profile_id,actor_name,actor_role,action,entity_type,entity_id,description)
  select id,full_name,role,case when p_enabled then 'capacity_request_resumed' else 'capacity_request_paused' end,
    'assignment_request',r.id,case when p_enabled then 'Demande professionnelle réactivée.' else 'Demande professionnelle mise en pause.' end
  from public.profiles where id=actor;
  return jsonb_build_object('workspace',public.clinical_unified_admission_query('administration'),'result',ack);
end $$;
revoke all on function public.clinical_set_capacity_enabled(uuid,integer,boolean,uuid) from public,anon,service_role;
grant execute on function public.clinical_set_capacity_enabled(uuid,integer,boolean,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
