-- Les pages direction et coordination partagent la présentation; seul ce
-- contrat SELECT ajoute la visibilité nécessaire. Aucun droit d'écriture ajouté.
begin;
create function public.read_clinical_direction_pages(requested_view text)
returns jsonb language plpgsql stable security definer set search_path='' set row_security=off as $$
declare professionals jsonb;
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid()
    and p.platform_access_enabled is distinct from false
    and (p.role='direction' or (p.role='professionnel' and exists(
      select 1 from public.clinical_coordination_staff s where s.profile_id=p.id and s.is_active))))
    then raise exception using errcode='42501',message='Accès refusé'; end if;
  if requested_view='direction-dashboard' then
    return jsonb_build_object(
      'professionals',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'email',p.email) order by p.full_name) from public.profiles p where p.role='professionnel' and p.is_active is true),'[]'::jsonb),
      'waitingList',coalesce((select jsonb_agg(jsonb_build_object('status',w.status,'priority_level',w.priority_level)) from public.waiting_list_clients w),'[]'::jsonb),
      'assignedClients',coalesce((select jsonb_agg(jsonb_build_object('professional_id',a.professional_id,'assignment_request_id',a.assignment_request_id,'is_active',a.is_active)) from public.assigned_clients a join public.profiles p on p.id=a.professional_id where p.role='professionnel' and p.is_active is true and a.canceled_at is null),'[]'::jsonb),
      'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'professional_id',r.professional_id,'is_active',r.is_active,'requested_count',r.requested_count,'assigned_count',r.assigned_count,'remaining_count',r.remaining_count,'request_comment',r.request_comment,'created_at',r.created_at) order by r.created_at desc) from public.assignment_requests r join public.profiles p on p.id=r.professional_id where p.role='professionnel' and p.is_active is true),'[]'::jsonb)
    );
  elsif requested_view='direction-waiting-list' then
    professionals:=public.read_clinical_overview('preferences')->'professionals';
    return jsonb_build_object('professionals',professionals,
      'processes',coalesce((select jsonb_agg(jsonb_build_object('waiting_list_client_id',a.waiting_list_client_id,'status',a.status)) from public.assignment_processes a),'[]'::jsonb),
      'clients',coalesce((select jsonb_agg(jsonb_build_object(
        'id',w.id,'created_at',w.created_at,'contact_date',w.contact_date,'status',w.status,
        'priority_level',w.priority_level,'service_requested',w.service_requested,'client_name',w.client_name,
        'first_requester_name',w.first_requester_name,'second_requester_name',w.second_requester_name,
        'birth_date',w.birth_date,'city',w.city,'meeting_modality',w.meeting_modality,'meeting_type',w.meeting_type,
        'availability',w.availability,'contact_email',w.contact_email,'contact_phone',w.contact_phone,
        'contact_emails',w.contact_emails,'contact_phones',w.contact_phones,'consultation_reason',w.consultation_reason,
        'internal_notes',w.internal_notes,'assigned_professional_id',w.assigned_professional_id,'assigned_at',w.assigned_at
      ) order by w.contact_date,w.created_at) from public.waiting_list_clients w),'[]'::jsonb)
    );
  else raise exception using errcode='22023',message='Vue invalide'; end if;
end;
$$;
revoke all on function public.read_clinical_direction_pages(text) from public,anon;
grant execute on function public.read_clinical_direction_pages(text) to authenticated;
commit;
