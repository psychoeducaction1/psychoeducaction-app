begin;

alter table public.intake_appointments
add column if not exists conversion_event_id uuid;

alter table public.intake_appointments
alter column conversion_event_id set default gen_random_uuid();

update public.intake_appointments
set conversion_event_id = gen_random_uuid()
where conversion_event_id is null;

alter table public.intake_appointments
alter column conversion_event_id set not null;

create unique index if not exists intake_appointments_conversion_event_id_idx
on public.intake_appointments(conversion_event_id);

create or replace function public.confirm_public_intake_booking(
  p_payload jsonb,
  p_start_at timestamptz,
  p_hold_token_hash text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_response jsonb;
  held public.intake_slot_holds%rowtype;
  duplicate_prospect_id uuid;
  duplicate_waiting_id uuid;
  prospect_id uuid;
  appointment_id uuid;
  appointment_conversion_event_id uuid;
  response_payload jsonb;
begin
  perform pg_advisory_xact_lock(84201);

  select intake_request.response_payload, intake_request.appointment_id
  into existing_response, appointment_id
  from public.public_intake_requests as intake_request
  where intake_request.idempotency_key = p_idempotency_key;
  if found then
    select appointment.conversion_event_id
    into appointment_conversion_event_id
    from public.intake_appointments as appointment
    where appointment.id = appointment_id;

    existing_response := existing_response || jsonb_build_object(
      'conversionEventId', appointment_conversion_event_id
    );

    update public.public_intake_requests as intake_request
    set response_payload = existing_response
    where intake_request.idempotency_key = p_idempotency_key;

    return existing_response || jsonb_build_object('reused', true);
  end if;

  delete from public.intake_slot_holds where expires_at <= now();
  select * into held from public.intake_slot_holds
  where start_at = p_start_at
    and token_hash = p_hold_token_hash
    and expires_at > now()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'HOLD_INVALID_OR_EXPIRED';
  end if;

  if exists (
    select 1 from public.intake_appointments
    where status = 'scheduled' and start_at = p_start_at
  ) or exists (
    select 1 from public.intake_calendar_blocks
    where start_at < held.buffer_end_at and held.start_at < end_at
  ) then
    raise exception using errcode = 'P0001', message = 'SLOT_UNAVAILABLE';
  end if;

  select id into duplicate_prospect_id
  from public.public_intake_prospects
  where normalized_email = lower(p_payload->>'email')
     or normalized_phone = p_payload->>'normalizedPhone'
  order by created_at desc limit 1;

  select id into duplicate_waiting_id
  from public.waiting_list_clients
  where (
    lower(coalesce(contact_email, '')) = lower(p_payload->>'email')
    or regexp_replace(coalesce(contact_phone, ''), '\D', '', 'g')
      = p_payload->>'normalizedPhone'
  )
  order by created_at desc limit 1;

  insert into public.public_intake_prospects (
    status, first_name, last_name, birth_date, phone, email,
    normalized_phone, normalized_email, request_type, requester_names,
    modalities, service_address, service_city, service_postal_code,
    consultation_reason, contact_request_type, source, utm,
    potential_duplicate, potential_duplicate_prospect_id,
    potential_duplicate_waiting_list_client_id
  ) values (
    'scheduled', p_payload->>'firstName', p_payload->>'lastName',
    nullif(p_payload->>'birthDate', '')::date,
    p_payload->>'phone', p_payload->>'email',
    p_payload->>'normalizedPhone', lower(p_payload->>'email'),
    p_payload->>'requestType',
    array(select jsonb_array_elements_text(p_payload->'requesterNames')),
    array(select jsonb_array_elements_text(p_payload->'modalityLabels')),
    nullif(p_payload->>'address', ''), nullif(p_payload->>'city', ''),
    nullif(p_payload->>'postalCode', ''),
    nullif(p_payload->>'consultationReason', ''),
    'scheduled_call',
    coalesce(nullif(p_payload->>'provenance', ''), 'Site web - rendez-vous téléphonique'),
    coalesce(p_payload->'utm', '{}'::jsonb),
    duplicate_prospect_id is not null or duplicate_waiting_id is not null,
    duplicate_prospect_id, duplicate_waiting_id
  ) returning id into prospect_id;

  insert into public.intake_appointments (
    prospect_id, start_at, end_at, buffer_end_at, source
  ) values (
    prospect_id, held.start_at, held.end_at, held.buffer_end_at,
    'public_website'
  ) returning id, conversion_event_id
  into appointment_id, appointment_conversion_event_id;

  insert into public.intake_appointment_events (
    appointment_id, event_type, new_start_at, metadata
  ) values (
    appointment_id, 'scheduled', held.start_at,
    jsonb_build_object('source', 'public_website')
  );

  insert into public.audit_logs (
    actor_name, actor_role, action, entity_type, entity_id,
    description, metadata
  ) values (
    'Site web', 'public', 'public_intake_appointment_created',
    'intake_appointment', appointment_id,
    'Rendez-vous téléphonique créé depuis le site web.',
    jsonb_build_object(
      'prospect_id', prospect_id,
      'appointment_id', appointment_id,
      'start_at', held.start_at,
      'potential_duplicate', duplicate_prospect_id is not null or duplicate_waiting_id is not null
    )
  );

  response_payload := jsonb_build_object(
    'success', true,
    'appointmentId', appointment_id,
    'conversionEventId', appointment_conversion_event_id,
    'prospectId', prospect_id,
    'startAt', held.start_at,
    'endAt', held.end_at,
    'potentialDuplicate', duplicate_prospect_id is not null or duplicate_waiting_id is not null
  );

  insert into public.public_intake_requests (
    idempotency_key, request_type, prospect_id,
    appointment_id, response_payload
  ) values (
    p_idempotency_key, 'scheduled_call', prospect_id,
    appointment_id, response_payload
  );

  delete from public.intake_slot_holds where id = held.id;
  return response_payload;
end;
$$;

update public.public_intake_requests as intake_request
set response_payload = intake_request.response_payload || jsonb_build_object(
  'conversionEventId', appointment.conversion_event_id
)
from public.intake_appointments as appointment
where appointment.id = intake_request.appointment_id
  and intake_request.response_payload->>'conversionEventId' is distinct from appointment.conversion_event_id::text;

commit;

select
  count(*) as appointment_count,
  count(*) filter (where conversion_event_id is null) as null_conversion_event_ids,
  count(distinct conversion_event_id) as unique_conversion_event_ids
from public.intake_appointments;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'intake_appointments'
  and indexname = 'intake_appointments_conversion_event_id_idx';
