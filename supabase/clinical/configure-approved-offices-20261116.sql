-- Prepared for explicit production authorization; no appointment/client/email writes.
begin;
set local request.jwt.claim.sub='3c514611-b530-4f48-84e4-32871b32f320';
set local pea.clinical_context='administration';
do $offices$
declare item jsonb;oid uuid;ids uuid[]:='{}';pro uuid;grants jsonb;rev integer;created integer:=0;
begin
 if not clinical.can_administer() then raise exception 'ADMIN_REQUIRED';end if;
 if not exists(select 1 from public.profiles where id='3c514611-b530-4f48-84e4-32871b32f320' and full_name='Hicham Boukili' and platform_access_enabled) or not exists(select 1 from public.profiles where id='826ec8b8-627f-4903-947e-24df0f446349' and full_name='Ève Deveault-Harvey' and platform_access_enabled) then raise exception 'TARGET_ACCOUNT_CHANGED';end if;
 lock table clinical.offices in share row exclusive mode;
 for item in select value from jsonb_array_elements('[{"name":"Longueuil — bureau 101","officeNumber":"101","address":"401, chemin du Coteau-Rouge","city":"Longueuil","province":"Québec","postalCode":"J4J 1X5","active":true},{"name":"Longueuil — bureau 102","officeNumber":"102","address":"401, chemin du Coteau-Rouge","city":"Longueuil","province":"Québec","postalCode":"J4J 1X5","active":true},{"name":"Longueuil — bureau 103","officeNumber":"103","address":"401, chemin du Coteau-Rouge","city":"Longueuil","province":"Québec","postalCode":"J4J 1X5","active":true},{"name":"Longueuil — bureau 104","officeNumber":"104","address":"401, chemin du Coteau-Rouge","city":"Longueuil","province":"Québec","postalCode":"J4J 1X5","active":true},{"name":"Montréal — bureau 233","officeNumber":"233","address":"1600, boulevard Henri-Bourassa Ouest","city":"Montréal","province":"Québec","postalCode":"H3M 3E3","active":true},{"name":"Montréal — bureau 250","officeNumber":"250","address":"1600, boulevard Henri-Bourassa Ouest","city":"Montréal","province":"Québec","postalCode":"H3M 3E3","active":true}]'::jsonb) loop
  select id into oid from clinical.offices where office_number=item->>'officeNumber' and lower(city)=lower(item->>'city');
  if (select count(*) from clinical.offices where office_number=item->>'officeNumber' and lower(city)=lower(item->>'city'))>1 then raise exception 'AMBIGUOUS_OFFICE';end if;
  if oid is null then
   if exists(select 1 from clinical.offices where lower(name)=lower(item->>'name')) then raise exception 'OFFICE_REVIEW_REQUIRED';end if;
   perform public.clinical_unified_calendar_command('administration','offices.create',null,jsonb_build_object('name',item->>'name','color',case when item->>'city'='Longueuil' then '#8a5633' else '#333d8a' end),gen_random_uuid());
   select id into strict oid from clinical.offices where name=item->>'name';
   update clinical.offices set address=item->>'address',city=item->>'city',province=item->>'province',postal_code=item->>'postalCode',office_number=item->>'officeNumber',version=version+1 where id=oid;
   created:=created+1;
  end if;
  if not exists(select 1 from clinical.offices where id=oid and active) then raise exception 'OFFICE_INACTIVE_REVIEW_REQUIRED';end if;
  ids:=array_append(ids,oid);
 end loop;
 foreach pro in array array['3c514611-b530-4f48-84e4-32871b32f320'::uuid,'826ec8b8-627f-4903-947e-24df0f446349'::uuid] loop
  perform pg_advisory_xact_lock(hashtextextended('calendar-professional/'||pro::text,0));
  select coalesce(jsonb_agg(jsonb_build_object('officeId',office_id,'validFrom',valid_from,'validTo',valid_to)),'[]') into grants from clinical.office_professional_grants where professional_id=pro and active;
  foreach oid in array ids loop
   if pro='826ec8b8-627f-4903-947e-24df0f446349' and not exists(select 1 from clinical.offices where id=oid and city='Longueuil') then continue;end if;
   if not exists(select 1 from clinical.office_professional_grants where professional_id=pro and office_id=oid and active and valid_from<=current_date and(valid_to is null or valid_to>=current_date)) then grants:=grants||jsonb_build_array(jsonb_build_object('officeId',oid,'validFrom',current_date,'validTo',null));end if;
  end loop;
  select coalesce((select revision from clinical.office_grant_revisions where professional_id=pro),0) into rev;
  perform public.clinical_unified_calendar_command('administration','office-grants.set',pro,jsonb_build_object('expectedRevision',rev,'grants',grants),gen_random_uuid());
 end loop;
 if not exists(select 1 from clinical.offices where id='fee9ad73-9f51-40cb-b610-f81196c00fe2' and office_number='102') or not exists(select 1 from clinical.offices where id='546baf24-c0ef-48f5-90c5-3e904074693a' and office_number='101') then raise exception 'EXISTING_UUID_CHANGED';end if;
 perform set_config('pea.office_setup_result',jsonb_build_object('officesCreated',created,'existingOfficesPreserved',true,'hichamOffices',6,'eveLongueuilOffices',4,'emails',0)::text,true);
end $offices$;
select current_setting('pea.office_setup_result')::jsonb verification;
commit;
