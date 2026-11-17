-- New transcripts only. No backfill, audio storage or changes to existing notes/consents.
begin;
create table clinical.encounter_transcript_versions(
 appointment_id uuid not null references clinical.appointments(id),case_id uuid not null references clinical.care_cases(id),version integer not null check(version>0),text_content text not null check(length(text_content) between 1 and 250000),reviewed boolean not null,recorded_by uuid not null references public.profiles(id),recorded_at timestamptz not null default clock_timestamp(),command_key uuid not null unique,intent_hash text not null,primary key(appointment_id,version)
);
alter table clinical.encounter_transcript_versions enable row level security;
revoke all on clinical.encounter_transcript_versions from public,anon,authenticated,service_role;
create trigger transcript_versions_immutable before update or delete on clinical.encounter_transcript_versions for each row execute function clinical.reject_immutable_mutation();
create trigger transcript_versions_no_truncate before truncate on clinical.encounter_transcript_versions for each statement execute function clinical.reject_immutable_mutation();
create function public.clinical_unified_encounter_transcript(p_context text,p_action text,p_case_id uuid,p_appointment_id uuid,p_data jsonb default '{}'::jsonb,p_key uuid default null) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare previous text;a clinical.appointments;latest clinical.encounter_transcript_versions;receipt clinical.encounter_transcript_versions;intent text;content text;reviewed_value boolean;
begin
 previous:=clinical.unified_calendar_context(p_context);
 if p_context<>'clinical' or not clinical.has_case_access(p_case_id,'read') or not exists(select 1 from clinical.care_cases c join clinical.appointments ap on ap.episode_id=c.episode_id where c.id=p_case_id and ap.id=p_appointment_id and(ap.case_id is null or ap.case_id=c.id)) or exists(select 1 from clinical.appointment_removals where appointment_id=p_appointment_id) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 if p_action='save' then
  perform clinical.unified_professional_keys(p_data,array['expectedVersion','text','reviewed']);
  if p_key is null or jsonb_typeof(p_data->'text') is distinct from 'string' or length(p_data->>'text') not between 1 and 250000 or length(btrim(p_data->>'text'))=0 or jsonb_typeof(p_data->'reviewed') is distinct from 'boolean' then raise exception 'TRANSCRIPT_INVALID' using errcode='22023';end if;
  intent:=encode(sha256(convert_to(jsonb_build_array(p_case_id,p_appointment_id,p_data)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('transcript-operation/'||p_key::text,0));
  select * into receipt from clinical.encounter_transcript_versions where command_key=p_key;
  if found then
   if receipt.recorded_by<>auth.uid() or receipt.intent_hash<>intent then raise exception 'TRANSCRIPT_OPERATION_CONFLICT' using errcode='40001';end if;
   perform set_config('pea.clinical_context',previous,true);
   return jsonb_build_object('appointmentId',receipt.appointment_id,'recordId',receipt.case_id,'version',receipt.version,'text',receipt.text_content,'reviewed',receipt.reviewed,'updatedAt',receipt.recorded_at);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar-professional/'||(select professional_id::text from clinical.appointments where id=p_appointment_id),0));
  perform 1 from clinical.care_cases where id=p_case_id for update;
  select * into a from clinical.appointments where id=p_appointment_id for update;
  perform 1 from clinical.notes where appointment_id=a.id and case_id=p_case_id order by id for update;
  if a.professional_id<>auth.uid() or not clinical.has_case_access(p_case_id,'write') or not exists(select 1 from clinical.care_cases where id=p_case_id and status='open') or exists(select 1 from clinical.appointment_removals where appointment_id=a.id) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
  if exists(select 1 from clinical.notes n where n.appointment_id=a.id and n.case_id=p_case_id and n.status<>'draft' and not exists(select 1 from clinical.note_removals r where r.note_id=n.id)) then raise exception 'TRANSCRIPT_SIGNED_NOTE_LOCKED' using errcode='40001';end if;
  select * into latest from clinical.encounter_transcript_versions where appointment_id=a.id order by version desc limit 1;
  if latest.version is not null and latest.case_id<>p_case_id then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
  if clinical.calendar_integer(p_data,'expectedVersion',0,2147483647)<>coalesce(latest.version,0) then raise exception 'TRANSCRIPT_VERSION_CONFLICT' using errcode='40001';end if;
  content:=p_data->>'text';reviewed_value:=(p_data->>'reviewed')::boolean;
  if latest.version is null or latest.text_content<>content or latest.reviewed<>reviewed_value then
   insert into clinical.encounter_transcript_versions(appointment_id,case_id,version,text_content,reviewed,recorded_by,command_key,intent_hash) values(a.id,p_case_id,coalesce(latest.version,0)+1,content,reviewed_value,auth.uid(),p_key,intent) returning * into latest;
  end if;
 elsif p_action='read' then
  select * into latest from clinical.encounter_transcript_versions where appointment_id=p_appointment_id order by version desc limit 1;
 else raise exception 'TRANSCRIPT_INVALID' using errcode='22023';end if;
 if latest.version is not null and latest.case_id<>p_case_id then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 perform set_config('pea.clinical_context',previous,true);
 return jsonb_build_object('appointmentId',p_appointment_id,'recordId',p_case_id,'version',coalesce(latest.version,0),'text',coalesce(latest.text_content,''),'reviewed',coalesce(latest.reviewed,false),'updatedAt',latest.recorded_at);
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $$;
revoke all on function public.clinical_unified_encounter_transcript(text,text,uuid,uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function public.clinical_unified_encounter_transcript(text,text,uuid,uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
