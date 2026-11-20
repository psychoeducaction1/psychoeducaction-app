-- Share successful destination receipts between existing authorized migration
-- operators. Batch ownership, imports, document access and memberships stay intact.
begin;
create or replace function public.clinical_migration_query(p_batch uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $query$
declare q jsonb;begin
 perform clinical.migration_assert();
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
  where i.status='imported' and clinical.unified_patient_readable(p.id,'administration')));
end $query$;
-- No new grantee or ability to edit a different operator's batch.
revoke all on function public.clinical_migration_query(uuid) from public,anon,service_role;
grant execute on function public.clinical_migration_query(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
