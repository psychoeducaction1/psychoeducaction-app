-- Base locale isolee uniquement, via npm run test:db. Aucune migration ici.
-- Prerequis: prospect-call-workflow.sql et un profil direction fictif local.
begin;

create function pg_temp.reject_fixture_followup_audit() returns trigger language plpgsql as $$
begin
  if new.action = 'intake_followup_appointment_created' then raise exception 'FIXTURE_FOLLOWUP_AUDIT_FAILURE'; end if;
  return new;
end;
$$;

do $$
declare
  actor uuid;
  fixture_id uuid := gen_random_uuid();
  current_call uuid := gen_random_uuid();
  blocker uuid := gen_random_uuid();
  task uuid := gen_random_uuid();
  retry_key uuid := gen_random_uuid();
  slot timestamptz := (date_trunc('week', now() at time zone 'America/Toronto') + interval '14 days 10 hours') at time zone 'America/Toronto';
  result jsonb;
  repeated jsonb;
  next_call uuid;
  refused boolean;
begin
  select id into actor from public.profiles where role = 'direction' limit 1;
  assert actor is not null, 'Seed a fictitious local direction profile first';
  assert not has_function_privilege('authenticated', 'public.record_prospect_call_outcome(uuid,uuid,text,text,uuid)', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.create_prospect_followup_appointment(uuid,uuid,text,uuid,timestamptz,timestamptz,timestamptz,uuid)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.create_prospect_followup_appointment(uuid,uuid,text,uuid,timestamptz,timestamptz,timestamptz,uuid)', 'EXECUTE');

  insert into public.public_intake_prospects
    (id, status, first_name, last_name, phone, email, normalized_phone, normalized_email, request_type, contact_request_type, consultation_reason)
  values (fixture_id, 'scheduled', 'Client', 'Fictif', '5145550100', fixture_id::text || '@example.invalid',
    '5145550100', fixture_id::text || '@example.invalid', 'self', 'rapid_callback', 'Motif fictif');
  insert into public.intake_appointments (id, prospect_id, start_at, end_at, buffer_end_at)
  values (current_call, fixture_id, slot, slot + interval '15 minutes', slot + interval '30 minutes');
  insert into public.administrative_tasks (id, title, source_type, source_id)
  values (task, 'Rappel fictif', 'public_intake_rapid_callback', fixture_id);

  refused := false;
  begin perform public.record_prospect_call_outcome(fixture_id, gen_random_uuid(), 'other', 'Precision fictive', current_call);
  exception when raise_exception then
    if sqlerrm <> 'DIRECTION_REQUIRED' then raise; end if;
    refused := true;
  end;
  assert refused;
  refused := false;
  begin perform public.record_prospect_call_outcome(fixture_id, actor, 'other', 'Precision fictive', gen_random_uuid());
  exception when raise_exception then
    if sqlerrm <> 'APPOINTMENT_MISMATCH' then raise; end if;
    refused := true;
  end;
  assert refused;

  insert into public.intake_calendar_blocks (id, start_at, end_at, reason)
  values (blocker, slot + interval '2 hours', slot + interval '3 hours', 'Blocage fictif');
  refused := false;
  begin
    perform public.create_prospect_followup_appointment(fixture_id, actor, 'Precision fictive', current_call,
      slot + interval '2 hours', slot + interval '135 minutes', slot + interval '150 minutes', retry_key);
  exception when raise_exception then
    if sqlerrm <> 'SLOT_UNAVAILABLE' then raise; end if;
    refused := true;
  end;
  assert refused;
  assert (select status from public.intake_appointments where id = current_call) = 'scheduled';
  assert (select status from public.public_intake_prospects where id = fixture_id) = 'scheduled';
  assert (select status from public.administrative_tasks where id = task) = 'pending';
  delete from public.intake_calendar_blocks where id = blocker;

  -- Echec de l'audit final: ni resultat ni rendez-vous ni tache ne doit etre modifie.
  execute 'create trigger fixture_reject_followup_audit before insert on public.audit_logs for each row execute function pg_temp.reject_fixture_followup_audit()';
  refused := false;
  begin
    perform public.create_prospect_followup_appointment(fixture_id, actor, 'Precision fictive', current_call,
      slot + interval '2 hours', slot + interval '135 minutes', slot + interval '150 minutes', retry_key);
  exception when raise_exception then
    if sqlerrm <> 'FIXTURE_FOLLOWUP_AUDIT_FAILURE' then raise; end if;
    refused := true;
  end;
  assert refused;
  assert (select status from public.intake_appointments where id = current_call) = 'scheduled';
  assert (select consultation_reason from public.public_intake_prospects where id = fixture_id) = 'Motif fictif';
  assert (select outcome_reason from public.public_intake_prospects where id = fixture_id) is null;
  assert (select status from public.administrative_tasks where id = task) = 'pending';
  assert (select count(*) from public.intake_appointments where prospect_id = fixture_id) = 1;
  assert not exists (select 1 from public.public_intake_requests where idempotency_key = 'direction-followup/' || retry_key::text);
  execute 'drop trigger fixture_reject_followup_audit on public.audit_logs';

  result := public.create_prospect_followup_appointment(fixture_id, actor, 'Precision fictive', current_call,
    slot + interval '2 hours', slot + interval '135 minutes', slot + interval '150 minutes', retry_key);
  next_call := (result->>'appointmentId')::uuid;
  repeated := public.create_prospect_followup_appointment(fixture_id, actor, 'Precision fictive', current_call,
    slot + interval '2 hours', slot + interval '135 minutes', slot + interval '150 minutes', retry_key);
  assert next_call <> current_call;
  assert (repeated->>'appointmentId')::uuid = next_call and (repeated->>'reused')::boolean;
  assert (select count(*) from public.public_intake_prospects where id = fixture_id) = 1;
  assert (select count(*) from public.intake_appointments where prospect_id = fixture_id) = 2;
  assert (select status from public.intake_appointments where id = current_call) = 'completed';
  assert (select status from public.intake_appointments where id = next_call) = 'scheduled';
  assert (select prospect_id from public.intake_appointments where id = next_call) = fixture_id;
  assert (select outcome_reason from public.public_intake_prospects where id = fixture_id) = 'Precision fictive';
  assert (select status from public.public_intake_prospects where id = fixture_id) = 'scheduled';
  assert (select status from public.administrative_tasks where id = task) = 'completed';
  perform public.record_prospect_call_outcome(fixture_id, actor, 'other', 'Autre precision fictive', next_call);
  perform public.record_prospect_call_outcome(fixture_id, actor, 'other', 'Autre precision fictive', next_call);
  assert (select status from public.public_intake_prospects where id = fixture_id) = 'other';
  assert (select status from public.intake_appointments where id = next_call) = 'completed';
  assert (select count(*) from public.intake_appointment_events where appointment_id = next_call and event_type = 'completed') = 1;

  perform public.transfer_prospect_to_waiting_list(fixture_id, 'normal', actor, 'Direction fictive');
  refused := false;
  begin perform public.record_prospect_call_outcome(fixture_id, actor, 'other', 'Fictif', next_call);
  exception when raise_exception then
    if sqlerrm <> 'PROSPECT_ALREADY_TRANSFERRED' then raise; end if;
    refused := true;
  end;
  assert refused;
  refused := false;
  begin
    perform public.create_prospect_followup_appointment(fixture_id, actor, 'Fictif', null,
      slot + interval '4 hours', slot + interval '255 minutes', slot + interval '270 minutes', gen_random_uuid());
  exception when raise_exception then
    if sqlerrm <> 'PROSPECT_ALREADY_TRANSFERRED' then raise; end if;
    refused := true;
  end;
  assert refused;
  raise notice 'Local call workflow passed: authorization, conflicts, rollback, same dossier, retry and outcome.';
end;
$$;
rollback;
