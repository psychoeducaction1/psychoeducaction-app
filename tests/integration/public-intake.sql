-- Run only through npm run test:db against an isolated local database.
-- Existing application schema and migrations are prerequisites, not installed here.
begin;

do $$
declare
  actor uuid;
  fixture_key text := 'local-test-' || gen_random_uuid()::text;
  slot timestamptz := date_trunc('day', now()) + interval '14 days 10 hours';
  payload jsonb := jsonb_build_object(
    'firstName', 'Client', 'lastName', 'Fictif', 'birthDate', null,
    'phone', '5145550100', 'normalizedPhone', '5145550100',
    'email', fixture_key || '@example.invalid', 'requestType', 'self',
    'requesterNames', '[]'::jsonb, 'modalityLabels', '["Visioconference"]'::jsonb,
    'consultationReason', 'Demande fictive pour test local', 'utm', '{}'::jsonb
  );
  held jsonb;
  repeated_hold jsonb;
  booking jsonb;
  retry jsonb;
  second_booking jsonb;
  transfer jsonb;
  repeated_transfer jsonb;
  booked_appointment_id uuid;
  second_prospect_id uuid;
  future_appointment_id uuid := gen_random_uuid();
  duplicate_callback jsonb;
  conversion_id uuid;
  observed_id uuid;
  observed_status text;
  blocked boolean;
begin
  select id into actor from public.profiles where role = 'direction' limit 1;
  assert actor is not null, 'Seed a fictitious local direction profile first';
  assert not has_function_privilege('anon',
    'public.confirm_public_intake_booking(jsonb,timestamptz,text,text)', 'EXECUTE'),
    'Anonymous database roles must not invoke booking RPC directly';
  assert not has_function_privilege('authenticated',
    'public.transfer_prospect_to_waiting_list(uuid,text,uuid,text)', 'EXECUTE'),
    'Authenticated database roles must not bypass the transfer API';
  assert has_function_privilege('service_role',
    'public.confirm_public_intake_booking(jsonb,timestamptz,text,text)', 'EXECUTE');

  held := public.hold_public_intake_slot(slot, slot + interval '15 minutes',
    slot + interval '30 minutes', fixture_key, fixture_key || '-hold');
  repeated_hold := public.hold_public_intake_slot(slot, slot + interval '15 minutes',
    slot + interval '30 minutes', fixture_key, fixture_key || '-hold');
  assert held->>'holdId' = repeated_hold->>'holdId', 'Hold retry created another hold';

  booking := public.confirm_public_intake_booking(payload, slot, fixture_key, fixture_key || '-booking');
  booked_appointment_id := (booking->>'appointmentId')::uuid;
  conversion_id := (booking->>'conversionEventId')::uuid;
  assert booked_appointment_id is not null and conversion_id is not null;
  assert booked_appointment_id <> conversion_id, 'Marketing ID reuses primary appointment ID';
  select conversion_event_id into observed_id from public.intake_appointments where id = booked_appointment_id;
  assert observed_id = conversion_id, 'API payload disagrees with stored conversion ID';

  retry := public.confirm_public_intake_booking(payload, slot, fixture_key, fixture_key || '-booking');
  assert retry->>'appointmentId' = booking->>'appointmentId';
  assert retry->>'conversionEventId' = booking->>'conversionEventId';
  assert (retry->>'reused')::boolean;
  assert (select count(*) from public.intake_appointments where id = booked_appointment_id) = 1;

  blocked := false;
  begin
    perform public.hold_public_intake_slot(slot, slot + interval '15 minutes',
      slot + interval '30 minutes', fixture_key, fixture_key || '-occupied');
  exception when raise_exception then
    if sqlerrm <> 'SLOT_UNAVAILABLE' then raise; end if;
    blocked := true;
  end;
  assert blocked, 'An occupied slot was reserved twice';

  blocked := false;
  begin
    perform public.confirm_public_intake_booking(payload, slot + interval '2 hours',
      'missing-token', fixture_key || '-missing-hold');
  exception when raise_exception then
    if sqlerrm <> 'HOLD_INVALID_OR_EXPIRED' then raise; end if;
    blocked := true;
  end;
  assert blocked, 'Booking was created without a valid hold';
  assert not exists (select 1 from public.public_intake_requests
    where idempotency_key = fixture_key || '-missing-hold');

  perform public.hold_public_intake_slot(slot + interval '2 hours', slot + interval '135 minutes',
    slot + interval '150 minutes', fixture_key, fixture_key || '-hold-two');
  second_booking := public.confirm_public_intake_booking(payload, slot + interval '2 hours',
    fixture_key, fixture_key || '-booking-two');
  assert second_booking->>'conversionEventId' <> booking->>'conversionEventId';
  assert (second_booking->>'potentialDuplicate')::boolean, 'Repeated contact was not flagged';
  second_prospect_id := (second_booking->>'prospectId')::uuid;

  perform public.update_intake_appointment(booked_appointment_id, 'reschedule',
    slot + interval '4 hours', slot + interval '255 minutes', slot + interval '270 minutes',
    'Deplacement fictif', null, 'Direction fictive');
  select conversion_event_id into observed_id from public.intake_appointments where id = booked_appointment_id;
  assert observed_id = conversion_id, 'Reschedule changed conversion ID';
  assert (select start_at from public.intake_appointments where id = booked_appointment_id) = slot + interval '4 hours';
  perform public.update_intake_appointment(booked_appointment_id, 'cancel', null, null, null,
    'Annulation fictive', null, 'Direction fictive');
  select status into observed_status from public.intake_appointments where id = booked_appointment_id;
  assert observed_status = 'cancelled';
  assert exists (select 1 from public.intake_appointment_events
    where intake_appointment_events.appointment_id = booked_appointment_id and event_type = 'cancelled');

  blocked := false;
  begin
    perform public.update_intake_appointment(booked_appointment_id, 'cancel', null, null, null,
      null, null, 'Direction fictive');
  exception when raise_exception then
    if sqlerrm <> 'APPOINTMENT_NOT_ACTIVE' then raise; end if;
    blocked := true;
  end;
  assert blocked, 'An inactive appointment was cancelled again';

  -- Appel deja passe: le transfert doit cloturer ce rendez-vous dans la meme transaction.
  update public.intake_appointments set start_at = now() - interval '1 hour',
    end_at = now() - interval '45 minutes', buffer_end_at = now() - interval '30 minutes'
    where prospect_id = second_prospect_id;
  insert into public.intake_appointments (id, prospect_id, start_at, end_at, buffer_end_at)
  values (future_appointment_id, second_prospect_id, slot + interval '6 hours',
    slot + interval '375 minutes', slot + interval '390 minutes');
  transfer := public.transfer_prospect_to_waiting_list(second_prospect_id, 'normal', actor, 'Direction fictive');
  repeated_transfer := public.transfer_prospect_to_waiting_list(second_prospect_id, 'normal', actor, 'Direction fictive');
  assert transfer->>'waitingListClientId' is not null;
  assert transfer->>'waitingListClientId' = repeated_transfer->>'waitingListClientId';
  assert (repeated_transfer->>'reused')::boolean, 'Transfer retry created another dossier';
  select status into observed_status from public.public_intake_prospects where id = second_prospect_id;
  assert observed_status = 'transferred_to_waiting_list';
  assert (select status from public.intake_appointments where id =
    (second_booking->>'appointmentId')::uuid) = 'completed';
  assert (select status from public.intake_appointments where id = future_appointment_id) = 'scheduled';
  assert (select count(*) from public.intake_appointment_events where appointment_id =
    (second_booking->>'appointmentId')::uuid and event_type = 'completed') = 1;
  assert (select internal_notes from public.waiting_list_clients
    where id = (transfer->>'waitingListClientId')::uuid) is null;

  duplicate_callback := public.create_public_callback_request(payload, fixture_key || '-duplicate-transfer');
  blocked := false;
  begin
    perform public.transfer_prospect_to_waiting_list((duplicate_callback->>'prospectId')::uuid, 'normal', actor, 'Direction fictive');
  exception when raise_exception then
    if sqlerrm <> 'EXISTING_WAITING_LIST_CLIENT' then raise; end if;
    blocked := true;
  end;
  assert blocked, 'A second prospect created a duplicate waiting-list dossier';
  assert (select waiting_list_client_id from public.public_intake_prospects
    where id = (duplicate_callback->>'prospectId')::uuid) is null;

  raise notice 'Local integration passed: RPC privileges, holds, booking retries, conversion IDs, duplicates, reschedule, cancellation and transfer.';
end;
$$;

rollback;
