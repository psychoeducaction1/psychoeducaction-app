-- Prepared only: integration/application belongs to the principal chat.
-- Same encounter definition as the existing no_encounter closure workflow.
begin;
do $$ begin
  if to_regclass('clinical.legacy_assignment_links') is null
    or to_regclass('clinical.service_episodes') is null
    or to_regclass('clinical.appointments') is null
    or to_regclass('public.assigned_clients') is null then
    raise exception 'ASSIGNMENT_ENCOUNTER_GUARD_PREFLIGHT_FAILED';
  end if;
end $$;

create or replace function clinical.guard_assignment_non_service_encounters() returns trigger
language plpgsql security definer set search_path='' set row_security=off as $$
declare episode uuid;
begin
  -- Existing identity, RLS and command permissions are not replaced here.
  -- Calendar writers use this professional lock and share-lock their episode.
  perform pg_advisory_xact_lock(hashtextextended('calendar-professional/'||new.professional_id::text,0));
  if old.is_active is true and not exists(select 1 from clinical.legacy_assignment_links l
    where l.source_table='assigned_clients' and l.source_id=new.id) then
    raise exception 'ASSIGNMENT_ENCOUNTER_LINK_REQUIRED' using errcode='40001';
  end if;
  for episode in
    select e.id from clinical.service_episodes e
    join clinical.legacy_assignment_links l on l.episode_id=e.id
    where l.source_table='assigned_clients' and l.source_id=new.id
    order by e.id for update of e
  loop
    if exists(select 1 from clinical.appointments a where a.episode_id=episode
      and a.kind='meeting'
      and (a.status='completed' or a.status='planned' and a.end_at<=clock_timestamp())) then
      raise exception 'ASSIGNMENT_ENCOUNTER_EXISTS' using errcode='40001';
    end if;
  end loop;
  return new;
end $$;

revoke all on function clinical.guard_assignment_non_service_encounters() from public,anon,authenticated,service_role;
drop trigger if exists assignment_non_service_encounter_guard on public.assigned_clients;
create trigger assignment_non_service_encounter_guard before update of is_active on public.assigned_clients
for each row when (new.is_active is false and old.is_active is distinct from false)
execute function clinical.guard_assignment_non_service_encounters();
commit;
