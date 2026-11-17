-- Enforce the same mandate start boundary at calendar/note write time.
-- Additive guards only; no existing encounter, note or mandate is updated.
begin;
create function clinical.assert_mandate_start_date(p_episode uuid,p_professional uuid,p_day date) returns void
language plpgsql security definer set search_path='' set row_security=off as $$
declare first_day date;begin
 if p_episode is null or p_professional is null or p_day is null then return;end if;
 -- Financially valid historical revisions remain valid coverage. The current
 -- draft also supplies its known start even before its finances are complete.
 if exists(select 1 from clinical.mandates m join clinical.mandate_revisions r on r.mandate_id=m.id
  where m.episode_id=p_episode and r.professional_id=p_professional
  and (r.id=m.current_revision_id or clinical.unified_mandate_financial_ready(r.id))
  and r.unified_draft->>'serviceDate' is null) then return;end if;
 select min((r.unified_draft->>'serviceDate')::date) into first_day
 from clinical.mandates m join clinical.mandate_revisions r on r.mandate_id=m.id
 where m.episode_id=p_episode and r.professional_id=p_professional
 and (r.id=m.current_revision_id or clinical.unified_mandate_financial_ready(r.id));
 if first_day is not null and p_day<first_day then
  raise exception 'MANDATE_DATE_BEFORE_START' using errcode='22023',detail='MANDATE_START='||first_day::text;
 end if;
end $$;
create function clinical.guard_appointment_mandate_start() returns trigger
language plpgsql security definer set search_path='' set row_security=off as $$
declare ep uuid;begin
 if new.kind not in('meeting','documentation') or new.is_private then return new;end if;
 if tg_op='UPDATE' and (new.start_at,new.episode_id,new.professional_id,new.case_id,new.kind,new.is_private)
  is not distinct from (old.start_at,old.episode_id,old.professional_id,old.case_id,old.kind,old.is_private) then return new;end if;
 ep:=new.episode_id;if ep is null then select episode_id into ep from clinical.care_cases where id=new.case_id;end if;
 perform clinical.assert_mandate_start_date(ep,new.professional_id,(new.start_at at time zone 'America/Toronto')::date);
 return new;
end $$;
create trigger mandate_start_appointment before insert or update of start_at,episode_id,professional_id,case_id,kind,is_private on clinical.appointments
 for each row execute function clinical.guard_appointment_mandate_start();
create function clinical.guard_note_mandate_start() returns trigger
language plpgsql security definer set search_path='' set row_security=off as $$
declare ep uuid;pro uuid;appointment_day date;begin
 if tg_op='UPDATE' and (new.encounter_date,new.appointment_id,new.case_id,new.author_id)
  is not distinct from (old.encounter_date,old.appointment_id,old.case_id,old.author_id) then return new;end if;
 select episode_id into ep from clinical.care_cases where id=new.case_id;pro:=new.author_id;
 if new.appointment_id is not null then
  select professional_id,(start_at at time zone 'America/Toronto')::date into pro,appointment_day from clinical.appointments where id=new.appointment_id and case_id=new.case_id;
  perform clinical.assert_mandate_start_date(ep,pro,appointment_day);
 end if;
 perform clinical.assert_mandate_start_date(ep,pro,new.encounter_date);
 return new;
end $$;
create trigger mandate_start_note before insert or update of encounter_date,appointment_id,case_id,author_id on clinical.notes
 for each row execute function clinical.guard_note_mandate_start();
revoke all on function clinical.assert_mandate_start_date(uuid,uuid,date),clinical.guard_appointment_mandate_start(),clinical.guard_note_mandate_start() from public,anon,authenticated,service_role;

-- Validate the requested date before the original linked-appointment mismatch
-- check, while retaining the original RPC's complete permission/locking logic.
alter function public.clinical_create_note(uuid,text,text,date,jsonb,uuid) rename to clinical_create_note_910_base;
revoke all on function public.clinical_create_note_910_base(uuid,text,text,date,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.clinical_create_note(p_case_id uuid,p_note_type text,p_title text,p_encounter_date date,p_content jsonb,p_appointment_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $
declare ep uuid;pro uuid:=auth.uid();begin
 if clinical.has_case_access(p_case_id,'write') then
  select episode_id into ep from clinical.care_cases where id=p_case_id;
  if p_appointment_id is not null then select professional_id into pro from clinical.appointments where id=p_appointment_id and case_id=p_case_id and professional_id=auth.uid();end if;
  perform clinical.assert_mandate_start_date(ep,pro,p_encounter_date);
 end if;
 return public.clinical_create_note_910_base(p_case_id,p_note_type,p_title,p_encounter_date,p_content,p_appointment_id);
end $;
alter function public.clinical_save_note(uuid,integer,text,date,jsonb) rename to clinical_save_note_910_base;
revoke all on function public.clinical_save_note_910_base(uuid,integer,text,date,jsonb) from public,anon,authenticated,service_role;
create function public.clinical_save_note(p_note_id uuid,p_expected_version integer,p_title text,p_encounter_date date,p_content jsonb) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $
declare n clinical.notes;ep uuid;begin
 select * into n from clinical.notes where id=p_note_id and author_id=auth.uid();
 if n.id is not null and clinical.has_case_access(n.case_id,'write') and p_encounter_date is distinct from n.encounter_date then
  select episode_id into ep from clinical.care_cases where id=n.case_id;
  perform clinical.assert_mandate_start_date(ep,n.author_id,p_encounter_date);
 end if;
 return public.clinical_save_note_910_base(p_note_id,p_expected_version,p_title,p_encounter_date,p_content);
end $;
revoke all on function public.clinical_create_note(uuid,text,text,date,jsonb,uuid),public.clinical_save_note(uuid,integer,text,date,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.clinical_create_note(uuid,text,text,date,jsonb,uuid),public.clinical_save_note(uuid,integer,text,date,jsonb) to authenticated;

commit;
