-- Prepared locally. No backfill, membership change or remote execution.
begin;
create table clinical.migration_client_validations (
 case_id uuid primary key references clinical.care_cases(id),
 source_key text not null, preparation jsonb not null, requester_ids jsonb not null default '{}',
 validated_by uuid not null references public.profiles(id), validated_at timestamptz not null default clock_timestamp()
);
create table clinical.mandate_professional_acceptances (
 revision_id uuid not null references clinical.mandate_revisions(id), profile_id uuid not null references public.profiles(id),
 role text not null check(role in('professional','supervisor')), effective_at timestamptz not null,
 profile_signature_id uuid references clinical.professional_signatures(id), graphic_added_at timestamptz,
 primary key(revision_id,profile_id)
);
alter table clinical.migration_client_validations enable row level security;
alter table clinical.migration_client_validations force row level security;
alter table clinical.mandate_professional_acceptances enable row level security;
alter table clinical.mandate_professional_acceptances force row level security;
revoke all on clinical.migration_client_validations,clinical.mandate_professional_acceptances from public,anon,authenticated,service_role;

-- Explicit migration operators may include administrative assistants, without
-- granting them the general permission to change clinical access elsewhere.
create function clinical.migration_can_delegate() returns boolean
language sql stable security definer set search_path='' set row_security=off as $$
 select clinical.can_administer() and exists(select 1 from clinical.migration_operators where profile_id=auth.uid() and enabled and can_import)
$$;
create or replace function clinical.migration_assert() returns void
language plpgsql security definer set search_path='' set row_security=off as $$begin
 perform clinical.unified_context('administration');
 if not clinical.can_administer() or not exists(select 1 from clinical.migration_operators where profile_id=auth.uid() and enabled) then raise exception 'MIGRATION_FORBIDDEN' using errcode='42501';end if;
end $$;
-- Derive private, migration-only variants from the installed canonical routines;
-- retain their validation, locks, snapshots and audit trail. Public routines and
-- actor capabilities are unchanged. These variants have no caller grants.
do $$declare d text;begin
 d:=pg_get_functiondef('public.clinical_create_case(uuid,text,jsonb)'::regprocedure);
 if position('public.clinical_create_case(' in d)=0 or position('clinical.can_manage_access()' in d)=0 then raise exception 'MIGRATION_CASE_ROUTINE_CHANGED';end if;
 d:=replace(d,'public.clinical_create_case(', 'clinical.migration_create_case(');
 d:=replace(d,'clinical.can_manage_access()', 'clinical.migration_can_delegate()');execute d;
 d:=pg_get_functiondef('clinical.mandate_apply_supervision(uuid,uuid)'::regprocedure);
 if position('clinical.mandate_apply_supervision(' in d)=0 or position('clinical.can_manage_access()' in d)=0 then raise exception 'MIGRATION_SUPERVISION_ROUTINE_CHANGED';end if;
 d:=replace(d,'clinical.mandate_apply_supervision(', 'clinical.migration_apply_supervision(');
 d:=replace(d,'clinical.can_manage_access()', 'clinical.migration_can_delegate()');execute d;
 d:=pg_get_functiondef('public.clinical_link_existing_assignment(uuid,uuid)'::regprocedure);
 if position('public.clinical_link_existing_assignment(' in d)=0 or position('p.role=''direction''' in d)=0 then raise exception 'MIGRATION_LINK_ROUTINE_CHANGED';end if;
 d:=replace(d,'public.clinical_link_existing_assignment(', 'clinical.migration_link_assignment(');
 d:=replace(d,'p.role=''direction''', '(p.role=''direction'' or (p.id=auth.uid() and clinical.migration_can_delegate()))');execute d;
end $$;

create function clinical.migration_client_defaults(p_data jsonb) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
declare choice jsonb;s uuid;d jsonb;begin
 choice:=clinical.migration_resolve_mandate_choice(p_data);
 select id into s from clinical.unified_service_catalogue where active and kind='clinical' and code=clinical.mandate_template_code(p_data->>'service');
 d:=clinical.unified_service_defaults((p_data->>'professionalId')::uuid,s,current_date);
 return d||jsonb_build_object('serviceId',s,'supervisorId',choice->'supervisorId',
  'settingsFingerprint',encode(sha256(convert_to(d::text||coalesce(choice->>'supervisorId',''),'UTF8')),'hex'));
end $$;

create function clinical.validate_migration_preparation(p jsonb) returns void
language plpgsql set search_path='' as $$
declare x jsonb;k text;total integer:=0;begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>90000 or
 exists(select 1 from jsonb_object_keys(p) allowed(field_name) where allowed.field_name not in('contactDate','startDate','outcome','additionalEmails','additionalPhones','consultationReason','modalities','availability','comments','requesters','payers','rateCents','rateSource','clinicalText','administrativeText','settingsFingerprint','validated'))
 or coalesce(p->>'outcome','') not in('active','not_taken','closed') or p->'validated' is distinct from 'true'::jsonb then raise exception 'MIGRATION_CLIENT_INVALID' using errcode='22023';end if;
 foreach k in array array['contactDate','startDate','additionalEmails','additionalPhones','consultationReason','modalities','availability','comments','clinicalText','administrativeText','settingsFingerprint'] loop
  if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k)>(case k when 'clinicalText' then 20000 when 'administrativeText' then 20000 when 'comments' then 4000 else 1000 end) then raise exception 'MIGRATION_CLIENT_INVALID' using errcode='22023';end if;
 end loop;
 foreach k in array array['contactDate','startDate'] loop
  if p->>k<>'' and ((p->>k)::date>current_date or (p->>k)::date<'1900-01-01' or to_char((p->>k)::date,'YYYY-MM-DD')<>p->>k) then raise exception 'MIGRATION_CLIENT_DATE_INVALID' using errcode='22023';end if;
 end loop;
 if p->'rateCents'<>'null'::jsonb then perform clinical.unified_mandate_integer(p,'rateCents',1,10000000);end if;
 if jsonb_typeof(p->'requesters') is distinct from 'array' or jsonb_array_length(p->'requesters')>10 or jsonb_typeof(p->'payers') is distinct from 'array' or jsonb_array_length(p->'payers')>30 then raise exception 'MIGRATION_CLIENT_INVALID' using errcode='22023';end if;
 for x in select value from jsonb_array_elements(p->'requesters') loop
  if jsonb_typeof(x) is distinct from 'object' or exists(select 1 from jsonb_object_keys(x) allowed(field_name) where allowed.field_name not in('key','fullName','email','phone','address','relationship')) then raise exception 'MIGRATION_CLIENT_INVALID' using errcode='22023';end if;
  foreach k in array array['key','fullName','email','phone','address','relationship'] loop
   if jsonb_typeof(x->k) is distinct from 'string' or length(x->>k)>(case k when 'address' then 500 when 'email' then 254 else 200 end) then raise exception 'MIGRATION_CLIENT_INVALID' using errcode='22023';end if;
  end loop;
  if coalesce(x->>'key','')!~'^[a-zA-Z0-9-]{1,80}$' then raise exception 'MIGRATION_CLIENT_INVALID' using errcode='22023';end if;
 end loop;
 if (select count(distinct item.value->>'key') from jsonb_array_elements(p->'requesters') item)<>jsonb_array_length(p->'requesters') then raise exception 'MIGRATION_REQUESTER_AMBIGUOUS' using errcode='22023';end if;
 for x in select value from jsonb_array_elements(p->'payers') loop
  if jsonb_typeof(x) is distinct from 'object' or exists(select 1 from jsonb_object_keys(x) allowed(field_name) where allowed.field_name not in('key','basisPoints')) or not(x->>'key'='client' or exists(select 1 from jsonb_array_elements(p->'requesters')r where r->>'key'=x->>'key' and btrim(r->>'fullName')<>'')) then raise exception 'MANDATE_INVALID_PAYER' using errcode='22023';end if;
  total:=total+clinical.unified_mandate_integer(x,'basisPoints',1,10000);
 end loop;
 if (jsonb_array_length(p->'payers')>0 and total<>10000) or (select count(distinct item.value->>'key') from jsonb_array_elements(p->'payers') item)<>jsonb_array_length(p->'payers') then raise exception 'MANDATE_PAYER_TOTAL' using errcode='22023';end if;
end $$;

-- New sources overwrite populated administrative fields only; blanks retain
-- existing facts. Rights, authority, removals and other cases remain unchanged.
alter function clinical.migration_enrich_case(uuid,jsonb) rename to migration_enrich_case_920_base;
create function clinical.migration_enrich_case(p_case uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare p clinical.patients;c clinical.care_cases;e clinical.service_episodes;prep jsonb;person jsonb;cid uuid;ids jsonb:='{}';facts jsonb;begin
 if not p_data?'preparation' then return clinical.migration_enrich_case_920_base(p_case,p_data);end if;
 perform clinical.migration_assert();prep:=p_data->'preparation';perform clinical.validate_migration_preparation(prep);
 select * into c from clinical.care_cases where id=p_case for update;
 select * into e from clinical.service_episodes where id=c.episode_id;
 select * into p from clinical.patients where id=e.patient_id for update;
 if p.id is null or not exists(select 1 from clinical.migration_source_links where source_key=p_data->>'sourceKey' and case_id=c.id and patient_id=p.id)
 or not exists(select 1 from clinical.case_access_grants where case_id=c.id and profile_id=(p_data->>'professionalId')::uuid and can_write and revoked_at is null)
 then raise exception 'CASE_CHANGED' using errcode='40001';end if;
 if nullif(p_data->>'birthDate','') is not null and p.birth_date is not null and p.birth_date<>(p_data->>'birthDate')::date then raise exception 'MIGRATION_IDENTITY_CONFLICT' using errcode='40001';end if;
 update clinical.patients set first_name=coalesce(nullif(btrim(p_data->>'firstName'),''),first_name),last_name=coalesce(nullif(btrim(p_data->>'lastName'),''),last_name),
  birth_date=coalesce(nullif(p_data->>'birthDate','')::date,birth_date),email=coalesce(nullif(p_data->>'email',''),email),phone=coalesce(nullif(p_data->>'phone',''),phone),address=coalesce(nullif(p_data->>'address',''),address),
  consultation_reason=coalesce(nullif(p_data#>>'{intake,consultationReason}',''),consultation_reason),version=version+1 where id=p.id;
 for person in select value from jsonb_array_elements(prep->'requesters') loop
  if btrim(person->>'fullName')='' then continue;end if;
  if lower(btrim(person->>'fullName'))=lower(btrim(p.first_name||' '||p.last_name)) then ids:=ids||jsonb_build_object(person->>'key',p.id);continue;end if;
  if (select count(*) from clinical.patient_contacts where patient_id=p.id and removed_at is null and lower(btrim(full_name))=lower(btrim(person->>'fullName')))>1 then raise exception 'MIGRATION_REQUESTER_AMBIGUOUS' using errcode='40001';end if;
  select id into cid from clinical.patient_contacts where patient_id=p.id and removed_at is null and lower(btrim(full_name))=lower(btrim(person->>'fullName'));
  if cid is null then
   insert into clinical.patient_contacts(patient_id,full_name,relationship,email,phone,address) values(p.id,btrim(person->>'fullName'),coalesce(nullif(person->>'relationship',''),'Requérant'),person->>'email',person->>'phone',person->>'address') returning id into cid;
  else
   update clinical.patient_contacts set relationship=coalesce(nullif(person->>'relationship',''),relationship),email=coalesce(nullif(person->>'email',''),email),phone=coalesce(nullif(person->>'phone',''),phone),address=coalesce(nullif(person->>'address',''),address),version=version+1 where id=cid;
  end if;
  ids:=ids||jsonb_build_object(person->>'key',cid);
 end loop;
 insert into clinical.migration_client_validations(case_id,source_key,preparation,requester_ids,validated_by) values(c.id,p_data->>'sourceKey',prep,ids,auth.uid())
 on conflict(case_id) do update set source_key=excluded.source_key,preparation=excluded.preparation,requester_ids=excluded.requester_ids,validated_by=excluded.validated_by,validated_at=clock_timestamp();
 facts:='{"initialCallDate":"","firstAppointmentDate":"","consultationReason":"","referredBy":"","originalMandates":[],"clientele":"","sourceActive":"","billingResponsible":"","interlocutor":"","relationship":"","requesters":[]}'::jsonb||coalesce(p_data->'intake','{}');
 facts:=jsonb_set(facts,'{requesters}',(select coalesce(jsonb_agg(jsonb_build_object('fullName',r->>'fullName','email',r->>'email','city','','postalCode','')),'[]') from jsonb_array_elements(prep->'requesters')r where btrim(r->>'fullName')<>''));
 insert into clinical.migration_intake_details(case_id,source_key,facts,recorded_by) values(c.id,p_data->>'sourceKey',facts,auth.uid()) on conflict(case_id) do update set source_key=excluded.source_key,facts=excluded.facts,recorded_by=excluded.recorded_by;
 return jsonb_build_object('enriched',true,'reviewRequired',false);
end $$;

create function clinical.record_mandate_acceptances(p_revision uuid) returns void
language plpgsql security definer set search_path='' set row_security=off as $$
declare r clinical.mandate_revisions;person record;sig clinical.professional_signatures;begin
 select * into r from clinical.mandate_revisions where id=p_revision;
 for person in select r.professional_id id,'professional'::text role union all select (r.unified_draft->>'supervisorId')::uuid,'supervisor' where r.unified_draft->>'supervisorId' is not null loop
  select * into sig from clinical.professional_signatures where professional_id=person.id and jsonb_array_length(strokes)>0 order by version desc limit 1;
  insert into clinical.mandate_professional_acceptances(revision_id,profile_id,role,effective_at,profile_signature_id,graphic_added_at)
   values(r.id,person.id,person.role,coalesce((select v.validated_at from clinical.migration_client_validations v join clinical.care_cases c on c.id=v.case_id join clinical.mandates m on m.episode_id=c.episode_id where m.id=r.mandate_id),r.created_at),sig.id,case when sig.id is not null then clock_timestamp() end) on conflict do nothing;
 end loop;
end $$;
create function clinical.sync_mandate_acceptance_graphics(p_revision uuid) returns void
language plpgsql security definer set search_path='' set row_security=off as $$
declare a record;doc clinical.mandate_documents;ev jsonb;r clinical.mandate_revisions;begin
 select * into r from clinical.mandate_revisions where id=p_revision for update;
 select * into doc from clinical.mandate_documents where revision_id=r.id and audience='clinical';
 if doc.id is null then return;end if;
 for a in select acc.*,sig.strokes,sig.version,p.full_name,p.professional_title,p.professional_license_number
  from clinical.mandate_professional_acceptances acc join clinical.professional_signatures sig on sig.id=acc.profile_signature_id join public.profiles p on p.id=acc.profile_id
  where acc.revision_id=r.id and not exists(select 1 from clinical.mandate_signatures s where s.revision_id=r.id and s.person_id=acc.profile_id and s.audience='clinical') loop
  if not exists(select 1 from clinical.mandate_signers where revision_id=r.id and person_id=a.profile_id and audience='clinical') then continue;end if;
  ev:=jsonb_build_object('name',a.full_name,'strokes',a.strokes,'profileSignatureId',a.profile_signature_id,'profileSignatureVersion',a.version,'autoSignature',true,'source','saved_professional_profile','professionalTitle',a.professional_title,'professionalOrderNumber',a.professional_license_number,'acceptedAt',a.effective_at,'graphicAddedAt',a.graphic_added_at);
  insert into clinical.mandate_signatures(revision_id,person_id,audience,document_id,document_hash,mode,evidence,operator_id,signed_at)
   values(r.id,a.profile_id,'clinical',doc.id,doc.sha256,'profile_automatic',ev,r.created_by,a.effective_at);
 end loop;
 if r.status in('prepared','partially_signed','signed') and exists(select 1 from clinical.mandate_signatures where revision_id=r.id) then
  update clinical.mandate_revisions set status=case when exists(select 1 from clinical.mandate_signers s where s.revision_id=r.id and s.required and not exists(select 1 from clinical.mandate_signatures sig where sig.revision_id=s.revision_id and sig.person_id=s.person_id and sig.audience=s.audience)) then 'partially_signed' else 'signed' end,version=version+1 where id=r.id;
 end if;
end $$;
create function clinical.capture_later_mandate_graphic() returns trigger
language plpgsql security definer set search_path='' set row_security=off as $$
declare rid uuid;begin
 if jsonb_array_length(new.strokes)=0 then return new;end if;
 for rid in update clinical.mandate_professional_acceptances set profile_signature_id=new.id,graphic_added_at=clock_timestamp()
  where profile_id=new.professional_id and profile_signature_id is null returning revision_id loop
  if exists(select 1 from clinical.mandate_revisions where id=rid and status='draft') then
   perform clinical.unified_mandate_capture_professional(rid);perform clinical.unified_mandate_capture_supervisor(rid);
  end if;
  perform clinical.sync_mandate_acceptance_graphics(rid);
 end loop;
 return new;
end $$;
create trigger mandate_later_profile_graphic after insert on clinical.professional_signatures for each row execute function clinical.capture_later_mandate_graphic();
create function clinical.date_automatic_mandate_signature() returns trigger
language plpgsql security definer set search_path='' set row_security=off as $$
declare a clinical.mandate_professional_acceptances;begin
 if new.mode='profile_automatic' then
  select * into a from clinical.mandate_professional_acceptances where revision_id=new.revision_id and profile_id=new.person_id;
  if a.revision_id is not null then new.signed_at:=a.effective_at;new.evidence:=new.evidence||jsonb_build_object('acceptedAt',a.effective_at,'graphicAddedAt',coalesce(a.graphic_added_at,clock_timestamp()));end if;
 end if;
 return new;
end $$;
create trigger automatic_mandate_signature_date before insert on clinical.mandate_signatures for each row execute function clinical.date_automatic_mandate_signature();
alter function public.clinical_unified_mandate_preview_source(text,uuid,text) rename to clinical_unified_mandate_preview_source_920_base;
create function public.clinical_unified_mandate_preview_source(p_context text,p_revision_id uuid,p_audience text default 'clinical') returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
declare q jsonb;begin
 q:=public.clinical_unified_mandate_preview_source_920_base(p_context,p_revision_id,p_audience);
 return jsonb_set(q,'{signatures}',(select coalesce(jsonb_agg(s||coalesce((select jsonb_build_object('signedAt',a.effective_at,'graphicAddedAt',a.graphic_added_at) from clinical.mandate_professional_acceptances a where a.revision_id=p_revision_id and a.profile_signature_id::text=s->>'profileSignatureId' limit 1),'{}')),'[]') from jsonb_array_elements(q->'signatures')s));
end $$;

-- A migration validates the administrative mandate now; client consent remains
-- unrecorded. Missing birth/payer/signature never manufactures missing facts.
alter function clinical.ensure_migration_mandate(uuid,jsonb) rename to ensure_migration_mandate_920_base;
create function clinical.ensure_migration_mandate(p_case uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare c clinical.care_cases;e clinical.service_episodes;m clinical.mandates;r clinical.mandate_revisions;oldr uuid;
 prep jsonb;def jsonb;d jsonb;people jsonb;signers jsonb;payers jsonb:='[]';x jsonb;person jsonb;pid uuid;ids jsonb;patient clinical.patients;day date;rate integer;terms jsonb;aud text;bytes bytea;begin
 if not p_data?'preparation' then return clinical.ensure_migration_mandate_920_base(p_case,p_data);end if;
 perform clinical.migration_assert();prep:=p_data->'preparation';perform clinical.validate_migration_preparation(prep);def:=clinical.migration_client_defaults(p_data);
 if prep->>'settingsFingerprint'<>'' and prep->>'settingsFingerprint'<>def->>'settingsFingerprint' then raise exception 'MIGRATION_SETTINGS_CHANGED' using errcode='40001';end if;
 select * into c from clinical.care_cases where id=p_case for update;select * into e from clinical.service_episodes where id=c.episode_id;
 select * into patient from clinical.patients where id=e.patient_id;
 if c.id is null or not exists(select 1 from clinical.case_access_grants where case_id=c.id and profile_id=(p_data->>'professionalId')::uuid and can_write and revoked_at is null) then raise exception 'CASE_CHANGED' using errcode='40001';end if;
 select requester_ids into ids from clinical.migration_client_validations where case_id=c.id;
 perform pg_advisory_xact_lock(hashtextextended('real-mandate/'||e.id::text,0));
 select * into m from clinical.mandates where episode_id=e.id for update;
 if m.id is null then insert into clinical.mandates(patient_id,episode_id,created_by) values(patient.id,e.id,auth.uid()) returning * into m;end if;
 select * into r from clinical.mandate_revisions where id=m.current_revision_id for update;
 if r.id is not null and r.professional_id<>(p_data->>'professionalId')::uuid then raise exception 'MIGRATION_MANDATE_PROFESSIONAL_CHANGED' using errcode='40001';end if;
 if r.id is not null and (r.status<>'draft' or exists(select 1 from clinical.mandate_documents where revision_id=r.id)) then oldr:=r.id;r.id:=null;end if;
 if r.id is null then
  insert into clinical.mandate_revisions(mandate_id,number,professional_id,service_label,previous_revision_id,amendment_reason,created_by)
   values(m.id,coalesce((select max(number)+1 from clinical.mandate_revisions where mandate_id=m.id),1),(p_data->>'professionalId')::uuid,p_data->>'service',oldr,case when oldr is null then '' else 'Nouvelle convention IA lors de la migration' end,auth.uid()) returning * into r;
  update clinical.mandates set current_revision_id=r.id where id=m.id;
 end if;
 day:=coalesce(nullif(prep->>'startDate','')::date,nullif(prep->>'contactDate','')::date,current_date);
 rate:=coalesce((prep->>'rateCents')::integer,case clinical.mandate_template_code(p_data->>'service') when 'psychoeducation' then 13500 when 'intervention_psychoeducative' then 10000 end,(def->>'rateCents')::integer,(select amount_cents from clinical.unified_service_rates where id=(def->>'rateId')::uuid));
 select jsonb_build_array(jsonb_build_object('id',patient.id,'name',patient.first_name||' '||patient.last_name,'email',patient.email,'roles',jsonb_build_array('client'),'authorityVerified',false,'authorityBasis','','canConsent',patient.birth_date is not null and age(day,patient.birth_date)>=interval '14 years','canCommunicate',false,'canReadDocuments',false,'canRepresent',false))||
  coalesce(jsonb_agg(jsonb_build_object('id',ct.id,'name',ct.full_name,'email',ct.email,'roles',jsonb_build_array('contact'),'authorityVerified',false,'authorityBasis','','canConsent',false,'canCommunicate',ct.communication_allowed,'canReadDocuments',ct.documents_allowed,'canRepresent',false)) filter(where ct.id is not null),'[]') into people from clinical.patient_contacts ct where ct.patient_id=patient.id and ct.removed_at is null;
 select people||coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'name',pr.full_name,'email',pr.email,'roles',jsonb_build_array(case when pr.authority_verified then 'representative' else 'contact' end),'authorityVerified',pr.authority_verified,'authorityBasis',case when pr.authority_verified then 'Qualité vérifiée dans la fiche du client.' else '' end,'canConsent',pr.authority_verified,'canCommunicate',pr.communication_allowed,'canReadDocuments',pr.documents_allowed,'canRepresent',pr.authority_verified)),'[]') into people from clinical.patient_representatives pr where pr.patient_id=patient.id and pr.removed_at is null;
 select people||coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.full_name,'email',b.email,'roles',jsonb_build_array('payer'),'authorityVerified',false,'authorityBasis','','canConsent',false,'canCommunicate',false,'canReadDocuments',false,'canRepresent',false)),'[]') into people from clinical.unified_billing_parties(patient.id)b where b.source='payer' and not exists(select 1 from jsonb_array_elements(people)p where p->>'id'=b.id::text);
 for x in select value from jsonb_array_elements(prep->'payers') loop
  pid:=case when x->>'key'='client' then patient.id else (ids->>(x->>'key'))::uuid end;
  if pid is null then raise exception 'MANDATE_INVALID_PAYER' using errcode='22023';end if;
  payers:=payers||jsonb_build_array(jsonb_build_object('personId',pid,'basisPoints',(x->>'basisPoints')::integer));
 end loop;
 if jsonb_array_length(payers)=0 then
  select coalesce(jsonb_agg(jsonb_build_object('personId',b.id,'basisPoints',b.basis_points)),'[]') into payers from clinical.unified_billing_parties(patient.id)b where b.basis_points>0 and exists(select 1 from jsonb_array_elements(people)p where p->>'id'=b.id::text);
  if (select coalesce(sum((item.value->>'basisPoints')::int),0) from jsonb_array_elements(payers) item)<>10000 then payers:='[]';end if;
 end if;
 select jsonb_agg(case when exists(select 1 from jsonb_array_elements(payers)pay where pay->>'personId'=p->>'id') then jsonb_set(p,'{roles}',(p->'roles')||'["payer"]') else p end) into people from jsonb_array_elements(people)p;
 select coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'personId',p->'id','profileId',null,'name',p->>'name','role',case when p->'roles'?'client' then 'client' else 'representative' end,'audience','clinical','required',true)),'[]') into signers from jsonb_array_elements(people)p
  where (p->>'canConsent')::boolean and ((patient.birth_date is not null and age(day,patient.birth_date)>=interval '14 years' and p->'roles'?'client') or ((patient.birth_date is null or age(day,patient.birth_date)<interval '14 years') and p->'roles'?'representative'));
 -- Unknown authority stays pending; never infer it from a requester/payer name.
 if jsonb_array_length(signers)=0 then signers:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'personId',patient.id,'profileId',null,'name',patient.first_name||' '||patient.last_name,'role','client','audience','clinical','required',true));end if;
 signers:=signers||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'personId',null,'profileId',(p_data->>'professionalId')::uuid,'name',(select full_name from public.profiles where id=(p_data->>'professionalId')::uuid),'role','professional','audience','clinical','required',false));
 select signers||coalesce(jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'personId',pay->'personId','profileId',null,'name',p->>'name','role','payer','audience','administrative','required',false)),'[]') into signers from jsonb_array_elements(payers)pay join jsonb_array_elements(people)p on p->>'id'=pay->>'personId';
 d:=def||jsonb_build_object('serviceDate',current_date,'professionalId',(p_data->>'professionalId')::uuid,'authorizedProfileIds','[]'::jsonb,'people',people,'payers',payers,'signers',signers,'legalReview',jsonb_build_object('confirmed',false,'context','','exceptionReason',''),'administrativeInstructions',prep->>'comments','overrideCents',rate,'overrideReason','Tarif validé individuellement lors de la migration','clinicalText',coalesce(nullif(prep->>'clinicalText',''),def->>'clinicalText'),'administrativeText',coalesce(nullif(prep->>'administrativeText',''),def->>'administrativeText'));
 select jsonb_object_agg(key,value) into d from jsonb_each(d) where key in('serviceId','rateId','serviceDate','overrideCents','overrideReason','templateId','policyId','professionalId','supervisorId','authorizedProfileIds','people','payers','signers','legalReview','administrativeInstructions','clinicalText','administrativeText');
 if c.status='open' then perform clinical.migration_apply_supervision(r.id,(def->>'supervisorId')::uuid);
 elsif def->>'supervisorId' is not null and not exists(select 1 from clinical.case_access_grants where case_id=c.id and profile_id=(def->>'supervisorId')::uuid and can_cosign and revoked_at is null) then raise exception 'SUPERVISION_ACCESS_CHANGED' using errcode='40001';end if;
 if def->>'supervisorId' is not null then d:=jsonb_set(d,'{signers}',signers||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'personId',null,'profileId',def->'supervisorId','name',(select full_name from public.profiles where id=(def->>'supervisorId')::uuid),'role','supervisor','audience','clinical','required',false)));end if;
 update clinical.mandate_revisions set service_label=p_data->>'service',version=version+1 where id=r.id;
 -- Original normalized writer, with all identity/party/reference checks. The
 -- financial wrapper would reject missing payers, which migration may defer.
 perform clinical.unified_mandate_write_792(r.id,d);
 d:=jsonb_set(d,'{serviceDate}',to_jsonb(day::text));
 update clinical.mandate_revisions set unified_draft=d,version=version+1 where id=r.id;
 if jsonb_array_length(payers)>0 then
  terms:=clinical.unified_mandate_financial_terms(r.id);
  insert into clinical.unified_mandate_financial_records(revision_id,actor_id,terms,terms_hash,source) values(r.id,auth.uid(),terms,encode(sha256(convert_to(terms::text,'UTF8')),'hex'),'staff_recorded');
 end if;
 perform clinical.record_mandate_acceptances(r.id);
 foreach aud in array array['clinical','administrative'] loop
  bytes:=clinical.mandate_pdf(clinical.mandate_document_text(r.id,aud));
  insert into clinical.mandate_documents(revision_id,audience,pdf_bytes,sha256) values(r.id,aud,bytes,encode(sha256(bytes),'hex'));
 end loop;
 update clinical.mandate_revisions set status='prepared',prepared_at=clock_timestamp(),version=version+1 where id=r.id;
 perform clinical.sync_mandate_acceptance_graphics(r.id);
 insert into clinical.unified_mandate_history(mandate_id,revision_id,actor_id,action,detail) values(m.id,r.id,auth.uid(),'migration.client_validated','Mandat validé ; consentement client à recueillir séparément');
 return jsonb_build_object('mandateId',m.id,'mandateStatus','validated','financiallyActive',clinical.unified_mandate_financial_ready(r.id),'signatureRequiredForBilling',false);
end $$;

create function clinical.migration_client_history(p_case uuid,p_data jsonb) returns void
language plpgsql security definer set search_path='' set row_security=off as $$
declare c clinical.care_cases;e clinical.service_episodes;prep jsonb:=p_data->'preparation';aid uuid;wid uuid;pro uuid:=(p_data->>'professionalId')::uuid;day date;old boolean;begin
 select * into c from clinical.care_cases where id=p_case for update;select * into e from clinical.service_episodes where id=c.episode_id for update;
 select l.source_id into aid from clinical.legacy_assignment_links l where l.episode_id=e.id and l.source_table='assigned_clients';
  if prep->>'outcome'='not_taken' and (exists(select 1 from clinical.appointments where case_id=c.id and kind='meeting' and status='completed') or exists(select 1 from clinical.notes where case_id=c.id and note_type<>'fermeture')) then raise exception 'ASSIGNMENT_ENCOUNTER_EXISTS' using errcode='40001';end if;
 if prep->>'outcome'<>'active' and exists(select 1 from clinical.appointments where case_id=c.id and status='planned' and end_at>clock_timestamp()) then raise exception 'CLINICAL_FUTURE_APPOINTMENTS' using errcode='40001';end if;
 day:=nullif(prep->>'contactDate','')::date;
 if aid is not null then select waiting_list_client_id,is_active into wid,old from public.assigned_clients where id=aid and professional_id=pro for update;if not found then raise exception 'CASE_CHANGED' using errcode='40001';end if;end if;
 if wid is null then
  insert into public.waiting_list_clients(contact_date,status,priority_level,service_requested,client_name,first_requester_name,second_requester_name,birth_date,city,meeting_modality,availability,contact_emails,contact_phones,consultation_reason,internal_notes,assigned_professional_id,assigned_at)
   values(day,'assigned','normal',p_data->>'service',btrim((p_data->>'firstName')||' '||(p_data->>'lastName')),prep#>>'{requesters,0,fullName}',prep#>>'{requesters,1,fullName}',nullif(p_data->>'birthDate','')::date,coalesce(p_data->>'address',''),case when prep->>'modalities'='' then '{}'::text[] else array[prep->>'modalities'] end,prep->>'availability',array(select btrim(v) from regexp_split_to_table(concat_ws(';',nullif(p_data->>'email',''),nullif(prep->>'additionalEmails','')),E'[;,\n]+') v where btrim(v)<>''),array(select btrim(v) from regexp_split_to_table(concat_ws(';',nullif(p_data->>'phone',''),nullif(prep->>'additionalPhones','')),E'[;\n]+') v where btrim(v)<>''),coalesce(p_data#>>'{intake,consultationReason}',''),prep->>'comments',pro,clock_timestamp()) returning id into wid;
 else
  update public.waiting_list_clients set contact_date=coalesce(day,contact_date),service_requested=p_data->>'service',client_name=btrim((p_data->>'firstName')||' '||(p_data->>'lastName')),
   first_requester_name=coalesce(nullif(prep#>>'{requesters,0,fullName}',''),first_requester_name),second_requester_name=coalesce(nullif(prep#>>'{requesters,1,fullName}',''),second_requester_name),
   birth_date=coalesce(nullif(p_data->>'birthDate','')::date,birth_date),city=coalesce(nullif(p_data->>'address',''),city),
   meeting_modality=case when prep->>'modalities'<>'' then array[prep->>'modalities'] else meeting_modality end,availability=coalesce(nullif(prep->>'availability',''),availability),
   contact_emails=case when concat(p_data->>'email',prep->>'additionalEmails')<>'' then array(select btrim(v) from regexp_split_to_table(concat_ws(';',nullif(p_data->>'email',''),nullif(prep->>'additionalEmails','')),E'[;,\n]+') v where btrim(v)<>'') else contact_emails end,contact_phones=case when concat(p_data->>'phone',prep->>'additionalPhones')<>'' then array(select btrim(v) from regexp_split_to_table(concat_ws(';',nullif(p_data->>'phone',''),nullif(prep->>'additionalPhones','')),E'[;\n]+') v where btrim(v)<>'') else contact_phones end,
   consultation_reason=coalesce(nullif(p_data#>>'{intake,consultationReason}',''),consultation_reason),internal_notes=coalesce(nullif(prep->>'comments',''),internal_notes) where id=wid;
 end if;
 if aid is null then
  insert into public.assigned_clients(professional_id,waiting_list_client_id,first_name,last_name,email,phone,requester_name,short_comment,meeting_modality,service_address,assigned_date,contacted,is_active,dossier_closed)
   values(pro,wid,p_data->>'firstName',p_data->>'lastName',coalesce(p_data->>'email',''),coalesce(p_data->>'phone',''),coalesce(prep#>>'{requesters,0,fullName}',''),prep->>'comments',prep->>'modalities',coalesce(p_data->>'address',''),(clock_timestamp() at time zone 'America/Toronto')::date,true,prep->>'outcome'<>'not_taken',prep->>'outcome'='closed') returning id into aid;
  insert into clinical.legacy_assignment_links(patient_id,episode_id,source_table,source_id,created_by) values(e.patient_id,e.id,'assigned_clients',aid,auth.uid());
 else
  update public.assigned_clients set email=coalesce(nullif(p_data->>'email',''),email),phone=coalesce(nullif(p_data->>'phone',''),phone),requester_name=coalesce(nullif(prep#>>'{requesters,0,fullName}',''),requester_name),short_comment=coalesce(nullif(prep->>'comments',''),short_comment),meeting_modality=coalesce(nullif(prep->>'modalities',''),meeting_modality),service_address=coalesce(nullif(p_data->>'address',''),service_address),contacted=true,is_active=prep->>'outcome'<>'not_taken',dossier_closed=prep->>'outcome'='closed' where id=aid;
 end if;
 insert into public.assigned_client_status_history(assigned_client_id,previous_status,new_status,changed_by_profile_id,changed_by_role,changed_by_name) values(aid,old,prep->>'outcome'<>'not_taken',auth.uid(),(select role from public.profiles where id=auth.uid()),(select full_name from public.profiles where id=auth.uid()));
 if prep->>'outcome'<>'active' and c.status='open' then
  perform public.clinical_close_case(c.id,'administrative',case when prep->>'outcome'='closed' then 'Suivi terminé avant la migration' else 'Service non pris avant la migration' end);
 end if;
end $$;

-- Run status/history in the same per-item subtransaction as documents/mandate.
do $$declare d text;needle text:='mandate_result:=clinical.ensure_migration_mandate(record,x);';begin
 d:=pg_get_functiondef('public.clinical_migration_command_805_base(text,uuid,jsonb)'::regprocedure);
 if position(needle in d)=0 then raise exception 'MIGRATION_920_BASELINE_CHANGED';end if;
 d:=replace(d,'public.clinical_create_case(', 'clinical.migration_create_case(');
 d:=replace(d,'public.clinical_link_existing_assignment(', 'clinical.migration_link_assignment(');
 if position('if existing.source_digest<>digest then raise exception ''SOURCE_ALREADY_IMPORTED_DIFFERENTLY'';end if;' in d)=0 then raise exception 'MIGRATION_SOURCE_920_BASELINE_CHANGED';end if;
 d:=replace(d,'if existing.source_digest<>digest then raise exception ''SOURCE_ALREADY_IMPORTED_DIFFERENTLY'';end if;',$source$
 if existing.source_digest<>digest then
  if x?'preparation' and x->>'decision'='link' and x->'associationConfirmed'='true'::jsonb
   and existing.patient_id=(x->>'patientId')::uuid and existing.case_id=nullif(x->>'caseId','')::uuid
   and exists(select 1 from clinical.case_access_grants g where g.case_id=existing.case_id and g.profile_id=(x->>'professionalId')::uuid and g.can_write and g.revoked_at is null) then
   update clinical.migration_source_links set source_digest=digest where source_key=key;
  else raise exception 'SOURCE_ALREADY_IMPORTED_DIFFERENTLY';end if;
 end if;
 $source$);
 d:=replace(d,needle,needle||E'\n if x?''preparation'' then perform clinical.migration_client_history(record,x);end if;');
 d:=replace(d,$old$c.id=record and c.status='open' and e.patient_id=patient$old$,$new$c.id=record and (c.status='open' or (x?'preparation' and x#>>'{preparation,outcome}' in('closed','not_taken') and c.status='closed')) and e.patient_id=patient$new$);
 d:=replace(d,'case when sqlerrm in(', 'case when sqlerrm in(''MIGRATION_SETTINGS_CHANGED'',''MIGRATION_IDENTITY_CONFLICT'',''MIGRATION_REQUESTER_AMBIGUOUS'',''ASSIGNMENT_ENCOUNTER_EXISTS'',''CLINICAL_FUTURE_APPOINTMENTS'',');
 execute d;
end $$;

alter function public.clinical_migration_command(text,uuid,jsonb) rename to clinical_migration_command_920_base;
create function public.clinical_migration_command(p_action text,p_batch uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare b clinical.migration_batches;i clinical.migration_items;x jsonb;v jsonb;k text;pro uuid;def jsonb;begin
 perform clinical.migration_assert();
 if p_action='client.defaults' then
  if exists(select 1 from jsonb_object_keys(p_data) allowed(field_name) where allowed.field_name not in('professionalId','service','supervisorId')) then raise exception 'INVALID_ITEM' using errcode='22023';end if;
  return clinical.migration_client_defaults(p_data);
 end if;
 if not exists(select 1 from clinical.migration_operators where profile_id=auth.uid() and enabled and can_import) then raise exception 'MIGRATION_READ_ONLY' using errcode='42501';end if;
 if p_action='correct' and exists(select 1 from clinical.migration_batches where id=p_batch and owner_id=auth.uid() and manifest->'clientByClient'='true'::jsonb) then raise exception 'MIGRATION_VALIDATED_CASE_REQUIRES_REVIEW' using errcode='22023';end if;
 if p_action='item' and exists(select 1 from clinical.migration_items item join clinical.migration_batches batch on batch.id=item.batch_id where batch.id=p_batch and batch.owner_id=auth.uid() and item.source_key=p_data->>'sourceKey' and (batch.manifest->'clientByClient'='true'::jsonb or item.payload?'preparation')) then raise exception 'MIGRATION_INDIVIDUAL_REQUIRED' using errcode='22023';end if;
 if p_action='prepare' then
  if p_batch is null or p_data->'clientByClient' is distinct from 'true'::jsonb or jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 500 or length(btrim(p_data->>'label')) not between 1 and 120 then raise exception 'INVALID_BATCH' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_batch::text,0));
  select * into b from clinical.migration_batches where id=p_batch;
  if found then if b.owner_id<>auth.uid() or b.manifest<>p_data then raise exception 'MIGRATION_CONFLICT' using errcode='40001';end if;return public.clinical_migration_query(p_batch);end if;
  insert into clinical.migration_batches(id,owner_id,label,manifest,status,confirmed_at) values(p_batch,auth.uid(),btrim(p_data->>'label'),p_data,'confirmed',clock_timestamp());
  for x in select value from jsonb_array_elements(p_data->'items') loop
   k:=x->>'sourceKey';if coalesce(k,'')!~'^[a-z0-9:-]{8,180}$' or octet_length(x::text)>100000 then raise exception 'INVALID_ITEM' using errcode='22023';end if;
   insert into clinical.migration_items(batch_id,source_key,payload,status) values(p_batch,k,x,case when x->>'decision'='skip' then 'skipped' else 'pending' end);
  end loop;
  insert into clinical.migration_events(batch_id,actor_id,action) values(p_batch,auth.uid(),'prepared.individually');
  return public.clinical_migration_query(p_batch);
 end if;
 if p_action='client.save' then
  select * into b from clinical.migration_batches where id=p_batch and owner_id=auth.uid() for update;
  if b.id is null or b.manifest->'clientByClient' is distinct from 'true'::jsonb then raise exception 'MIGRATION_NOT_FOUND' using errcode='P0002';end if;
  select * into i from clinical.migration_items where batch_id=b.id and source_key=p_data->>'sourceKey' for update;
  x:=p_data->'payload';
  if i.batch_id is null or jsonb_typeof(x) is distinct from 'object' or x->>'sourceKey' is distinct from i.source_key then raise exception 'INVALID_ITEM' using errcode='22023';end if;
  if i.status='imported' then
   if x<>i.payload then raise exception 'MIGRATION_CONFLICT' using errcode='40001';end if;
   return public.clinical_migration_query(p_batch);
  end if;
  if b.version is distinct from (p_data->>'expectedVersion')::integer then raise exception 'MIGRATION_CONFLICT' using errcode='40001';end if;
  perform clinical.validate_migration_preparation(x->'preparation');
  pro:=(x->>'professionalId')::uuid;
  if x->>'decision'='link' then perform 1 from clinical.patients where id=(x->>'patientId')::uuid for update;end if;
  if x->>'decision'='operational' then perform 1 from public.assigned_clients a join public.waiting_list_clients w on w.id=a.waiting_list_client_id where a.id=(x->>'assignmentId')::uuid for update of a,w;end if;
  if coalesce(btrim(x->>'firstName'),'')='' or coalesce(btrim(x->>'lastName'),'')='' or length(x->>'firstName')>100 or length(x->>'lastName')>100 or x->>'decision' not in('create','link','operational') then raise exception 'IDENTITY_REQUIRED' using errcode='22023';end if;
  if not exists(select 1 from public.profiles p join clinical.actor_capabilities a on a.profile_id=p.id where p.id=pro and p.is_active and p.platform_access_enabled and a.actor_kind in('professional','supervisor')) then raise exception 'INVALID_PROFESSIONAL' using errcode='22023';end if;
  if nullif(x->>'birthDate','') is not null and ((x->>'birthDate')::date>current_date or (x->>'birthDate')::date<'1900-01-01') then raise exception 'INVALID_BIRTH_DATE' using errcode='22023';end if;
  if x->>'decision'='create' and exists(select 1 from clinical.patients where lower(btrim(first_name))=lower(btrim(x->>'firstName')) and lower(btrim(last_name))=lower(btrim(x->>'lastName'))) then raise exception 'MIGRATION_IDENTITY_CONFLICT' using errcode='40001';end if;
  if x->>'decision'='link' and (x->'associationConfirmed' is distinct from 'true'::jsonb or not exists(select 1 from clinical.patients p where p.id=(x->>'patientId')::uuid and p.version=(x->>'patientVersion')::integer and lower(btrim(p.first_name))=lower(btrim(x->>'firstName')) and lower(btrim(p.last_name))=lower(btrim(x->>'lastName')) and (nullif(x->>'birthDate','') is null or p.birth_date is null or p.birth_date=(x->>'birthDate')::date))) then raise exception 'PATIENT_CHANGED' using errcode='40001';end if;
  if x->>'decision'='operational' and (x->'associationConfirmed' is distinct from 'true'::jsonb or not exists(select 1 from public.assigned_clients a join public.waiting_list_clients w on w.id=a.waiting_list_client_id where a.id=(x->>'assignmentId')::uuid and a.professional_id=pro and a.canceled_at is null and a.dossier_closed is not true and encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')=x->>'assignmentFingerprint' and lower(btrim(a.first_name))=lower(btrim(x->>'firstName')) and lower(btrim(a.last_name))=lower(btrim(x->>'lastName')) and (nullif(x->>'birthDate','') is null or w.birth_date is null or w.birth_date=(x->>'birthDate')::date))) then raise exception 'OPERATIONAL_ASSOCIATION_CHANGED' using errcode='40001';end if;
  if x->>'decision'='link' and nullif(x->>'caseId','') is null and exists(select 1 from clinical.care_cases c join clinical.service_episodes e on e.id=c.episode_id join clinical.case_access_grants g on g.case_id=c.id where e.patient_id=(x->>'patientId')::uuid and c.status='open' and g.profile_id=pro and g.can_write and g.revoked_at is null) then raise exception 'CASE_CHANGED' using errcode='40001';end if;
  def:=clinical.migration_client_defaults(x);
  if jsonb_typeof(x->'documents') is distinct from 'array' or jsonb_array_length(x->'documents')>10 or (select coalesce(sum((doc->>'bytes')::integer),0) from jsonb_array_elements(x->'documents')doc)>5242880 then raise exception 'INVALID_DOCUMENTS' using errcode='22023';end if;
  for v in select value from jsonb_array_elements(x->'documents') loop
   if coalesce(v->>'sha256','')!~'^[a-f0-9]{64}$' or coalesce((v->>'bytes')::integer,0) not between 100 and 5242880 or coalesce((v->>'pages')::integer,0) not between 1 and 500 or coalesce(v->>'kind','') not in('notes','report','consent','mandate','financial') then raise exception 'INVALID_DOCUMENT' using errcode='22023';end if;
  end loop;
  update clinical.migration_items set payload=x,status='pending',error_code=null where batch_id=b.id and source_key=i.source_key;
  return public.clinical_migration_command_920_base('item',p_batch,p_data-'payload'-'expectedVersion');
 end if;
 return public.clinical_migration_command_920_base(p_action,p_batch,p_data);
end $$;

-- Hide the old permanent warning only for individually validated migrations.
alter function public.clinical_unified_client_overview(uuid,text) rename to clinical_unified_client_overview_920_base;
create function public.clinical_unified_client_overview(p_patient_id uuid,p_context text) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
declare q jsonb;begin
 q:=public.clinical_unified_client_overview_920_base(p_patient_id,p_context);
 if q?'importedIntake' then q:=jsonb_set(q,'{importedIntake}',(select coalesce(jsonb_agg(x||jsonb_build_object('reviewRequired',not exists(select 1 from clinical.migration_client_validations v where v.case_id=(x->>'caseId')::uuid))),'[]') from jsonb_array_elements(q->'importedIntake')x));end if;
 return q;
end $$;
alter function public.clinical_migration_query(uuid) rename to clinical_migration_query_920_base;
create function public.clinical_migration_query(p_batch uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
declare q jsonb;begin
 q:=public.clinical_migration_query_920_base(p_batch);
 if p_batch is not null then return q;end if;
 return jsonb_set(q,'{patients}',(select coalesce(jsonb_agg(item||jsonb_build_object('address',p.address,'consultationReason',p.consultation_reason,
  'requesters',(select coalesce(jsonb_agg(jsonb_build_object('key','existing-'||ct.id::text,'fullName',ct.full_name,'email',ct.email,'phone',ct.phone,'address',ct.address,'relationship',ct.relationship) order by ct.id),'[]') from clinical.patient_contacts ct where ct.patient_id=p.id and ct.removed_at is null))), '[]') from jsonb_array_elements(q->'patients') item join clinical.patients p on p.id=(item->>'id')::uuid));
end $$;

-- New assignments acquire an immutable reference date; no existing signature or
-- original PDF is rewritten. Adding an image later is separately timestamped.
create function clinical.new_mandate_acceptance() returns trigger
language plpgsql security definer set search_path='' set row_security=off as $$begin perform clinical.record_mandate_acceptances(new.id);return new;end $$;
create trigger mandate_acceptance_created after insert on clinical.mandate_revisions for each row execute function clinical.new_mandate_acceptance();
alter function clinical.unified_mandate_revision_json(uuid,boolean) rename to unified_mandate_revision_json_920_base;
create function clinical.unified_mandate_revision_json(p_revision uuid,p_full boolean) returns jsonb
language sql stable security definer set search_path='' set row_security=off as $$
 select clinical.unified_mandate_revision_json_920_base(p_revision,p_full)||jsonb_build_object('professionalAcceptances',
 (select coalesce(jsonb_agg(jsonb_build_object('profileId',a.profile_id,'role',a.role,'effectiveAt',a.effective_at,'graphicAddedAt',a.graphic_added_at) order by a.role),'[]') from clinical.mandate_professional_acceptances a join clinical.mandate_revisions r on r.id=a.revision_id where a.revision_id=p_revision and (a.profile_id=r.professional_id or a.profile_id=(r.unified_draft->>'supervisorId')::uuid)))
 ||coalesce((select jsonb_build_object('professionalSignatureStatus',case when a.profile_signature_id is null then 'missing' else 'ready' end) from clinical.mandate_professional_acceptances a where a.revision_id=p_revision and a.role='professional'),'{}')
 ||coalesce((select jsonb_build_object('supervisorSignatureStatus',case when a.profile_signature_id is null then 'missing' else 'ready' end) from clinical.mandate_professional_acceptances a join clinical.mandate_revisions r on r.id=a.revision_id where a.revision_id=p_revision and a.role='supervisor' and a.profile_id=(r.unified_draft->>'supervisorId')::uuid),'{}')
$$;
alter function clinical.unified_mandate_write(uuid,jsonb) rename to unified_mandate_write_920_base;
create function clinical.unified_mandate_write(p_revision uuid,p_d jsonb) returns void
language plpgsql security definer set search_path='' set row_security=off as $$begin
 perform clinical.unified_mandate_write_920_base(p_revision,p_d);perform clinical.record_mandate_acceptances(p_revision);
end $$;

-- Keep the original prepare/sign validations, except that a missing supervisor
-- image no longer prevents preparation for newly accepted mandates.
do $$declare d text;begin
 d:=pg_get_functiondef('clinical.unified_mandate_prepare(uuid,integer)'::regprocedure);
 d:=replace(d,$needle$if r.unified_draft->>'supervisorId' is not null and sn.profile_signature_id is null then raise exception 'MANDATE_SUPERVISOR_SIGNATURE_REQUIRED' using errcode='22023';end if;$needle$,'');
 execute d;
end $$;

revoke all on function clinical.migration_client_defaults(jsonb),clinical.validate_migration_preparation(jsonb),clinical.migration_enrich_case(uuid,jsonb),clinical.migration_enrich_case_920_base(uuid,jsonb),clinical.record_mandate_acceptances(uuid),clinical.sync_mandate_acceptance_graphics(uuid),clinical.capture_later_mandate_graphic(),clinical.ensure_migration_mandate(uuid,jsonb),clinical.ensure_migration_mandate_920_base(uuid,jsonb),clinical.migration_client_history(uuid,jsonb),public.clinical_migration_command_920_base(text,uuid,jsonb),public.clinical_migration_command(text,uuid,jsonb),public.clinical_unified_client_overview_920_base(uuid,text),public.clinical_unified_client_overview(uuid,text),clinical.new_mandate_acceptance(),clinical.unified_mandate_write_920_base(uuid,jsonb),clinical.unified_mandate_write(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.clinical_migration_command(text,uuid,jsonb),public.clinical_unified_client_overview(uuid,text) to authenticated;
revoke all on function clinical.date_automatic_mandate_signature(),clinical.unified_mandate_revision_json(uuid,boolean),clinical.unified_mandate_revision_json_920_base(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.clinical_unified_mandate_preview_source_920_base(text,uuid,text),public.clinical_unified_mandate_preview_source(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.clinical_unified_mandate_preview_source(text,uuid,text) to authenticated;
revoke all on function public.clinical_migration_query_920_base(uuid),public.clinical_migration_query(uuid) from public,anon,authenticated,service_role;
grant execute on function public.clinical_migration_query(uuid) to authenticated;
revoke all on function clinical.migration_can_delegate(),clinical.migration_assert(),clinical.migration_create_case(uuid,text,jsonb),clinical.migration_apply_supervision(uuid,uuid),clinical.migration_link_assignment(uuid,uuid) from public,anon,authenticated,service_role;
commit;
