-- A revoir et installer manuellement APRES les scripts d'admission et de transfert.
-- Ne supprime aucune donnee existante. Appels internes: aucun envoi de courriel.
begin;

create or replace function public.record_prospect_call_outcome(
  p_prospect_id uuid, p_actor_id uuid, p_status text, p_outcome_reason text,
  p_current_appointment_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  prospect public.public_intake_prospects%rowtype;
  appointment public.intake_appointments%rowtype;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'direction') then
    raise exception 'DIRECTION_REQUIRED';
  end if;
  -- Meme ordre que nettoyage, reservation et transfert: calendrier, transfert, fiche.
  perform pg_advisory_xact_lock(84201);
  perform pg_advisory_xact_lock(84203);
  select * into prospect from public.public_intake_prospects where id = p_prospect_id for update;
  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;
  if prospect.waiting_list_client_id is not null or prospect.status = 'transferred_to_waiting_list' then
    raise exception 'PROSPECT_ALREADY_TRANSFERRED';
  end if;
  if p_status not in ('other', 'service_not_taken') or p_status is null
    or nullif(trim(p_outcome_reason), '') is null then raise exception 'INVALID_OUTCOME'; end if;

  if p_current_appointment_id is not null then
    select * into appointment from public.intake_appointments where id = p_current_appointment_id for update;
    if not found or appointment.prospect_id <> p_prospect_id or appointment.status not in ('scheduled', 'completed') then
      raise exception 'APPOINTMENT_MISMATCH';
    end if;
    if appointment.status = 'scheduled' then
      update public.intake_appointments set status = 'completed', updated_at = now() where id = appointment.id;
      insert into public.intake_appointment_events (appointment_id, event_type, actor_profile_id, metadata)
      values (appointment.id, 'completed', p_actor_id, jsonb_build_object('outcome', p_status));
    end if;
  end if;
  update public.public_intake_prospects set status = p_status,
    outcome_reason = left(trim(p_outcome_reason), 1000), updated_at = now() where id = p_prospect_id;
  update public.administrative_tasks set status = 'completed', completed_at = now()
    where source_type = 'public_intake_rapid_callback' and source_id = p_prospect_id and status in ('pending', 'in_progress');
  insert into public.audit_logs (actor_profile_id, actor_role, action, entity_type, entity_id, description, metadata)
  values (p_actor_id, 'direction', 'public_intake_prospect_status_updated', 'public_intake_prospect',
    p_prospect_id, 'Resultat de l appel enregistre.', jsonb_build_object('previous_status', prospect.status, 'new_status', p_status, 'has_outcome_reason', true));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.create_prospect_followup_appointment(
  p_prospect_id uuid, p_actor_id uuid, p_outcome_reason text, p_current_appointment_id uuid,
  p_start_at timestamptz, p_end_at timestamptz, p_buffer_end_at timestamptz, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  prospect public.public_intake_prospects%rowtype;
  previous public.intake_appointments%rowtype;
  existing public.public_intake_requests%rowtype;
  new_appointment_id uuid;
  response jsonb;
  local_start timestamp;
  day_number integer;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'direction') then
    raise exception 'DIRECTION_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(84201);
  perform pg_advisory_xact_lock(84203);
  select * into prospect from public.public_intake_prospects where id = p_prospect_id for update;
  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;
  if prospect.waiting_list_client_id is not null or prospect.status = 'transferred_to_waiting_list' then
    raise exception 'PROSPECT_ALREADY_TRANSFERRED';
  end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  select * into existing from public.public_intake_requests
    where idempotency_key = 'direction-followup/' || p_idempotency_key::text;
  if found then
    if existing.prospect_id <> p_prospect_id then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return existing.response_payload || jsonb_build_object('reused', true);
  end if;
  if nullif(trim(p_outcome_reason), '') is null then raise exception 'INVALID_OUTCOME'; end if;
  local_start := p_start_at at time zone 'America/Toronto';
  day_number := extract(isodow from local_start);
  if p_start_at is null or p_end_at is null or p_buffer_end_at is null
    or p_start_at < now() + interval '2 hours'
    or p_end_at <> p_start_at + interval '15 minutes'
    or p_buffer_end_at <> p_start_at + interval '30 minutes'
    or extract(minute from local_start) not in (0, 30) or extract(second from local_start) <> 0
    or day_number = 7
    or (day_number between 1 and 5 and (local_start::time < time '08:00' or local_start::time > time '18:00'))
    or (day_number = 6 and (local_start::time < time '12:00' or local_start::time > time '15:30')) then
    raise exception 'INVALID_RANGE';
  end if;
  if p_current_appointment_id is not null then
    select * into previous from public.intake_appointments where id = p_current_appointment_id for update;
    if not found or previous.prospect_id <> p_prospect_id or previous.status not in ('scheduled', 'completed') then
      raise exception 'APPOINTMENT_MISMATCH';
    end if;
  end if;
  if exists (select 1 from public.intake_appointments where status = 'scheduled'
      and (p_current_appointment_id is null or id <> p_current_appointment_id)
      and start_at < p_buffer_end_at and p_start_at < buffer_end_at)
    or exists (select 1 from public.intake_calendar_blocks where start_at < p_buffer_end_at and p_start_at < end_at)
    or exists (select 1 from public.intake_slot_holds where expires_at > now()
      and start_at < p_buffer_end_at and p_start_at < buffer_end_at) then raise exception 'SLOT_UNAVAILABLE'; end if;

  -- Resultat Autre + cloture de l'appel courant + nouveau rendez-vous dans la meme transaction.
  perform public.record_prospect_call_outcome(p_prospect_id, p_actor_id, 'other', p_outcome_reason, p_current_appointment_id);
  insert into public.intake_appointments (prospect_id, start_at, end_at, buffer_end_at, status, source)
  values (p_prospect_id, p_start_at, p_end_at, p_buffer_end_at, 'scheduled', 'direction_followup')
  returning id into new_appointment_id;
  insert into public.intake_appointment_events (appointment_id, event_type, new_start_at, actor_profile_id)
  values (new_appointment_id, 'scheduled', p_start_at, p_actor_id);
  update public.public_intake_prospects set status = 'scheduled', updated_at = now() where id = p_prospect_id;
  response := jsonb_build_object('success', true, 'appointmentId', new_appointment_id);
  insert into public.public_intake_requests (idempotency_key, request_type, prospect_id, appointment_id, response_payload)
  values ('direction-followup/' || p_idempotency_key::text, 'scheduled_call', p_prospect_id, new_appointment_id, response);
  insert into public.audit_logs (actor_profile_id, actor_role, action, entity_type, entity_id, description, metadata)
  values (p_actor_id, 'direction', 'intake_followup_appointment_created', 'intake_appointment', new_appointment_id,
    'Nouveau rendez-vous cree sur la fiche existante.', jsonb_build_object('prospect_id', p_prospect_id));
  return response;
end;
$$;

revoke all on function public.record_prospect_call_outcome(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.create_prospect_followup_appointment(uuid, uuid, text, uuid, timestamptz, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.record_prospect_call_outcome(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.create_prospect_followup_appointment(uuid, uuid, text, uuid, timestamptz, timestamptz, timestamptz, uuid) to service_role;
notify pgrst, 'reload schema';
commit;
