-- PREPARATION LOCALE UNIQUEMENT. Ne pas appliquer sans validation du catalogue reel
-- et autorisation explicite. Necessite les tables initiales (DDL absent du depot),
-- rls-assignment-security.sql, assignment-processes.sql et les champs d'annulation
-- existants. Aucun backfill. Ne pas reinstaller les anciens scripts apres celui-ci.
begin;

do $$
declare missing text;
begin
  select string_agg(expected.table_name || '.' || expected.column_name, ', ')
  into missing
  from (values
    ('profiles','id'), ('profiles','role'), ('profiles','full_name'), ('profiles','email'),
    ('profiles','is_active'), ('profiles','platform_access_enabled'),
    ('waiting_list_clients','id'), ('waiting_list_clients','status'),
    ('waiting_list_clients','client_name'), ('waiting_list_clients','first_requester_name'),
    ('waiting_list_clients','second_requester_name'), ('waiting_list_clients','contact_email'),
    ('waiting_list_clients','contact_emails'), ('waiting_list_clients','contact_phone'),
    ('waiting_list_clients','contact_phones'), ('waiting_list_clients','consultation_reason'),
    ('waiting_list_clients','meeting_modality'), ('waiting_list_clients','city'),
    ('waiting_list_clients','assigned_professional_id'), ('waiting_list_clients','assigned_at'),
    ('assignment_requests','id'), ('assignment_requests','professional_id'),
    ('assignment_requests','is_active'), ('assignment_requests','requested_count'),
    ('assignment_requests','assigned_count'), ('assignment_requests','remaining_count'),
    ('assignment_requests','created_at'),
    ('assigned_clients','id'), ('assigned_clients','professional_id'),
    ('assigned_clients','waiting_list_client_id'), ('assigned_clients','assignment_request_id'),
    ('assigned_clients','first_name'), ('assigned_clients','last_name'),
    ('assigned_clients','email'), ('assigned_clients','phone'), ('assigned_clients','requester_name'),
    ('assigned_clients','short_comment'), ('assigned_clients','meeting_modality'),
    ('assigned_clients','service_address'), ('assigned_clients','assigned_date'),
    ('assigned_clients','contacted'), ('assigned_clients','is_active'),
    ('assigned_clients','dossier_closed'), ('assigned_clients','closure_reason'),
    ('assigned_clients','meeting_count'), ('assigned_clients','canceled_at'),
    ('assignment_processes','id'), ('assignment_processes','waiting_list_client_id'),
    ('assignment_processes','status'), ('assignment_processes','prospective_professional_id'),
    ('assignment_processes','assigned_at'),
    ('assignment_process_events','assignment_process_id'), ('assignment_process_events','event_type'),
    ('assignment_process_events','status'), ('assignment_process_events','actor_profile_id'),
    ('assignment_process_events','actor_name'), ('assignment_process_events','metadata'),
    ('administrative_tasks','source_type'), ('administrative_tasks','source_id'),
    ('administrative_tasks','status'), ('administrative_tasks','completed_at'),
    ('audit_logs','actor_profile_id'), ('audit_logs','actor_name'), ('audit_logs','actor_role'),
    ('audit_logs','action'), ('audit_logs','entity_type'), ('audit_logs','entity_id'),
    ('audit_logs','description'), ('audit_logs','metadata')
  ) as expected(table_name,column_name)
  where not exists (
    select 1 from information_schema.columns as actual
    where actual.table_schema = 'public' and actual.table_name = expected.table_name
      and actual.column_name = expected.column_name
  );
  if missing is not null then raise exception 'ASSIGNMENT_BASELINE_REQUIRED: %', missing; end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name in
      ('profiles','waiting_list_clients','assignment_requests','assigned_clients','assignment_processes')
      and column_name = 'id' and udt_name <> 'uuid'
  ) then raise exception 'ASSIGNMENT_BASELINE_UUID_REQUIRED'; end if;
end;
$$;

-- Recu technique sans nom, motif ni coordonnees. Conserve la cle utilisee si
-- l'assignation est supprimee pour qu'un ancien retry ne puisse la recreer.
create table if not exists public.waiting_list_assignment_receipts (
  idempotency_key uuid primary key,
  actor_profile_id uuid not null,
  waiting_list_client_id uuid not null,
  professional_id uuid not null,
  assignment_process_id uuid null,
  outcome text not null check (outcome in ('pending', 'service_taken')),
  assigned_client_id uuid null references public.assigned_clients(id) on delete set null,
  assignment_request_id uuid null references public.assignment_requests(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.waiting_list_assignment_receipts enable row level security;
revoke all on public.waiting_list_assignment_receipts from public, anon, authenticated;
grant select, insert on public.waiting_list_assignment_receipts to service_role;

create or replace function public.create_waiting_list_assignment(
  p_waiting_list_client_id uuid, p_professional_id uuid, p_outcome text,
  p_idempotency_key uuid, p_assignment_process_id uuid, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  professional public.profiles%rowtype;
  source public.waiting_list_clients%rowtype;
  request_row public.assignment_requests%rowtype;
  process public.assignment_processes%rowtype;
  receipt public.waiting_list_assignment_receipts%rowtype;
  assignment_id uuid;
  v_assigned_at timestamptz := now();
  accepted integer;
  occupied integer;
  chosen boolean := false;
  reused boolean := false;
  names text[];
  requester text;
  modalities text;
  contact_email text;
  contact_phone text;
begin
  select * into actor from public.profiles where id = p_actor_id for share;
  if not found or actor.role is distinct from 'direction' then raise exception 'DIRECTION_REQUIRED'; end if;
  -- is_active archive une fiche et n'est pas un mecanisme de connexion.
  if actor.platform_access_enabled is false then raise exception 'PLATFORM_ACCESS_DISABLED'; end if;
  if p_idempotency_key is null or p_outcome is null or p_outcome not in ('pending','service_taken') then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('waiting-assignment/' || p_idempotency_key::text, 0));
  select * into receipt from public.waiting_list_assignment_receipts where idempotency_key = p_idempotency_key;
  if found then
    if receipt.actor_profile_id <> p_actor_id or receipt.waiting_list_client_id <> p_waiting_list_client_id
      or receipt.professional_id <> p_professional_id or receipt.outcome <> p_outcome
      or receipt.assignment_process_id is distinct from p_assignment_process_id then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    if receipt.assigned_client_id is null or receipt.assignment_request_id is null then raise exception 'ASSIGNMENT_RETIRED'; end if;
    assignment_id := receipt.assigned_client_id;
    v_assigned_at := receipt.created_at;
    reused := true;
  end if;
  select * into source from public.waiting_list_clients where id = p_waiting_list_client_id for update;
  if not found then raise exception 'WAITING_CLIENT_NOT_FOUND'; end if;

  if reused then
    if not exists (select 1 from public.assigned_clients where id = assignment_id
      and waiting_list_client_id = p_waiting_list_client_id and professional_id = p_professional_id
      and canceled_at is null) then raise exception 'ASSIGNMENT_RETIRED'; end if;
    select * into request_row from public.assignment_requests where id = receipt.assignment_request_id for update;
    if not found then raise exception 'ASSIGNMENT_RETIRED'; end if;
  else
    -- Le meme verrou de source est utilise par les reclassements ci-dessous.
    if exists (select 1 from public.assigned_clients where waiting_list_client_id = source.id
      and canceled_at is null and is_active is distinct from false) then
      raise exception 'ACTIVE_ASSIGNMENT_EXISTS';
    end if;
    select * into professional from public.profiles where id = p_professional_id for share;
    if not found or professional.role is distinct from 'professionnel' or professional.is_active is false then
      raise exception 'PROFESSIONAL_UNAVAILABLE';
    end if;
    -- Un professionnel actif gere par la direction peut ne pas avoir d'acces plateforme.
    if p_assignment_process_id is null then
      if source.status is distinct from 'waiting' then raise exception 'WAITING_CLIENT_NOT_ASSIGNABLE'; end if;
      if exists (select 1 from public.assignment_processes where waiting_list_client_id = source.id
        and status not in ('assigned','classified','returned')) then raise exception 'ACTIVE_ASSIGNMENT_PROCESS'; end if;
    else
      select * into process from public.assignment_processes where id = p_assignment_process_id for update;
      if not found or process.waiting_list_client_id <> source.id
        or process.status in ('assigned','classified','returned')
        or process.prospective_professional_id is distinct from p_professional_id
        or source.status is distinct from 'assignment_in_progress'
        or p_outcome <> 'service_taken' then raise exception 'ASSIGNMENT_PROCESS_MISMATCH'; end if;
    end if;

    -- Verrou sur la demande, puis recompte depuis les assignations non annulees :
    -- deux sources visant la derniere place sont serialisees par ce verrou.
    for request_row in select * from public.assignment_requests
      where professional_id = p_professional_id and is_active is true and requested_count > 0
      order by created_at desc nulls last, id for update
    loop
      select count(*) filter (where is_active is true), count(*) filter (where is_active is distinct from false)
      into accepted, occupied from public.assigned_clients
      where assignment_request_id = request_row.id and canceled_at is null;
      if occupied < request_row.requested_count and accepted < request_row.requested_count then
        chosen := true;
        exit;
      end if;
    end loop;
    if not chosen then raise exception 'NO_ASSIGNMENT_CAPACITY'; end if;

    names := regexp_split_to_array(trim(coalesce(source.client_name,'')), '\s+');
    requester := nullif(concat_ws(' / ', nullif(trim(source.first_requester_name),''), nullif(trim(source.second_requester_name),'')), '');
    select nullif(trim(value),'') into contact_email
      from jsonb_array_elements_text(jsonb_build_array(source.contact_email) || coalesce(to_jsonb(source.contact_emails),'[]'::jsonb))
      with ordinality as contacts(value, position) where nullif(trim(value),'') is not null order by position limit 1;
    select nullif(trim(value),'') into contact_phone
      from jsonb_array_elements_text(jsonb_build_array(source.contact_phone) || coalesce(to_jsonb(source.contact_phones),'[]'::jsonb))
      with ordinality as contacts(value, position) where nullif(trim(value),'') is not null order by position limit 1;
    if jsonb_typeof(to_jsonb(source.meeting_modality)) = 'array' then
      select string_agg(value, ', ' order by position) into modalities
        from jsonb_array_elements_text(to_jsonb(source.meeting_modality)) with ordinality as modes(value,position);
    else modalities := nullif(trim(to_jsonb(source.meeting_modality) #>> '{}'),''); end if;
    insert into public.assigned_clients (
      assignment_request_id, waiting_list_client_id, professional_id,
      first_name, last_name, email, phone, requester_name, short_comment,
      meeting_modality, service_address, assigned_date, contacted, is_active,
      dossier_closed, closure_reason, meeting_count
    ) values (
      request_row.id, source.id, p_professional_id,
      coalesce(nullif(names[1],''),'Client'),
      coalesce(nullif(array_to_string(names[2:array_length(names,1)],' '),''),'-'),
      contact_email, contact_phone, requester, nullif(trim(source.consultation_reason),''),
      modalities, nullif(trim(source.city),''), (v_assigned_at at time zone 'America/Toronto')::date,
      p_outcome = 'service_taken', case when p_outcome = 'service_taken' then true else null end,
      false, null, 0
    ) returning id into assignment_id;
    update public.waiting_list_clients set status = 'assigned', assigned_professional_id = p_professional_id,
      assigned_at = v_assigned_at where id = source.id returning * into source;
    if p_assignment_process_id is not null then
      update public.assignment_processes set status = 'assigned', assigned_at = v_assigned_at where id = process.id;
      insert into public.assignment_process_events
        (assignment_process_id,event_type,status,actor_profile_id,actor_name,metadata)
      values (process.id,'assigned','assigned',actor.id,coalesce(actor.full_name,actor.email),
        jsonb_build_object('assigned_client_id',assignment_id));
      update public.administrative_tasks set status = 'completed', completed_at = now()
        where source_type = 'assignment_process_follow_up' and source_id = process.id
          and status in ('pending','in_progress');
    end if;
    insert into public.waiting_list_assignment_receipts
      (idempotency_key,actor_profile_id,waiting_list_client_id,professional_id,assignment_process_id,
       outcome,assigned_client_id,assignment_request_id,created_at)
    values (p_idempotency_key,actor.id,source.id,p_professional_id,p_assignment_process_id,
      p_outcome,assignment_id,request_row.id,v_assigned_at);
    insert into public.audit_logs
      (actor_profile_id,actor_name,actor_role,action,entity_type,entity_id,description,metadata)
    values (actor.id,coalesce(actor.full_name,actor.email),'direction','assignment_created','assigned_client',
      assignment_id,'Assignation creee avec verification transactionnelle de la capacite.',
      jsonb_build_object('waiting_list_client_id',source.id,'professional_id',p_professional_id,
        'assignment_request_id',request_row.id,'assignment_process_id',p_assignment_process_id,
        'outcome',p_outcome));
  end if;
  select count(*) filter (where is_active is true), count(*) filter (where is_active is distinct from false)
    into accepted, occupied from public.assigned_clients
    where assignment_request_id = request_row.id and canceled_at is null;
  if not reused then
    update public.assignment_requests set assigned_count = accepted,
      remaining_count = greatest(coalesce(requested_count,0) - occupied,0),
      is_active = is_active is true and accepted < coalesce(requested_count,0)
    where id = request_row.id returning * into request_row;
  end if;
  return jsonb_build_object('assignedClientId',assignment_id,'assignedAt',v_assigned_at,'reused',reused,
    'requesterName',nullif(concat_ws(' / ',nullif(trim(source.first_requester_name),''),nullif(trim(source.second_requester_name),'')),''),
    'updatedClient',to_jsonb(source),'assignmentRequest',to_jsonb(request_row) ||
      jsonb_build_object('assigned_count',accepted,'occupied_count',occupied,
        'remaining_count',greatest(coalesce(request_row.requested_count,0)-occupied,0)));
end;
$$;

create or replace function public.transition_unassigned_waiting_list_client(
  p_waiting_list_client_id uuid, p_action text, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare actor public.profiles%rowtype;
  source public.waiting_list_clients%rowtype;
  previous_status text;
  target_status text;
begin
  select * into actor from public.profiles where id = p_actor_id for share;
  if not found or actor.role is distinct from 'direction' then raise exception 'DIRECTION_REQUIRED'; end if;
  if actor.platform_access_enabled is false then raise exception 'PLATFORM_ACCESS_DISABLED'; end if;
  if p_action is null or p_action not in ('restore','mark_off_platform') then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  select * into source from public.waiting_list_clients where id = p_waiting_list_client_id for update;
  if not found then raise exception 'WAITING_CLIENT_NOT_FOUND'; end if;
  perform id from public.assigned_clients where waiting_list_client_id = source.id
    and canceled_at is null and is_active is distinct from false for update;
  if found then raise exception 'ACTIVE_ASSIGNMENT_EXISTS'; end if;
  if exists (select 1 from public.assignment_processes where waiting_list_client_id = source.id
    and status not in ('assigned','classified','returned')) then raise exception 'ACTIVE_ASSIGNMENT_PROCESS'; end if;
  target_status := case when p_action = 'restore' then 'waiting' else 'closed' end;
  if source.status = target_status then
    return jsonb_build_object('skipped',true,'reason',case when p_action = 'restore' then 'already_waiting' else 'already_closed' end,
      'message','Ce dossier est deja classe dans cette section.');
  end if;
  previous_status := source.status;
  update public.waiting_list_clients set status = target_status, assigned_professional_id = null, assigned_at = null
    where id = source.id;
  insert into public.audit_logs
    (actor_profile_id,actor_name,actor_role,action,entity_type,entity_id,description,metadata)
  values (actor.id,coalesce(actor.full_name,actor.email),'direction',
    case when p_action = 'restore' then 'waiting_list_client_restored' else 'waiting_list_client_marked_off_platform' end,
    'waiting_list_client',source.id,'Dossier sans assignation active reclasse par la direction.',
    jsonb_build_object('previous_waiting_list_status',previous_status,'new_waiting_list_status',target_status));
  return jsonb_build_object('success',true,'restoredToWaitingList',p_action='restore','markedOffPlatform',p_action='mark_off_platform');
end;
$$;

-- Le RPC historique contourne RLS via SECURITY DEFINER : sa branche proprietaire
-- doit donc verifier elle-meme la revocation de l'acces, meme si is_direction est durci.
create or replace function public.sync_waiting_list_status_for_assigned_client(
  assigned_client_id uuid, next_is_active boolean
) returns void
language plpgsql security definer set search_path = public
as $$
declare linked_id uuid; actual_status boolean;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles
    where id = auth.uid() and platform_access_enabled is distinct from false) then
    raise exception 'PLATFORM_ACCESS_DISABLED';
  end if;
  select ac.waiting_list_client_id, ac.is_active into linked_id, actual_status
    from public.assigned_clients ac where ac.id = assigned_client_id and ac.canceled_at is null
      and (public.is_direction() or ac.professional_id = auth.uid()) limit 1;
  if linked_id is null then return; end if;
  if actual_status is distinct from next_is_active then raise exception 'ASSIGNMENT_STATUS_CHANGED'; end if;
  perform id from public.waiting_list_clients where id = linked_id for update;
  if exists (select 1 from public.assigned_clients ac where ac.waiting_list_client_id = linked_id
    and ac.id <> assigned_client_id and ac.canceled_at is null and ac.is_active is distinct from false) then
    raise exception 'ACTIVE_ASSIGNMENT_EXISTS';
  end if;
  update public.waiting_list_clients set status = case
    when actual_status is true then 'active' when actual_status is false then 'closed' else 'assigned' end
    where id = linked_id;
end;
$$;
revoke all on function public.sync_waiting_list_status_for_assigned_client(uuid,boolean) from public, anon;
grant execute on function public.sync_waiting_list_status_for_assigned_client(uuid,boolean) to authenticated;

revoke all on function public.create_waiting_list_assignment(uuid,uuid,text,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.create_waiting_list_assignment(uuid,uuid,text,uuid,uuid,uuid) to service_role;
revoke all on function public.transition_unassigned_waiting_list_client(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.transition_unassigned_waiting_list_client(uuid,text,uuid) to service_role;

-- Une ancienne UI ou une requete PostgREST ne doit pas contourner le RPC.
-- Policy restrictive : reste efficace meme en presence d'une ancienne policy permissive.
alter table public.assigned_clients enable row level security;
drop policy if exists assigned_clients_transactional_insert_only on public.assigned_clients;
create policy assigned_clients_transactional_insert_only on public.assigned_clients
  as restrictive for insert to authenticated with check (false);

commit;
