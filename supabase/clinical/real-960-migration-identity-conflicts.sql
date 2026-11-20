begin;
alter function public.clinical_migration_command(text,uuid,jsonb) rename to clinical_migration_command_960_base;
revoke all on function public.clinical_migration_command_960_base(text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.clinical_migration_command(p_action text,p_batch uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare requested_birth date;begin
 perform clinical.migration_assert();
 if p_action='client.save' and p_data#>>'{payload,decision}'='link'
 and exists(select 1 from clinical.migration_batches b join clinical.migration_items i on i.batch_id=b.id where b.id=p_batch and b.owner_id=auth.uid() and i.source_key=p_data->>'sourceKey' and i.status<>'imported')
 and nullif(p_data#>>'{payload,birthDate}','') is not null then
  begin requested_birth:=(p_data#>>'{payload,birthDate}')::date;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'MIGRATION_CLIENT_DATE_INVALID' using errcode='22023';end;
  if exists(select 1 from clinical.patients where id=nullif(p_data#>>'{payload,patientId}','')::uuid and birth_date is not null and birth_date<>requested_birth) then
   raise exception 'MIGRATION_BIRTH_DATE_MISMATCH' using errcode='22023';
  end if;
 end if;
 return public.clinical_migration_command_960_base(p_action,p_batch,p_data);
exception when serialization_failure then
 -- Fixed business conflicts are not retryable serialization failures.
 if sqlerrm in('PATIENT_CHANGED','MIGRATION_CONFLICT','OPERATIONAL_ASSOCIATION_CHANGED','CASE_CHANGED','MIGRATION_SETTINGS_CHANGED','SUPERVISION_ACCESS_CHANGED','MIGRATION_IDENTITY_CONFLICT') then
  raise exception '%',sqlerrm using errcode='PT409';
 end if;
 raise;
end $$;
revoke all on function public.clinical_migration_command(text,uuid,jsonb) from public,anon,service_role;
grant execute on function public.clinical_migration_command(text,uuid,jsonb) to authenticated;

-- Durable processed-client receipts remain available when a report is hidden.
-- Metadata only; no import, identity update or new membership is performed.
alter function public.clinical_migration_query(uuid) rename to clinical_migration_query_960_base;
revoke all on function public.clinical_migration_query_960_base(uuid) from public,anon,authenticated,service_role;
create function public.clinical_migration_query(p_batch uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $query$
declare q jsonb;begin
 q:=public.clinical_migration_query_960_base(p_batch);
 if p_batch is not null then return q;end if;
 return q||jsonb_build_object('processed',(select coalesce(jsonb_agg(jsonb_build_object(
  'documentHashes',(select coalesce(jsonb_agg(document->'sha256'),'[]'::jsonb) from jsonb_array_elements(i.payload->'documents') document),
  'sourceKey',i.source_key,'patientId',i.result->>'patientId','caseId',i.result->>'caseId',
  'professionalId',i.payload->>'professionalId','service',i.payload->>'service',
  'firstName',p.first_name,'lastName',p.last_name,'birthDate',p.birth_date) order by b.created_at desc,i.source_key),'[]'::jsonb)
  from clinical.migration_items i join clinical.migration_batches b on b.id=i.batch_id
  join clinical.patients p on p.id=(i.result->>'patientId')::uuid
  join clinical.care_cases c on c.id=(i.result->>'caseId')::uuid
  join clinical.service_episodes e on e.id=c.episode_id and e.patient_id=p.id
  where b.owner_id=auth.uid() and i.status='imported'));
end $query$;
revoke all on function public.clinical_migration_query(uuid) from public,anon,service_role;
grant execute on function public.clinical_migration_query(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
