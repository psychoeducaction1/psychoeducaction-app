begin;
-- Presentation removal only: retain source links, originals and recovery evidence.
create table clinical.migration_hidden_reports (
 batch_id uuid primary key references clinical.migration_batches(id),
 hidden_by uuid not null references public.profiles(id),
 hidden_at timestamptz not null default clock_timestamp()
);
alter table clinical.migration_hidden_reports enable row level security;
alter table clinical.migration_hidden_reports force row level security;
revoke all on clinical.migration_hidden_reports from public,anon,authenticated,service_role;
create function clinical.migration_can_remove_report() returns boolean
language sql stable security definer set search_path='' set row_security=off as $$
 select auth.uid()='3c514611-b530-4f48-84e4-32871b32f320'::uuid
 and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.platform_access_enabled and p.administrative_access='super_admin')
 and clinical.can_administer()
 and exists(select 1 from clinical.migration_operators m where m.profile_id=auth.uid() and m.enabled)
$$;
revoke all on function clinical.migration_can_remove_report() from public,anon,authenticated,service_role;
alter function public.clinical_migration_query(uuid) rename to clinical_migration_query_930_base;
revoke all on function public.clinical_migration_query_930_base(uuid) from public,anon,authenticated,service_role;
create function public.clinical_migration_query(p_batch uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
declare q jsonb;begin
 perform clinical.migration_assert();
 if p_batch is not null and exists(select 1 from clinical.migration_hidden_reports where batch_id=p_batch) then raise exception 'MIGRATION_NOT_FOUND' using errcode='P0002';end if;
 q:=public.clinical_migration_query_930_base(p_batch);
 if p_batch is null then
  q:=jsonb_set(q,'{batches}',(select coalesce(jsonb_agg(item order by ord),'[]'::jsonb) from jsonb_array_elements(coalesce(q->'batches','[]'::jsonb)) with ordinality rows(item,ord) where not exists(select 1 from clinical.migration_hidden_reports h where h.batch_id=(item->>'id')::uuid)));
  q:=q||jsonb_build_object('canRemoveReports',clinical.migration_can_remove_report());
 end if;
 return q;
end $$;
alter function public.clinical_migration_command(text,uuid,jsonb) rename to clinical_migration_command_930_base;
revoke all on function public.clinical_migration_command_930_base(text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.clinical_migration_command(p_action text,p_batch uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare b clinical.migration_batches;begin
 perform clinical.migration_assert();
 if p_action='report.hide' then
  if not clinical.migration_can_remove_report() then raise exception 'MIGRATION_REPORT_FORBIDDEN' using errcode='42501';end if;
  if jsonb_typeof(p_data) is distinct from 'object' or not(p_data?'expectedVersion') or exists(select 1 from jsonb_object_keys(p_data) k where k<>'expectedVersion') then raise exception 'INVALID_ITEM' using errcode='22023';end if;
  select * into b from clinical.migration_batches where id=p_batch for update;
  if b.id is null then raise exception 'MIGRATION_NOT_FOUND' using errcode='P0002';end if;
  -- Replays are harmless; stale versions cannot hide a concurrently modified lot.
  if not exists(select 1 from clinical.migration_hidden_reports where batch_id=b.id) then
   perform public.clinical_migration_query_930_base(p_batch);
   if b.version is distinct from (p_data->>'expectedVersion')::integer then raise exception 'MIGRATION_CONFLICT' using errcode='40001';end if;
   insert into clinical.migration_hidden_reports(batch_id,hidden_by) values(b.id,auth.uid());
   insert into clinical.migration_events(batch_id,actor_id,action) values(b.id,auth.uid(),'report.hidden');
  end if;
  return jsonb_build_object('hidden',true,'batchId',b.id);
 end if;
 if exists(select 1 from clinical.migration_hidden_reports where batch_id=p_batch) then raise exception 'MIGRATION_NOT_FOUND' using errcode='P0002';end if;
 return public.clinical_migration_command_930_base(p_action,p_batch,p_data);
end $$;
revoke all on function public.clinical_migration_query(uuid),public.clinical_migration_command(text,uuid,jsonb) from public,anon,service_role;
grant execute on function public.clinical_migration_query(uuid),public.clinical_migration_command(text,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
