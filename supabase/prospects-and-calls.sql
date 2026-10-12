-- A revoir puis installer manuellement. Aucun nettoyage de donnees existantes.
-- Prerequis: public-intake-calendar.sql et assignment-processes.sql.
begin;

alter table public.public_intake_prospects
  add column if not exists is_test boolean not null default false;

-- La suppression passe exclusivement par le RPC controle et transactionnel.
drop policy if exists "public_intake_prospects_direction_all" on public.public_intake_prospects;
drop policy if exists "public_intake_prospects_direction_select" on public.public_intake_prospects;
create policy "public_intake_prospects_direction_select"
  on public.public_intake_prospects for select to authenticated using (public.is_direction());
drop policy if exists "public_intake_prospects_direction_insert" on public.public_intake_prospects;
create policy "public_intake_prospects_direction_insert"
  on public.public_intake_prospects for insert to authenticated with check (public.is_direction());
drop policy if exists "public_intake_prospects_direction_update" on public.public_intake_prospects;
create policy "public_intake_prospects_direction_update"
  on public.public_intake_prospects for update to authenticated
  using (public.is_direction()) with check (public.is_direction());

create or replace function public.mark_intake_prospect_test(
  p_prospect_id uuid, p_actor_id uuid, p_is_test boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  prospect public.public_intake_prospects%rowtype;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'direction') then
    raise exception 'DIRECTION_REQUIRED';
  end if;
  select * into prospect from public.public_intake_prospects where id = p_prospect_id for update;
  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;
  if prospect.waiting_list_client_id is not null or prospect.status = 'transferred_to_waiting_list' then
    raise exception 'PROSPECT_ALREADY_TRANSFERRED';
  end if;
  if p_is_test is null then raise exception 'INVALID_TEST_MARKER'; end if;
  update public.public_intake_prospects set is_test = p_is_test, updated_at = now() where id = p_prospect_id;
  insert into public.audit_logs (actor_profile_id, actor_role, action, entity_type, entity_id, description, metadata)
  values (p_actor_id, 'direction', 'public_intake_prospect_test_marked', 'public_intake_prospect',
    p_prospect_id, 'Marquage de test du prospect modifie.', jsonb_build_object('is_test', p_is_test));
  return jsonb_build_object('success', true, 'isTest', p_is_test);
end;
$$;

create or replace function public.delete_intake_test_prospect(
  p_prospect_id uuid, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  prospect public.public_intake_prospects%rowtype;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'direction') then
    raise exception 'DIRECTION_REQUIRED';
  end if;
  -- Meme ordre que les operations d'admission/transfert; pas de suppression partielle.
  perform pg_advisory_xact_lock(84201);
  perform pg_advisory_xact_lock(84202);
  perform pg_advisory_xact_lock(84203);
  select * into prospect from public.public_intake_prospects where id = p_prospect_id for update;
  if not found then raise exception 'PROSPECT_NOT_FOUND'; end if;
  if prospect.waiting_list_client_id is not null or prospect.status = 'transferred_to_waiting_list' then
    raise exception 'PROSPECT_ALREADY_TRANSFERRED';
  end if;
  if prospect.is_test is not true then raise exception 'PROSPECT_NOT_TEST'; end if;

  delete from public.public_intake_requests where prospect_id = p_prospect_id
    or appointment_id in (select id from public.intake_appointments where prospect_id = p_prospect_id);
  -- Les notes de ces taches sont supprimees par leur FK ON DELETE CASCADE.
  delete from public.administrative_tasks
    where source_type = 'public_intake_rapid_callback' and source_id = p_prospect_id;
  -- Les evenements de rendez-vous sont supprimes par leur FK ON DELETE CASCADE.
  delete from public.intake_appointments where prospect_id = p_prospect_id;
  update public.public_intake_prospects
    set potential_duplicate_prospect_id = null,
        potential_duplicate = (potential_duplicate_waiting_list_client_id is not null)
    where potential_duplicate_prospect_id = p_prospect_id;
  delete from public.public_intake_prospects where id = p_prospect_id;

  -- Conserver les traces precedentes et une trace minimale sans coordonnees du dossier.
  insert into public.audit_logs (actor_profile_id, actor_role, action, entity_type, entity_id, description, metadata)
  values (p_actor_id, 'direction', 'public_intake_test_prospect_deleted', 'public_intake_prospect',
    p_prospect_id, 'Dossier de test et donnees d admission liees supprimes.', '{"is_test":true}'::jsonb);
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.mark_intake_prospect_test(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.delete_intake_test_prospect(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_intake_prospect_test(uuid, uuid, boolean) to service_role;
grant execute on function public.delete_intake_test_prospect(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
