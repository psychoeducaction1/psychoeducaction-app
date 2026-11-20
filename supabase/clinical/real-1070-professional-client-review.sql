-- Administrative preview only. No assignment, care grant or dossier is edited.
begin;
create function public.clinical_professional_import_receipts(p_professional uuid) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=off as $$
begin
  perform clinical.unified_context('administration');
  if not clinical.active_actor() or not clinical.can_administer()
    or not clinical.unified_professional_access('administration',p_professional) then
    raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';
  end if;
  return jsonb_build_object('patientIds',(
    select coalesce(jsonb_agg(receipt.patient_id order by receipt.patient_id),'[]')
    from (
      select distinct e.patient_id
      from clinical.migration_items i
      join clinical.care_cases c on c.id::text=i.result->>'caseId'
      join clinical.service_episodes e on e.id=c.episode_id and e.patient_id::text=i.result->>'patientId'
      where i.status='imported' and i.payload->>'professionalId'=p_professional::text
    ) receipt
  ));
end $$;
revoke all on function public.clinical_professional_import_receipts(uuid) from public,anon,service_role;
grant execute on function public.clinical_professional_import_receipts(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
