-- Prepared only. Requires explicit production migration/publication authorization.
begin;
do $$begin
 if md5(pg_get_functiondef('clinical.guard_appointment()'::regprocedure))<>'7817441aeda710af013d7d75ed0ab807' or md5(pg_get_functiondef('clinical.encounter_remove(text,uuid,uuid,jsonb)'::regprocedure))<>'aeb3449b6464f710b6cff7a5e2ee117f' then raise exception 'CALENDAR_880_SOURCE_CHANGED';end if;
 if to_regprocedure('public.clinical_unified_calendar_command_880_base(text,text,uuid,jsonb,uuid)') is not null then raise exception 'CALENDAR_880_ALREADY_INSTALLED';end if;
end $$;
create table clinical.completed_encounter_corrections(
 command_key uuid primary key,appointment_id uuid not null references clinical.appointments(id),actor_id uuid not null references public.profiles(id),old_version integer not null,new_version integer not null,reason text not null check(length(reason) between 1 and 1000),before_snapshot jsonb not null,after_snapshot jsonb not null,at timestamptz not null default clock_timestamp(),unique(appointment_id,old_version),check(new_version=old_version+1)
);
alter table clinical.completed_encounter_corrections enable row level security;
revoke all on clinical.completed_encounter_corrections from public,anon,authenticated,service_role;
create trigger completed_corrections_immutable before update or delete on clinical.completed_encounter_corrections for each row execute function clinical.reject_immutable_mutation();
create trigger completed_corrections_no_truncate before truncate on clinical.completed_encounter_corrections for each statement execute function clinical.reject_immutable_mutation();
create or replace function clinical.can_remove_appointment(p_id uuid,p_context text) returns boolean language sql stable security definer set search_path='' set row_security=off as $$
 select p_context='administration' and clinical.can_administer() and clinical.finance_correction_admin() and exists(select 1 from clinical.appointments a where a.id=p_id and not a.is_private and not exists(select 1 from clinical.appointment_removals r where r.appointment_id=a.id))
$$;
create function clinical.can_correct_completed_encounter(p_id uuid,p_context text) returns boolean language sql stable security definer set search_path='' set row_security=off as $$
 select clinical.active_actor() and exists(select 1 from clinical.appointments a where a.id=p_id and a.status='completed' and not exists(select 1 from clinical.appointment_removals r where r.appointment_id=a.id) and (
 (p_context='administration' and clinical.can_administer() and clinical.finance_correction_admin() and not a.is_private) or
 (p_context='clinical' and a.professional_id=auth.uid() and clinical.calendar_can_manage(a.professional_id) and(a.episode_id is null or exists(select 1 from clinical.care_cases c where c.episode_id=a.episode_id and c.status='open' and clinical.has_case_access(c.id,'write'))))))
$$;
CREATE OR REPLACE FUNCTION clinical.guard_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin
 if tg_op='DELETE' then raise exception 'CLINICAL_APPOINTMENT_HISTORY_REQUIRED' using errcode='42501';end if;
 if tg_op='INSERT' and new.case_id is not null then
   if new.episode_id is null then
     select episode_id into new.episode_id from clinical.care_cases where id=new.case_id;
   elsif not exists(select 1 from clinical.care_cases where id=new.case_id and episode_id=new.episode_id) then
     raise exception 'CALENDAR_EPISODE_CASE_MISMATCH' using errcode='22023';
   end if;
 end if;
 if tg_op='UPDATE' and new.status='cancelled' and new.cancellation_reason in('professional','clinic') and new.cancelled_at is not null and new.version=old.version+1
 and (to_jsonb(new)-array['status','cancelled_at','cancellation_reason','version','updated_at'])=(to_jsonb(old)-array['status','cancelled_at','cancellation_reason','version','updated_at'])
 and exists(select 1 from clinical.appointment_removals r where r.appointment_id=old.id and r.appointment_version=old.version and r.removed_by=auth.uid()) then return new;end if;
 if tg_op='UPDATE' then
 if current_setting('pea.calendar_upgrade',true)='episode_backfill' and(old.episode_id is null and new.episode_id is not null or old.occurrence_index is null and new.occurrence_index is not null)
 and(to_jsonb(new)-'episode_id'-'occurrence_index')=(to_jsonb(old)-'episode_id'-'occurrence_index') then return new;end if;
 if current_setting('pea.calendar_activity_pro_change',true)='validated' and old.status='planned' and new.professional_id<>old.professional_id
 and new.version=old.version+1 and new.created_at=old.created_at
 and(to_jsonb(new)-'professional_id'-'version'-'updated_at')=(to_jsonb(old)-'professional_id'-'version'-'updated_at')
 and clinical.calendar_can_change_professional(old.id) then return new;end if;
 if old.status='completed' and new.status='completed' and new.version=old.version+1 and exists(
 select 1 from clinical.completed_encounter_corrections x where x.appointment_id=old.id and x.old_version=old.version and x.new_version=new.version and x.actor_id=auth.uid()
 and (x.after_snapshot-array['busy_start','busy_end'])=(to_jsonb(new)-array['busy_start','busy_end'])) then
 new.busy_start:=new.start_at-make_interval(mins=>new.travel_before_minutes);new.busy_end:=new.end_at+make_interval(mins=>new.travel_after_minutes);return new;end if;
 if old.status<>'planned' or new.episode_id is distinct from old.episode_id or new.case_id is distinct from old.case_id or new.kind<>old.kind or new.professional_id<>old.professional_id or new.series_id is distinct from old.series_id or new.created_at<>old.created_at or new.occurrence_index is distinct from old.occurrence_index then raise exception 'CLINICAL_APPOINTMENT_FROZEN' using errcode='42501';end if;
 if new.version<>old.version+1 then raise exception 'CALENDAR_VERSION_CONFLICT' using errcode='40001';end if;end if;
 new.busy_start:=new.start_at-make_interval(mins=>new.travel_before_minutes);new.busy_end:=new.end_at+make_interval(mins=>new.travel_after_minutes);return new;
end $function$
;
CREATE OR REPLACE FUNCTION clinical.encounter_remove(p_context text, p_key uuid, p_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare a clinical.appointments;i clinical.billing_invoices;s jsonb;previous text;intent text;receipt clinical.correction_commands;result jsonb;replacement uuid;begin
 previous:=clinical.unified_calendar_context(p_context);
 if p_key is null or p_data is null or jsonb_typeof(p_data)<>'object' or p_data->'confirmed' is distinct from 'true'::jsonb or (select count(*) from jsonb_object_keys(p_data))<>3 then raise exception 'CLINICAL_INVALID_INPUT' using errcode='22023';end if;
 if exists(select 1 from clinical.calendar_privacy_receipts where actor_id=auth.uid() and request_key=p_key) or exists(select 1 from clinical.calendar_command_receipts where actor_id=auth.uid() and request_key=p_key) then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
 intent:=encode(sha256(convert_to(jsonb_build_array(p_context,'appointments.remove',p_id,p_data)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into receipt from clinical.correction_commands where command_key=p_key;
 if found then if receipt.actor_id<>auth.uid() or receipt.intent_hash<>intent then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;perform set_config('pea.clinical_context',previous,true);return receipt.result;end if;
 select * into a from clinical.appointments where id=p_id;
 if not clinical.can_remove_appointment(p_id,p_context) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('calendar-professional/'||a.professional_id::text,0));
 if a.episode_id is not null then perform 1 from clinical.service_episodes where id=a.episode_id for update;perform 1 from clinical.care_cases where episode_id=a.episode_id order by id for update;end if;
 select * into a from clinical.appointments where id=p_id for update;
 perform 1 from clinical.notes where appointment_id=a.id order by id for update;
 perform 1 from clinical.billing_invoices where id in(select invoice_id from clinical.billing_lines where appointment_id=a.id) order by id for update;
 if not clinical.can_remove_appointment(p_id,p_context) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 s:=clinical.encounter_removal_state(p_id);
 if a.version is distinct from(p_data->>'expectedVersion')::integer or encode(sha256(convert_to(s::text,'UTF8')),'hex') is distinct from p_data->>'previewHash' then raise exception 'REMOVAL_PREVIEW_CHANGED' using errcode='40001';end if;
 insert into clinical.appointment_removals(appointment_id,removed_by,appointment_version,reason,command_key) values(a.id,auth.uid(),a.version,'Rencontre créée par erreur',p_key);
 insert into clinical.note_removals(note_id,removed_by,note_version) select n.id,auth.uid(),n.version from clinical.notes n where n.appointment_id=a.id and not exists(select 1 from clinical.note_removals r where r.note_id=n.id);
 for i in select * from clinical.billing_invoices where id in(select invoice_id from clinical.billing_lines where appointment_id=a.id) and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=billing_invoices.id) order by id loop
  if i.professional_id<>a.professional_id or not exists(select 1 from clinical.care_cases c where c.id=i.case_id and c.episode_id=a.episode_id and (clinical.can_administer() or clinical.has_case_access(c.id,'write'))) then raise exception 'FINANCIAL_LINK_REVIEW_REQUIRED' using errcode='40001';end if;
  replacement:=clinical.void_invoice_for_correction(i.id,a.id,'Rencontre créée par erreur');
 end loop;
 update clinical.appointments set status='cancelled',cancelled_at=coalesce(cancelled_at,clock_timestamp()),cancellation_reason='clinic',version=version+1,updated_at=clock_timestamp() where id=a.id;
 result:=jsonb_build_object('mode','isolated_unified','durable',true,'actorId',auth.uid(),'context',p_context,'result',jsonb_build_object('kind','appointment','id',a.id,'affectedIds',jsonb_build_array(a.id),'version',a.version+1));
 insert into clinical.correction_commands(command_key,actor_id,intent_hash,result) values(p_key,auth.uid(),intent,result);
 perform set_config('pea.clinical_context',previous,true);return result;
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $function$
;
create function public.clinical_unified_encounter_correction_preview(p_context text,p_appointment_id uuid) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare previous text;s jsonb;begin
 previous:=clinical.unified_calendar_context(p_context);
 if not clinical.can_correct_completed_encounter(p_appointment_id,p_context) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 s:=clinical.encounter_removal_state(p_appointment_id);
 perform set_config('pea.clinical_context',previous,true);
 return jsonb_build_object('appointmentId',p_appointment_id,'version',(s->>'version')::integer,'hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'),'noteCount',jsonb_array_length(s->'notes'),'invoiceCount',jsonb_array_length(s->'invoices'));
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $$;
create function clinical.correct_completed_encounter(p_context text,p_key uuid,p_id uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare previous text;intent text;a clinical.appointments;candidate clinical.appointments;ac clinical.calendar_activities;s jsonb;patient uuid;result jsonb;receipt clinical.correction_commands;reason text;
begin
 previous:=clinical.unified_calendar_context(p_context);
 if not clinical.can_correct_completed_encounter(p_id,p_context) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 perform clinical.unified_professional_keys(p_data,array['expectedVersion','previewHash','confirmed','reason','title','startLocal','durationMinutes','modality','officeId','location','travelBeforeMinutes','travelAfterMinutes','travelKilometers','disambiguation']);
 if p_key is null or p_data->'confirmed' is distinct from 'true'::jsonb or p_data->>'previewHash' !~ '^[a-f0-9]{64}$' or p_data->>'previewHash' is null then raise exception 'CALENDAR_INVALID_INPUT' using errcode='22023';end if;
 reason:=clinical.unified_professional_text(p_data,'reason',1000);
 if length(btrim(reason))=0 then raise exception 'CALENDAR_INVALID_INPUT' using errcode='22023';end if;
 intent:=encode(sha256(convert_to(jsonb_build_array(p_context,'appointments.correct',p_id,p_data)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 if exists(select 1 from clinical.calendar_privacy_receipts where actor_id=auth.uid() and request_key=p_key) then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
 select * into receipt from clinical.correction_commands where command_key=p_key;
 if found then if receipt.actor_id<>auth.uid() or receipt.intent_hash<>intent then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;perform set_config('pea.clinical_context',previous,true);return receipt.result;end if;
 select * into a from clinical.appointments where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended('calendar-professional/'||a.professional_id::text,0));
 if a.episode_id is not null then perform 1 from clinical.service_episodes where id=a.episode_id for update;perform 1 from clinical.care_cases where episode_id=a.episode_id order by id for update;end if;
 select * into a from clinical.appointments where id=p_id for update;
 perform 1 from clinical.notes where appointment_id=a.id order by id for update;
 perform 1 from clinical.billing_invoices where id in(select invoice_id from clinical.billing_lines where appointment_id=a.id) order by id for update;
 if not clinical.can_correct_completed_encounter(p_id,p_context) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 perform clinical.calendar_version(a.version,p_data);
 s:=clinical.encounter_removal_state(a.id);
 if encode(sha256(convert_to(s::text,'UTF8')),'hex') is distinct from p_data->>'previewHash' then raise exception 'CORRECTION_PREVIEW_CHANGED' using errcode='40001';end if;
 patient:=clinical.calendar_existing(a,false);candidate:=clinical.calendar_row(p_data,a);
 if candidate.end_at>clock_timestamp() then raise exception 'CORRECTION_COMPLETED_DATE_REQUIRED' using errcode='22023';end if;
 perform clinical.calendar_validate(candidate,patient,array[a.id]);
 candidate.version:=a.version+1;candidate.updated_at:=clock_timestamp();candidate.is_exception:=a.series_id is not null or a.is_exception;
 insert into clinical.completed_encounter_corrections(command_key,appointment_id,actor_id,old_version,new_version,reason,before_snapshot,after_snapshot) values(p_key,a.id,auth.uid(),a.version,candidate.version,reason,to_jsonb(a),to_jsonb(candidate));
 update clinical.appointments set title=candidate.title,location=candidate.location,start_at=candidate.start_at,end_at=candidate.end_at,modality=candidate.modality,office_id=candidate.office_id,travel_before_minutes=candidate.travel_before_minutes,travel_after_minutes=candidate.travel_after_minutes,travel_kilometers=candidate.travel_kilometers,is_exception=candidate.is_exception,version=candidate.version,updated_at=candidate.updated_at where id=a.id;
 select * into ac from clinical.calendar_activities where appointment_id=a.id for update;
 if ac.id is not null and (candidate.end_at-candidate.start_at<>a.end_at-a.start_at or candidate.travel_kilometers<>a.travel_kilometers) then
  update clinical.calendar_activities set actual_minutes=case when candidate.end_at-candidate.start_at<>a.end_at-a.start_at then extract(epoch from(candidate.end_at-candidate.start_at))::integer/60 else actual_minutes end,travel_kilometers=case when candidate.travel_kilometers<>a.travel_kilometers then candidate.travel_kilometers else travel_kilometers end,version=version+1 where id=ac.id returning * into ac;
  insert into clinical.calendar_activity_versions(activity_id,version,actor_id,actual_minutes,travel_kilometers,reason) values(ac.id,ac.version,auth.uid(),ac.actual_minutes,ac.travel_kilometers,reason);
 end if;
 if a.series_id is not null then update clinical.calendar_series set revision=revision+1 where id=a.series_id;end if;
 perform clinical.calendar_history_add('appointment_corrected',a.id,a.professional_id,candidate.version,jsonb_build_object('reason',reason,'version',candidate.version));
 result:=jsonb_build_object('mode','isolated_unified','durable',true,'actorId',auth.uid(),'context',p_context,'result',jsonb_build_object('kind','appointment','id',a.id,'affectedIds',jsonb_build_array(a.id),'version',candidate.version));
 insert into clinical.correction_commands(command_key,actor_id,intent_hash,result) values(p_key,auth.uid(),intent,result);
 perform set_config('pea.clinical_context',previous,true);return result;
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $$;
alter function public.clinical_unified_calendar_command(text,text,uuid,jsonb,uuid) rename to clinical_unified_calendar_command_880_base;
create function public.clinical_unified_calendar_command(p_context text,p_action text,p_id uuid,p_data jsonb,p_request_key uuid) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare previous text;result jsonb;begin
 previous:=clinical.unified_calendar_context(p_context);
 if p_action='appointments.remove' and not(p_context='administration' and clinical.can_administer() and clinical.finance_correction_admin()) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 if p_action='appointments.correct' then result:=clinical.correct_completed_encounter(p_context,p_request_key,p_id,p_data);else
 if exists(select 1 from clinical.correction_commands where command_key=p_request_key) and p_action<>'appointments.remove' then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
 result:=public.clinical_unified_calendar_command_880_base(p_context,p_action,p_id,p_data,p_request_key);end if;
 perform set_config('pea.clinical_context',previous,true);return result;
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $$;
create function public.clinical_unified_calendar_query_880(p_context text,p_from_date date,p_to_date date) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$declare q jsonb;previous text;begin
 previous:=clinical.unified_calendar_context(p_context);
 q:=public.clinical_unified_calendar_query_870(p_context,p_from_date,p_to_date);
 q:=jsonb_set(q,'{workspace,appointments}',(select coalesce(jsonb_agg(e||jsonb_build_object('canCorrectEncounter',clinical.can_correct_completed_encounter((e->>'id')::uuid,p_context)) order by ord),'[]') from jsonb_array_elements(q->'workspace'->'appointments') with ordinality t(e,ord)));
 perform set_config('pea.clinical_context',previous,true);return q;
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $$;
revoke all on function clinical.can_remove_appointment(uuid,text),clinical.can_correct_completed_encounter(uuid,text),clinical.correct_completed_encounter(text,uuid,uuid,jsonb),public.clinical_unified_calendar_command_880_base(text,text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.clinical_unified_encounter_correction_preview(text,uuid),public.clinical_unified_calendar_command(text,text,uuid,jsonb,uuid),public.clinical_unified_calendar_query_880(text,date,date) from public,anon,service_role;
grant execute on function public.clinical_unified_encounter_correction_preview(text,uuid),public.clinical_unified_calendar_command(text,text,uuid,jsonb,uuid),public.clinical_unified_calendar_query_880(text,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
