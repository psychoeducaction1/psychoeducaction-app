-- Backend d'admission publique et calendrier des appels de 15 minutes.
-- À exécuter manuellement dans le SQL Editor de Supabase.

begin;

create table if not exists public.public_intake_prospects (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'new' check (
    status in (
      'new', 'scheduled', 'callback_requested', 'contacted',
      'service_taken', 'service_not_taken', 'other',
      'transferred_to_waiting_list'
    )
  ),
  first_name text not null,
  last_name text not null,
  birth_date date,
  phone text not null,
  email text not null,
  normalized_phone text not null,
  normalized_email text not null,
  request_type text not null,
  requester_names text[] not null default '{}',
  modalities text[] not null default '{}',
  service_address text,
  service_city text,
  service_postal_code text,
  consultation_reason text,
  contact_request_type text not null,
  rapid_callback_requested_at timestamptz,
  source text not null default 'Site web',
  utm jsonb not null default '{}'::jsonb,
  potential_duplicate boolean not null default false,
  potential_duplicate_prospect_id uuid
    references public.public_intake_prospects(id) on delete set null,
  potential_duplicate_waiting_list_client_id uuid
    references public.waiting_list_clients(id) on delete set null,
  outcome_reason text,
  waiting_list_client_id uuid
    references public.waiting_list_clients(id) on delete set null,
  notification_sent_at timestamptz,
  notification_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists public_intake_prospects_status_created_idx
on public.public_intake_prospects(status, created_at desc);

create index if not exists public_intake_prospects_normalized_email_idx
on public.public_intake_prospects(normalized_email);

create index if not exists public_intake_prospects_normalized_phone_idx
on public.public_intake_prospects(normalized_phone);

create table if not exists public.intake_appointments (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null
    references public.public_intake_prospects(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  buffer_end_at timestamptz not null,
  status text not null default 'scheduled' check (
    status in ('scheduled', 'completed', 'cancelled', 'no_show')
  ),
  source text not null default 'public_website',
  cancellation_reason text,
  confirmation_sent_at timestamptz,
  admin_notification_sent_at timestamptz,
  notification_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  check (buffer_end_at >= end_at)
);

create unique index if not exists intake_appointments_unique_scheduled_start_idx
on public.intake_appointments(start_at)
where status = 'scheduled';

create index if not exists intake_appointments_prospect_idx
on public.intake_appointments(prospect_id, start_at desc);

create table if not exists public.intake_slot_holds (
  id uuid primary key default gen_random_uuid(),
  start_at timestamptz not null,
  end_at timestamptz not null,
  buffer_end_at timestamptz not null,
  token_hash text not null unique,
  idempotency_key text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists intake_slot_holds_unique_start_idx
on public.intake_slot_holds(start_at);

create index if not exists intake_slot_holds_expiry_idx
on public.intake_slot_holds(expires_at);

create table if not exists public.intake_calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);

create index if not exists intake_calendar_blocks_range_idx
on public.intake_calendar_blocks(start_at, end_at);

create table if not exists public.intake_appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null
    references public.intake_appointments(id) on delete cascade,
  event_type text not null,
  previous_start_at timestamptz,
  new_start_at timestamptz,
  note text,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists intake_appointment_events_appointment_idx
on public.intake_appointment_events(appointment_id, created_at desc);

create table if not exists public.public_intake_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  request_type text not null check (
    request_type in ('scheduled_call', 'rapid_callback')
  ),
  prospect_id uuid references public.public_intake_prospects(id),
  appointment_id uuid references public.intake_appointments(id),
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.public_intake_rate_limits (
  key_hash text not null,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  primary key (key_hash, action)
);

alter table public.public_intake_prospects enable row level security;
alter table public.intake_appointments enable row level security;
alter table public.intake_slot_holds enable row level security;
alter table public.intake_calendar_blocks enable row level security;
alter table public.intake_appointment_events enable row level security;
alter table public.public_intake_requests enable row level security;
alter table public.public_intake_rate_limits enable row level security;

drop policy if exists "public_intake_prospects_direction_all" on public.public_intake_prospects;
create policy "public_intake_prospects_direction_all"
on public.public_intake_prospects for all to authenticated
using (public.is_direction()) with check (public.is_direction());

drop policy if exists "intake_appointments_direction_select" on public.intake_appointments;
create policy "intake_appointments_direction_select"
on public.intake_appointments for select to authenticated
using (public.is_direction());

drop policy if exists "intake_calendar_blocks_direction_all" on public.intake_calendar_blocks;
create policy "intake_calendar_blocks_direction_all"
on public.intake_calendar_blocks for all to authenticated
using (public.is_direction()) with check (public.is_direction());

drop policy if exists "intake_appointment_events_direction_select" on public.intake_appointment_events;
create policy "intake_appointment_events_direction_select"
on public.intake_appointment_events for select to authenticated
using (public.is_direction());

create or replace function public.check_public_intake_rate_limit(
  p_key_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  insert into public.public_intake_rate_limits (
    key_hash, action, window_started_at, request_count
  ) values (p_key_hash, p_action, now(), 1)
  on conflict (key_hash, action) do update
  set
    window_started_at = case
      when public.public_intake_rate_limits.window_started_at
        <= now() - make_interval(secs => p_window_seconds)
      then now()
      else public.public_intake_rate_limits.window_started_at
    end,
    request_count = case
      when public.public_intake_rate_limits.window_started_at
        <= now() - make_interval(secs => p_window_seconds)
      then 1
      else public.public_intake_rate_limits.request_count + 1
    end
  returning request_count into current_count;

  return current_count <= p_limit;
end;
$$;

create or replace function public.hold_public_intake_slot(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_buffer_end_at timestamptz,
  p_token_hash text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  held public.intake_slot_holds%rowtype;
begin
  perform pg_advisory_xact_lock(84201);
  delete from public.intake_slot_holds where expires_at <= now();

  select * into held
  from public.intake_slot_holds
  where idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'holdId', held.id,
      'expiresAt', held.expires_at,
      'startAt', held.start_at
    );
  end if;

  if exists (
    select 1 from public.intake_appointments
    where status = 'scheduled' and start_at = p_start_at
  ) or exists (
    select 1 from public.intake_calendar_blocks
    where start_at < p_buffer_end_at and p_start_at < end_at
  ) or exists (
    select 1 from public.intake_slot_holds
    where start_at = p_start_at and expires_at > now()
  ) then
    raise exception using errcode = 'P0001', message = 'SLOT_UNAVAILABLE';
  end if;

  insert into public.intake_slot_holds (
    start_at, end_at, buffer_end_at, token_hash, idempotency_key,
    expires_at
  ) values (
    p_start_at, p_end_at, p_buffer_end_at, p_token_hash,
    p_idempotency_key, now() + interval '5 minutes'
  ) returning * into held;

  return jsonb_build_object(
    'holdId', held.id,
    'expiresAt', held.expires_at,
    'startAt', held.start_at
  );
end;
$$;

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
  response_payload jsonb;
begin
  perform pg_advisory_xact_lock(84201);

  select intake_request.response_payload into existing_response
  from public.public_intake_requests as intake_request
  where intake_request.idempotency_key = p_idempotency_key;
  if found then return existing_response || jsonb_build_object('reused', true); end if;

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
    coalesce(nullif(p_payload->>'provenance', ''), 'Site web – rendez-vous téléphonique'),
    coalesce(p_payload->'utm', '{}'::jsonb),
    duplicate_prospect_id is not null or duplicate_waiting_id is not null,
    duplicate_prospect_id, duplicate_waiting_id
  ) returning id into prospect_id;

  insert into public.intake_appointments (
    prospect_id, start_at, end_at, buffer_end_at, source
  ) values (
    prospect_id, held.start_at, held.end_at, held.buffer_end_at,
    'public_website'
  ) returning id into appointment_id;

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

create or replace function public.create_public_callback_request(
  p_payload jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_response jsonb;
  duplicate_prospect_id uuid;
  duplicate_waiting_id uuid;
  prospect_id uuid;
  response_payload jsonb;
begin
  perform pg_advisory_xact_lock(84202);
  select intake_request.response_payload into existing_response
  from public.public_intake_requests as intake_request
  where intake_request.idempotency_key = p_idempotency_key;
  if found then return existing_response || jsonb_build_object('reused', true); end if;

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
    consultation_reason, contact_request_type, rapid_callback_requested_at,
    source, utm, potential_duplicate, potential_duplicate_prospect_id,
    potential_duplicate_waiting_list_client_id
  ) values (
    'callback_requested', p_payload->>'firstName', p_payload->>'lastName',
    nullif(p_payload->>'birthDate', '')::date,
    p_payload->>'phone', p_payload->>'email',
    p_payload->>'normalizedPhone', lower(p_payload->>'email'),
    p_payload->>'requestType',
    array(select jsonb_array_elements_text(p_payload->'requesterNames')),
    array(select jsonb_array_elements_text(p_payload->'modalityLabels')),
    nullif(p_payload->>'address', ''), nullif(p_payload->>'city', ''),
    nullif(p_payload->>'postalCode', ''),
    nullif(p_payload->>'consultationReason', ''),
    'rapid_callback', now(),
    coalesce(nullif(p_payload->>'provenance', ''), 'Site web – rappel rapide'),
    coalesce(p_payload->'utm', '{}'::jsonb),
    duplicate_prospect_id is not null or duplicate_waiting_id is not null,
    duplicate_prospect_id, duplicate_waiting_id
  ) returning id into prospect_id;

  insert into public.administrative_tasks (
    title, description, assigned_to, status, due_at,
    source_type, source_id
  ) values (
    'Rappel rapide demandé – ' || concat_ws(' ', p_payload->>'firstName', p_payload->>'lastName'),
    'Rappeler ce prospect en priorité depuis la liste des prospects.',
    'both', 'pending', now(), 'public_intake_rapid_callback', prospect_id
  );

  insert into public.audit_logs (
    actor_name, actor_role, action, entity_type, entity_id,
    description, metadata
  ) values (
    'Site web', 'public', 'public_intake_callback_requested',
    'public_intake_prospect', prospect_id,
    'Rappel rapide demandé depuis le site web.',
    jsonb_build_object(
      'prospect_id', prospect_id,
      'potential_duplicate', duplicate_prospect_id is not null or duplicate_waiting_id is not null
    )
  );

  response_payload := jsonb_build_object(
    'success', true,
    'prospectId', prospect_id,
    'status', 'RAPID_CALLBACK_REQUESTED',
    'potentialDuplicate', duplicate_prospect_id is not null or duplicate_waiting_id is not null
  );
  insert into public.public_intake_requests (
    idempotency_key, request_type, prospect_id, response_payload
  ) values (
    p_idempotency_key, 'rapid_callback', prospect_id, response_payload
  );
  return response_payload;
end;
$$;

create or replace function public.create_intake_calendar_block(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_reason text,
  p_actor_id uuid,
  p_actor_name text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  block_id uuid;
begin
  perform pg_advisory_xact_lock(84201);
  delete from public.intake_slot_holds where expires_at <= now();
  if p_end_at <= p_start_at then
    raise exception using errcode = 'P0001', message = 'INVALID_RANGE';
  end if;
  if exists (
    select 1 from public.intake_appointments
    where status = 'scheduled'
      and start_at < p_end_at and p_start_at < buffer_end_at
  ) or exists (
    select 1 from public.intake_slot_holds
    where expires_at > now()
      and start_at < p_end_at and p_start_at < buffer_end_at
  ) then
    raise exception using errcode = 'P0001', message = 'RANGE_UNAVAILABLE';
  end if;

  insert into public.intake_calendar_blocks (
    start_at, end_at, reason, created_by
  ) values (p_start_at, p_end_at, nullif(trim(p_reason), ''), p_actor_id)
  returning id into block_id;

  insert into public.audit_logs (
    actor_profile_id, actor_name, actor_role, action, entity_type,
    entity_id, description, metadata
  ) values (
    p_actor_id, p_actor_name, 'direction', 'intake_calendar_block_created',
    'intake_calendar_block', block_id, 'Plage bloquée dans le calendrier des appels.',
    jsonb_build_object('start_at', p_start_at, 'end_at', p_end_at)
  );
  return block_id;
end;
$$;

create or replace function public.update_intake_appointment(
  p_appointment_id uuid,
  p_action text,
  p_new_start_at timestamptz,
  p_new_end_at timestamptz,
  p_new_buffer_end_at timestamptz,
  p_note text,
  p_actor_id uuid,
  p_actor_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment public.intake_appointments%rowtype;
begin
  perform pg_advisory_xact_lock(84201);
  select * into appointment from public.intake_appointments
  where id = p_appointment_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'APPOINTMENT_NOT_FOUND';
  end if;

  if p_action = 'cancel' then
    if appointment.status <> 'scheduled' then
      raise exception using errcode = 'P0001', message = 'APPOINTMENT_NOT_ACTIVE';
    end if;
    update public.intake_appointments
    set status = 'cancelled', cancellation_reason = nullif(trim(p_note), ''),
        updated_at = now()
    where id = p_appointment_id;
    insert into public.intake_appointment_events (
      appointment_id, event_type, previous_start_at, note,
      actor_profile_id, actor_name
    ) values (
      p_appointment_id, 'cancelled', appointment.start_at,
      nullif(trim(p_note), ''), p_actor_id, p_actor_name
    );
  elsif p_action = 'reschedule' then
    if appointment.status <> 'scheduled' then
      raise exception using errcode = 'P0001', message = 'APPOINTMENT_NOT_ACTIVE';
    end if;
    if p_new_end_at <= p_new_start_at or p_new_buffer_end_at < p_new_end_at then
      raise exception using errcode = 'P0001', message = 'INVALID_RANGE';
    end if;
    if exists (
      select 1 from public.intake_appointments
      where status = 'scheduled' and id <> p_appointment_id
        and start_at < p_new_buffer_end_at and p_new_start_at < buffer_end_at
    ) or exists (
      select 1 from public.intake_calendar_blocks
      where start_at < p_new_buffer_end_at and p_new_start_at < end_at
    ) or exists (
      select 1 from public.intake_slot_holds
      where expires_at > now()
        and start_at < p_new_buffer_end_at and p_new_start_at < buffer_end_at
    ) then
      raise exception using errcode = 'P0001', message = 'SLOT_UNAVAILABLE';
    end if;

    update public.intake_appointments
    set start_at = p_new_start_at, end_at = p_new_end_at,
        buffer_end_at = p_new_buffer_end_at, updated_at = now()
    where id = p_appointment_id;
    insert into public.intake_appointment_events (
      appointment_id, event_type, previous_start_at, new_start_at, note,
      actor_profile_id, actor_name
    ) values (
      p_appointment_id, 'rescheduled', appointment.start_at,
      p_new_start_at, nullif(trim(p_note), ''), p_actor_id, p_actor_name
    );
  else
    raise exception using errcode = 'P0001', message = 'INVALID_ACTION';
  end if;

  insert into public.audit_logs (
    actor_profile_id, actor_name, actor_role, action, entity_type,
    entity_id, description, metadata
  ) values (
    p_actor_id, p_actor_name, 'direction',
    case when p_action = 'cancel' then 'intake_appointment_cancelled'
         else 'intake_appointment_rescheduled' end,
    'intake_appointment', p_appointment_id,
    case when p_action = 'cancel' then 'Rendez-vous téléphonique annulé.'
         else 'Rendez-vous téléphonique déplacé.' end,
    jsonb_build_object(
      'previous_start_at', appointment.start_at,
      'new_start_at', p_new_start_at
    )
  );

  return jsonb_build_object('success', true, 'appointmentId', p_appointment_id);
end;
$$;

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

revoke all on function public.check_public_intake_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.hold_public_intake_slot(timestamptz, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.confirm_public_intake_booking(jsonb, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.create_public_callback_request(jsonb, text) from public, anon, authenticated;
revoke all on function public.create_intake_calendar_block(timestamptz, timestamptz, text, uuid, text) from public, anon, authenticated;
revoke all on function public.update_intake_appointment(uuid, text, timestamptz, timestamptz, timestamptz, text, uuid, text) from public, anon, authenticated;
revoke all on function public.transfer_prospect_to_waiting_list(uuid, text, uuid, text) from public, anon, authenticated;

grant execute on function public.check_public_intake_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.hold_public_intake_slot(timestamptz, timestamptz, timestamptz, text, text) to service_role;
grant execute on function public.confirm_public_intake_booking(jsonb, timestamptz, text, text) to service_role;
grant execute on function public.create_public_callback_request(jsonb, text) to service_role;
grant execute on function public.create_intake_calendar_block(timestamptz, timestamptz, text, uuid, text) to service_role;
grant execute on function public.update_intake_appointment(uuid, text, timestamptz, timestamptz, timestamptz, text, uuid, text) to service_role;
grant execute on function public.transfer_prospect_to_waiting_list(uuid, text, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
