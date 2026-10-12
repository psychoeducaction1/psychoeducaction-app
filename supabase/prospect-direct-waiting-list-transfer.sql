-- Rend la confirmation du service et le transfert vers la liste d'attente atomiques.
-- Version corrigee: a appliquer manuellement avec autorisation apres le schema d'admission.
-- Les anciens appels incoherents sont compatibles a la lecture; aucun backfill global ici.
begin;

create or replace function public.transfer_prospect_to_waiting_list(
  p_prospect_id uuid,
  p_priority_level text,
  p_actor_id uuid,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prospect public.public_intake_prospects%rowtype;
  client_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'direction') then
    raise exception 'DIRECTION_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(84201);
  perform pg_advisory_xact_lock(84203);
  select * into prospect from public.public_intake_prospects
  where id = p_prospect_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROSPECT_NOT_FOUND';
  end if;
  if prospect.waiting_list_client_id is not null then
    with completed as (
      update public.intake_appointments
      set status = 'completed', updated_at = now()
      where prospect_id = p_prospect_id and status = 'scheduled' and end_at <= now()
      returning id
    )
    insert into public.intake_appointment_events
      (appointment_id, event_type, actor_profile_id, actor_name, metadata)
    select id, 'completed', p_actor_id, p_actor_name,
      jsonb_build_object('outcome', 'service_taken', 'source', 'waiting_list_transfer')
    from completed;
    return jsonb_build_object(
      'success', true,
      'waitingListClientId', prospect.waiting_list_client_id,
      'reused', true
    );
  end if;
  if p_priority_level not in ('normal', 'urgent', 'existing_or_transfer') then
    raise exception using errcode = 'P0001', message = 'INVALID_PRIORITY';
  end if;

  if exists (
    select 1 from public.waiting_list_clients as client
    where regexp_replace(lower(client.client_name), '[^[:alnum:]]', '', 'g')
      = regexp_replace(lower(concat_ws(' ', prospect.first_name, prospect.last_name)), '[^[:alnum:]]', '', 'g')
      and (client.birth_date is null or prospect.birth_date is null or client.birth_date = prospect.birth_date)
      and (client.service_requested is null or client.service_requested = 'Psychoéducation')
      and (
        lower(trim(client.contact_email)) = lower(trim(prospect.email))
        or lower(trim(prospect.email)) = any(
          select lower(trim(item)) from unnest(coalesce(client.contact_emails, array[]::text[])) as item
        )
        or exists (
          select 1 from unnest(array[client.contact_phone] || coalesce(client.contact_phones, array[]::text[])) as item
          where regexp_replace(item, '[^0-9]', '', 'g') in
            (prospect.normalized_phone, '1' || prospect.normalized_phone)
        )
      )
  ) then raise exception 'EXISTING_WAITING_LIST_CLIENT'; end if;

  insert into public.waiting_list_clients (
    status, priority_level, contact_date, service_requested, client_name,
    first_requester_name, second_requester_name, birth_date, city,
    meeting_modality, contact_email, contact_phone, contact_emails,
    contact_phones, consultation_reason, internal_notes
  ) values (
    'waiting', p_priority_level, current_date, 'Psychoéducation',
    concat_ws(' ', prospect.first_name, prospect.last_name),
    nullif(prospect.requester_names[1], ''),
    nullif(prospect.requester_names[2], ''),
    prospect.birth_date,
    nullif(concat_ws(', ', prospect.service_address, prospect.service_city, prospect.service_postal_code), ''),
    prospect.modalities,
    prospect.email, prospect.phone, array[prospect.email], array[prospect.phone],
    prospect.consultation_reason,
    null
  ) returning id into client_id;

  update public.public_intake_prospects
  set status = 'transferred_to_waiting_list',
      waiting_list_client_id = client_id,
      updated_at = now()
  where id = p_prospect_id;

  with completed as (
    update public.intake_appointments
    set status = 'completed', updated_at = now()
    where prospect_id = p_prospect_id and status = 'scheduled' and end_at <= now()
    returning id
  )
  insert into public.intake_appointment_events
    (appointment_id, event_type, actor_profile_id, actor_name, metadata)
  select id, 'completed', p_actor_id, p_actor_name,
    jsonb_build_object('outcome', 'service_taken', 'source', 'waiting_list_transfer')
  from completed;

  insert into public.audit_logs (
    actor_profile_id, actor_name, actor_role, action, entity_type,
    entity_id, description, metadata
  ) values (
    p_actor_id, p_actor_name, 'direction',
    'public_intake_prospect_transferred_to_waiting_list',
    'public_intake_prospect', p_prospect_id,
    'Prospect transféré volontairement vers la liste d’attente.',
    jsonb_build_object(
      'waiting_list_client_id', client_id,
      'priority_level', p_priority_level
    )
  );

  return jsonb_build_object(
    'success', true,
    'waitingListClientId', client_id
  );
end;
$$;

revoke all on function public.transfer_prospect_to_waiting_list(uuid, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.transfer_prospect_to_waiting_list(uuid, text, uuid, text)
to service_role;

notify pgrst, 'reload schema';

commit;
