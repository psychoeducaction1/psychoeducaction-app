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
notify pgrst,'reload schema';
commit;
