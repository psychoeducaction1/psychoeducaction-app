-- Rend la confirmation du service et le transfert vers la liste d'attente atomiques.
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
  perform pg_advisory_xact_lock(84203);
  select * into prospect from public.public_intake_prospects
  where id = p_prospect_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROSPECT_NOT_FOUND';
  end if;
  if prospect.waiting_list_client_id is not null then
    return jsonb_build_object(
      'success', true,
      'waitingListClientId', prospect.waiting_list_client_id,
      'reused', true
    );
  end if;
  if p_priority_level not in ('normal', 'urgent', 'existing_or_transfer') then
    raise exception using errcode = 'P0001', message = 'INVALID_PRIORITY';
  end if;

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
