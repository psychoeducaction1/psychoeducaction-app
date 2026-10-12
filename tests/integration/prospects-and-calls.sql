-- Base locale isolee uniquement, via npm run test:db. Aucune migration ici.
-- Prerequis supplementaires: prospects-and-calls.sql et un profil direction fictif local.
begin;

create function pg_temp.reject_fixture_deletion_audit() returns trigger language plpgsql as $$
begin
  if new.action = 'public_intake_test_prospect_deleted' then raise exception 'FIXTURE_AUDIT_FAILURE'; end if;
  return new;
end;
$$;

do $$
declare
  actor uuid;
  fixture_id uuid := gen_random_uuid();
  duplicate_id uuid := gen_random_uuid();
  fixture_appointment_id uuid := gen_random_uuid();
  fixture_task_id uuid := gen_random_uuid();
  unrelated_task_id uuid := gen_random_uuid();
  fixture_key text := 'local-cleanup-' || gen_random_uuid()::text;
  result jsonb;
  transferred_client_id uuid;
  refused boolean;
begin
  select id into actor from public.profiles where role = 'direction' limit 1;
  assert actor is not null, 'Seed a fictitious direction profile in the isolated local database first';
  assert not has_function_privilege('anon', 'public.delete_intake_test_prospect(uuid,uuid)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.delete_intake_test_prospect(uuid,uuid)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.mark_intake_prospect_test(uuid,uuid,boolean)', 'EXECUTE');
  assert has_function_privilege('service_role', 'public.delete_intake_test_prospect(uuid,uuid)', 'EXECUTE');

  insert into public.public_intake_prospects
    (id, first_name, last_name, phone, email, normalized_phone, normalized_email, request_type, contact_request_type, consultation_reason)
  values (fixture_id, 'Client', 'Fictif', '5145550100', fixture_key || '@example.invalid',
    '5145550100', fixture_key || '@example.invalid', 'self', 'scheduled_call', 'Motif fictif');
  assert (select is_test from public.public_intake_prospects where id = fixture_id) = false;

  refused := false;
  begin perform public.delete_intake_test_prospect(fixture_id, actor);
  exception when raise_exception then
    if sqlerrm <> 'PROSPECT_NOT_TEST' then raise; end if;
    refused := true;
  end;
  assert refused, 'An unmarked dossier was deleted';
  refused := false;
  begin perform public.mark_intake_prospect_test(fixture_id, gen_random_uuid(), true);
  exception when raise_exception then
    if sqlerrm <> 'DIRECTION_REQUIRED' then raise; end if;
    refused := true;
  end;
  assert refused, 'An unauthorized actor marked a dossier';
  refused := false;
  begin perform public.delete_intake_test_prospect(fixture_id, gen_random_uuid());
  exception when raise_exception then
    if sqlerrm <> 'DIRECTION_REQUIRED' then raise; end if;
    refused := true;
  end;
  assert refused, 'An unauthorized actor deleted a dossier';

  perform public.mark_intake_prospect_test(fixture_id, actor, true);
  assert (select is_test from public.public_intake_prospects where id = fixture_id);
  perform public.mark_intake_prospect_test(fixture_id, actor, false);
  assert not (select is_test from public.public_intake_prospects where id = fixture_id);
  perform public.mark_intake_prospect_test(fixture_id, actor, true);

  insert into public.intake_appointments (id, prospect_id, start_at, end_at, buffer_end_at, status)
  values (fixture_appointment_id, fixture_id, now() + interval '31 days', now() + interval '31 days 15 minutes',
    now() + interval '31 days 30 minutes', 'cancelled');
  insert into public.intake_appointment_events (appointment_id, event_type) values (fixture_appointment_id, 'scheduled');
  insert into public.public_intake_requests (idempotency_key, request_type, prospect_id, appointment_id)
  values (fixture_key, 'scheduled_call', fixture_id, fixture_appointment_id);
  insert into public.administrative_tasks (id, title, source_type, source_id)
  values (fixture_task_id, 'Rappel fictif', 'public_intake_rapid_callback', fixture_id),
    (unrelated_task_id, 'Tache fictive hors admission', 'fixture_unrelated', fixture_id);
  insert into public.administrative_task_notes (task_id, note) values (fixture_task_id, 'Note fictive');
  insert into public.public_intake_prospects
    (id, first_name, last_name, phone, email, normalized_phone, normalized_email, request_type,
      contact_request_type, potential_duplicate, potential_duplicate_prospect_id, consultation_reason)
  values (duplicate_id, 'Autre', 'Fictif', '5145550101', fixture_key || '-other@example.invalid',
    '5145550101', fixture_key || '-other@example.invalid', 'self', 'rapid_callback', true, fixture_id, 'Motif fictif');

  -- Un echec de la derniere ecriture doit annuler TOUT le nettoyage.
  execute 'create trigger fixture_reject_cleanup_audit before insert on public.audit_logs for each row execute function pg_temp.reject_fixture_deletion_audit()';
  refused := false;
  begin perform public.delete_intake_test_prospect(fixture_id, actor);
  exception when raise_exception then
    if sqlerrm <> 'FIXTURE_AUDIT_FAILURE' then raise; end if;
    refused := true;
  end;
  assert refused;
  assert exists (select 1 from public.public_intake_prospects where id = fixture_id);
  assert exists (select 1 from public.intake_appointments where id = fixture_appointment_id);
  assert exists (select 1 from public.intake_appointment_events where intake_appointment_events.appointment_id = fixture_appointment_id);
  assert exists (select 1 from public.public_intake_requests where idempotency_key = fixture_key);
  assert exists (select 1 from public.administrative_tasks where id = fixture_task_id);
  assert exists (select 1 from public.administrative_task_notes where administrative_task_notes.task_id = fixture_task_id);
  assert (select potential_duplicate_prospect_id from public.public_intake_prospects where id = duplicate_id) = fixture_id;
  execute 'drop trigger fixture_reject_cleanup_audit on public.audit_logs';

  result := public.delete_intake_test_prospect(fixture_id, actor);
  assert (result->>'success')::boolean;
  assert not exists (select 1 from public.public_intake_prospects where id = fixture_id);
  assert not exists (select 1 from public.intake_appointments where id = fixture_appointment_id);
  assert not exists (select 1 from public.intake_appointment_events where intake_appointment_events.appointment_id = fixture_appointment_id);
  assert not exists (select 1 from public.public_intake_requests where idempotency_key = fixture_key);
  assert not exists (select 1 from public.administrative_tasks where id = fixture_task_id);
  assert not exists (select 1 from public.administrative_task_notes where administrative_task_notes.task_id = fixture_task_id);
  assert exists (select 1 from public.administrative_tasks where id = unrelated_task_id);
  assert exists (select 1 from public.public_intake_prospects where id = duplicate_id
    and potential_duplicate_prospect_id is null and not potential_duplicate);
  assert exists (select 1 from public.audit_logs where entity_id = fixture_id
    and action = 'public_intake_test_prospect_deleted' and metadata = '{"is_test":true}'::jsonb);

  -- Un test transfere est protege; son client et ses donnees restent presents.
  perform public.mark_intake_prospect_test(duplicate_id, actor, true);
  result := public.transfer_prospect_to_waiting_list(duplicate_id, 'normal', actor, 'Direction fictive');
  transferred_client_id := (result->>'waitingListClientId')::uuid;
  refused := false;
  begin perform public.delete_intake_test_prospect(duplicate_id, actor);
  exception when raise_exception then
    if sqlerrm <> 'PROSPECT_ALREADY_TRANSFERRED' then raise; end if;
    refused := true;
  end;
  assert refused;
  assert exists (select 1 from public.waiting_list_clients where id = transferred_client_id);
  assert exists (select 1 from public.public_intake_prospects where id = duplicate_id);
  refused := false;
  begin perform public.mark_intake_prospect_test(duplicate_id, actor, false);
  exception when raise_exception then
    if sqlerrm <> 'PROSPECT_ALREADY_TRANSFERRED' then raise; end if;
    refused := true;
  end;
  assert refused;
  raise notice 'Local cleanup passed: authorization, marker, transfer protection, linked cleanup and rollback.';
end;
$$;

rollback;
