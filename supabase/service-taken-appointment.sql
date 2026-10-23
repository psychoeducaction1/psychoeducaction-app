-- PREPARE UNIQUEMENT. Ne pas appliquer sans autorisation.
-- Après waiting-list-assignment-transactions.sql et les règles d'accès existantes.
-- Aucun backfill : ne pas inventer de rendez-vous pour les assignations historiques.
begin;
alter table public.assigned_clients add column if not exists service_appointment jsonb;
comment on column public.assigned_clients.service_appointment is
  'Premier rendez-vous confirmé : date/heure Québec, instant UTC, modalité et adresse de bureau figée lors de la confirmation.';

create or replace function public.create_scheduled_waiting_list_assignment(
  p_waiting_list_client_id uuid, p_professional_id uuid, p_outcome text,
  p_idempotency_key uuid, p_assignment_process_id uuid, p_actor_id uuid,
  p_appointment jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; assignment_id uuid; saved jsonb; local_time timestamp;
begin
  -- Le RPC de base recontrôle l'identité, les droits, la capacité et la démarche.
  -- Validation avant sa première mutation; toute erreur ci-dessous annule aussi le RPC de base.
  if p_outcome is distinct from 'service_taken' or jsonb_typeof(p_appointment) is distinct from 'object'
    or coalesce(p_appointment->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_appointment->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or coalesce(p_appointment->>'modality','') not in ('telehealth','home','montreal','longueuil')
    or p_appointment->>'timeZone' is distinct from 'America/Toronto'
    or nullif(p_appointment->>'startsAt','') is null then
    raise exception 'SERVICE_APPOINTMENT_REQUIRED';
  end if;
  if p_appointment->>'modality' in ('montreal','longueuil') and nullif(btrim(p_appointment->>'address'),'') is null then
    raise exception 'SERVICE_APPOINTMENT_REQUIRED';
  end if;
  begin
    local_time := (p_appointment->>'startsAt')::timestamptz at time zone 'America/Toronto';
    if to_char(local_time,'YYYY-MM-DD"T"HH24:MI') <> (p_appointment->>'date') || 'T' || (p_appointment->>'time') then
      raise exception 'SERVICE_APPOINTMENT_REQUIRED';
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'SERVICE_APPOINTMENT_REQUIRED';
  end;
  result := public.create_waiting_list_assignment(p_waiting_list_client_id,p_professional_id,p_outcome,
    p_idempotency_key,p_assignment_process_id,p_actor_id);
  assignment_id := (result->>'assignedClientId')::uuid;
  select service_appointment into saved from public.assigned_clients where id=assignment_id for update;
  if (result->>'reused')::boolean then
    if saved is distinct from p_appointment then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  else
    update public.assigned_clients set service_appointment=p_appointment,
      meeting_modality=case p_appointment->>'modality'
        when 'telehealth' then 'Visioconférence' when 'home' then 'Présentiel à domicile'
        when 'montreal' then 'Présentiel — bureau de Montréal' else 'Présentiel — bureau de Longueuil' end,
      service_address=case when p_appointment->>'modality' in ('montreal','longueuil') then p_appointment->>'address' else service_address end
      where id=assignment_id;
    if p_assignment_process_id is not null then
      update public.assignment_process_events set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('service_appointment',p_appointment)
        where assignment_process_id=p_assignment_process_id and event_type='assigned' and metadata->>'assigned_client_id'=assignment_id::text;
    end if;
  end if;
  return result || jsonb_build_object('serviceAppointment',p_appointment);
end;
$$;
revoke all on function public.create_scheduled_waiting_list_assignment(uuid,uuid,text,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.create_scheduled_waiting_list_assignment(uuid,uuid,text,uuid,uuid,uuid,jsonb) to service_role;

-- Un professionnel ne peut pas changer les détails confirmés en modifiant son dossier.
create or replace function public.guard_service_appointment_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.service_appointment is distinct from new.service_appointment
    and auth.role() is distinct from 'service_role' and current_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501',message='Les détails du rendez-vous confirmé se modifient uniquement via un parcours serveur autorisé.';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_service_appointment_update on public.assigned_clients;
create trigger guard_service_appointment_update before update on public.assigned_clients
  for each row execute function public.guard_service_appointment_update();
commit;
