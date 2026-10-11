-- À exécuter manuellement dans le SQL Editor de Supabase.

begin;

alter table public.public_intake_prospects
add column if not exists conversion_event_id uuid;

alter table public.public_intake_prospects
alter column conversion_event_id set default gen_random_uuid();

update public.public_intake_prospects as prospect
set conversion_event_id = appointment.conversion_event_id
from public.intake_appointments as appointment
where appointment.prospect_id = prospect.id
  and prospect.conversion_event_id is null;

update public.public_intake_prospects
set conversion_event_id = gen_random_uuid()
where conversion_event_id is null;

alter table public.public_intake_prospects
alter column conversion_event_id set not null;

create unique index if not exists public_intake_prospects_conversion_event_id_idx
on public.public_intake_prospects(conversion_event_id);

alter table public.budget_variable_expenses
add column if not exists ad_platform text;

alter table public.budget_variable_expenses
add column if not exists expense_month date;

alter table public.budget_variable_expenses
drop constraint if exists budget_variable_expenses_ad_platform_check;

alter table public.budget_variable_expenses
add constraint budget_variable_expenses_ad_platform_check
check (ad_platform is null or ad_platform in ('google_ads', 'meta_ads'));

create unique index if not exists budget_variable_expenses_ad_platform_month_idx
on public.budget_variable_expenses(ad_platform, expense_month)
where ad_platform is not null and expense_month is not null;

create table if not exists public.public_acquisition_events (
  id uuid primary key default gen_random_uuid(),
  conversion_event_id uuid not null default gen_random_uuid(),
  idempotency_key text not null unique,
  event_type text not null check (
    event_type in ('contact_form_submitted', 'phone_click')
  ),
  source text not null default 'Site web',
  utm jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists public_acquisition_events_conversion_event_id_idx
on public.public_acquisition_events(conversion_event_id);

create index if not exists public_acquisition_events_created_at_idx
on public.public_acquisition_events(created_at desc);

alter table public.public_acquisition_events enable row level security;

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
  prospect_conversion_event_id uuid;
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
    or regexp_replace(coalesce(contact_phone, ''), '\\D', '', 'g')
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
  ) returning id, conversion_event_id
    into prospect_id, prospect_conversion_event_id;

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
    'conversionEventId', prospect_conversion_event_id,
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

revoke all on function public.create_public_callback_request(jsonb, text)
from public, anon, authenticated;
grant execute on function public.create_public_callback_request(jsonb, text)
to service_role;

commit;
