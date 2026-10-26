-- Consultation limitée : aucun rôle direction ni droit d'écriture supplémentaire.
-- Appliquer après clinical-coordination-workspace.sql, avec autorisation de production.
begin;
create function public.read_clinical_overview(requested_view text)
returns jsonb language plpgsql stable security definer set search_path='' set row_security=off as $$
declare result jsonb; professionals jsonb;
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid()
    and p.platform_access_enabled is distinct from false
    and (p.role='direction' or (p.role='professionnel' and exists(
      select 1 from public.clinical_coordination_staff s where s.profile_id=p.id and s.is_active))))
    then raise exception using errcode='42501',message='Accès refusé'; end if;
  if requested_view is null or requested_view not in ('dashboard','waiting-list','preferences')
    then raise exception using errcode='22023',message='Vue invalide'; end if;

  if requested_view='waiting-list' then
    -- Liste courante uniquement, sans coordonnées, notes internes ou historique.
    select jsonb_build_object('waitingList',coalesce(jsonb_agg(jsonb_build_object(
      'id',w.id,'created_at',w.created_at,'contact_date',w.contact_date,
      'client_name',w.client_name,'birth_date',w.birth_date,'priority_level',w.priority_level,
      'service_requested',w.service_requested,'city',w.city,'meeting_modality',w.meeting_modality,
      'availability',w.availability,'consultation_reason',w.consultation_reason
    ) order by w.created_at), '[]'::jsonb)) into result
    from public.waiting_list_clients w where w.status='waiting' and not exists(
      select 1 from public.assignment_processes a where a.waiting_list_client_id=w.id and a.status not in ('assigned','classified','returned')
    );
    return result;
  end if;

  if requested_view='preferences' then
    select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,
      'professional_title',p.professional_title,'pref_languages',p.pref_languages,
      'pref_age_ranges',p.pref_age_ranges,'pref_client_groups',p.pref_client_groups,
      'pref_service_types',p.pref_service_types,'pref_office_locations',p.pref_office_locations,
      'pref_meeting_modes',p.pref_meeting_modes,'pref_motifs',p.pref_motifs,
      'pref_exclusions',p.pref_exclusions,'pref_matching_notes',p.pref_matching_notes
    ) order by p.full_name),'[]'::jsonb) into professionals
    from public.profiles p where p.role='professionnel' and p.is_active is true;
    return jsonb_build_object('professionals',professionals);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name)
    order by p.full_name),'[]'::jsonb) into professionals
    from public.profiles p where p.role='professionnel' and p.is_active is true;
  select jsonb_build_object('professionals',professionals,
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,
      'professional_id',r.professional_id,'is_active',r.is_active,'requested_count',r.requested_count,
      'request_comment',r.request_comment,'created_at',r.created_at,
      'accepted_count',(select count(*) from public.assigned_clients a where a.assignment_request_id=r.id and a.canceled_at is null and a.is_active is true),
      'occupied_count',(select count(*) from public.assigned_clients a where a.assignment_request_id=r.id and a.canceled_at is null and a.is_active is distinct from false)
    ) order by r.created_at desc) from public.assignment_requests r join public.profiles p on p.id=r.professional_id where p.role='professionnel' and p.is_active is true),'[]'::jsonb),
    'assignmentStats',coalesce((select jsonb_agg(to_jsonb(s)) from (
      select a.professional_id,count(*) filter(where a.is_active is true) as active_count,
        count(*) filter(where a.is_active is null) as pending_count,
        count(*) filter(where a.is_active is false) as refused_count
      from public.assigned_clients a join public.profiles p on p.id=a.professional_id
      where a.canceled_at is null and p.role='professionnel' and p.is_active is true group by a.professional_id
    ) s),'[]'::jsonb),
    'waitingStats',(select jsonb_build_object('waiting',count(*),'urgent',count(*) filter(where w.priority_level in ('urgent','existing_or_transfer')))
      from public.waiting_list_clients w where w.status='waiting')
  ) into result;
  return result;
end;
$$;
revoke all on function public.read_clinical_overview(text) from public,anon;
grant execute on function public.read_clinical_overview(text) to authenticated;
commit;
