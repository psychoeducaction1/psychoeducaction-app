-- Advance opening fees are separate financial activities linked to meetings.
-- Depends on 1030 and the existing manual invoice delivery.
begin;
create table clinical.advance_opening_fee_activities (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references clinical.patients(id),
  appointment_id uuid not null unique references clinical.appointments(id),
  actor_id uuid not null references public.profiles(id),
  operation_key uuid not null unique,
  expected_version integer not null,
  total_cents integer not null check (total_cents > 0),
  created_at timestamptz not null default clock_timestamp()
);
create table clinical.advance_opening_fee_invoices (
  activity_id uuid not null references clinical.advance_opening_fee_activities(id),
  invoice_id uuid primary key references clinical.billing_invoices(id)
);
alter table clinical.advance_opening_fee_activities enable row level security;
alter table clinical.advance_opening_fee_invoices enable row level security;
revoke all on clinical.advance_opening_fee_activities,clinical.advance_opening_fee_invoices from public,anon,authenticated,service_role;
create trigger advance_opening_activity_immutable before update or delete on clinical.advance_opening_fee_activities
  for each row execute function clinical.reject_immutable_mutation();
create trigger advance_opening_invoice_immutable before update or delete on clinical.advance_opening_fee_invoices
  for each row execute function clinical.reject_immutable_mutation();

create function clinical.advance_opening_fee_json(p_id uuid) returns jsonb
language sql stable security definer set search_path='' set row_security=off as $$
  select jsonb_build_object('id',a.id,'totalCents',a.total_cents,'createdAt',a.created_at,
    'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'number',i.number::text,'amountCents',i.total_cents,
      'voided',exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=i.id)) order by i.number)
      from clinical.advance_opening_fee_invoices x join clinical.billing_invoices i on i.id=x.invoice_id
      where x.activity_id=a.id),'[]'::jsonb))
  from clinical.advance_opening_fee_activities a where a.appointment_id=p_id
$$;

create function public.clinical_prepare_advance_opening_fee(p_appointment uuid,p_expected_version integer,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare
  a clinical.appointments;
  receipt clinical.advance_opening_fee_activities;
  patient uuid; revision uuid; invoice uuid; total integer; allocated integer:=0; payer record;
begin
  perform clinical.unified_context('administration');
  if not clinical.active_actor() or not clinical.can_administer() or not clinical.finance_correction_admin() then
    raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';
  end if;
  if p_appointment is null or p_key is null or p_expected_version is null or p_expected_version<1 then
    raise exception 'CALENDAR_INVALID_INPUT' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing-batch-global',0));
  select * into receipt from clinical.advance_opening_fee_activities where operation_key=p_key;
  if found then
    if receipt.actor_id is distinct from auth.uid() or receipt.appointment_id<>p_appointment or receipt.expected_version<>p_expected_version then
      raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';
    end if;
    return clinical.advance_opening_fee_json(p_appointment);
  end if;
  select * into a from clinical.appointments where id=p_appointment;
  if a.id is null or a.is_private or a.kind<>'meeting' or a.case_id is null then
    raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar-professional/'||a.professional_id::text,0));
  select e.patient_id into patient from clinical.care_cases c join clinical.service_episodes e on e.id=c.episode_id
  where c.id=a.case_id and c.status='open' and e.status='open' for update of c;
  perform 1 from clinical.patients where id=patient for update;
  select * into a from clinical.appointments where id=p_appointment for update;
  if patient is null or a.status<>'planned' or a.start_at<=clock_timestamp() or a.version<>p_expected_version
    or exists(select 1 from clinical.appointment_removals r where r.appointment_id=a.id) then
    raise exception 'OPENING_BOOKING_CHANGED' using errcode='40001';
  end if;
  if not clinical.calendar_billable(a.id) then raise exception 'OPENING_FEE_POLICY_REQUIRED' using errcode='22023';end if;
  if exists(select 1 from clinical.billing_lines l join clinical.billing_invoices i on i.id=l.invoice_id
    where i.patient_id=patient and l.line_kind='opening_fee') then
    raise exception 'OPENING_FEE_ALREADY_PREPARED' using errcode='40001';
  end if;
  select opening_fee_cents into total from clinical.billing_settings where singleton;
  if coalesce(total,0)=0 or not exists(select 1 from clinical.opening_fee_policies where patient_id=patient and decision='charge') then
    raise exception 'OPENING_FEE_POLICY_REQUIRED' using errcode='22023';
  end if;
  revision:=clinical.billing_mandate(a.episode_id,a.professional_id,(a.start_at at time zone 'America/Toronto')::date);
  if revision is null then raise exception 'OPENING_FEE_MANDATE_REQUIRED' using errcode='22023';end if;
  perform clinical.unified_lock_financial_revision(revision);
  if revision is distinct from clinical.billing_mandate(a.episode_id,a.professional_id,(a.start_at at time zone 'America/Toronto')::date)
    or not clinical.unified_mandate_financial_ready(revision)
    or (select coalesce(sum(basis_points),0) from clinical.mandate_payers where revision_id=revision)<>10000 then
    raise exception 'OPENING_FEE_MANDATE_REQUIRED' using errcode='22023';
  end if;
  insert into clinical.advance_opening_fee_activities(patient_id,appointment_id,actor_id,operation_key,expected_version,total_cents)
  values(patient,a.id,auth.uid(),p_key,a.version,total) returning * into receipt;
  for payer in select * from clinical.unified_activity_allocation(revision,null,total) where amount_cents>0 loop
    -- Issue separately, so it cannot merge with an existing draft for services.
    insert into clinical.billing_invoices(patient_id,case_id,professional_id,payer_person_id,payer_name,payer_basis_points,
      status,number,closed_at,total_cents)
    values(patient,a.case_id,a.professional_id,payer.person_id,payer.full_name,payer.basis_points,
      'closed',nextval('clinical.billing_number_seq'),receipt.created_at,payer.amount_cents)
    returning id into invoice;
    insert into clinical.billing_lines(invoice_id,appointment_id,mandate_revision_id,service_at,service_label,amount_cents,line_kind)
    values(invoice,a.id,revision,receipt.created_at,'Frais d’ouverture de dossier',payer.amount_cents,'opening_fee');
    insert into clinical.advance_opening_fee_invoices(activity_id,invoice_id) values(receipt.id,invoice);
    perform clinical.unified_archive_billing_invoice(invoice);
    allocated:=allocated+payer.amount_cents;
  end loop;
  if allocated<>total then raise exception 'OPENING_FEE_MANDATE_REQUIRED' using errcode='22023';end if;
  return clinical.advance_opening_fee_json(a.id);
end $$;

create function public.clinical_unified_calendar_query_1060(p_context text,p_from_date date,p_to_date date) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare q jsonb; previous text;begin
  previous:=clinical.unified_calendar_context(p_context);
  q:=public.clinical_unified_calendar_query_1030(p_context,p_from_date,p_to_date);
  if p_context='administration' and clinical.can_administer() then
    q:=jsonb_set(q,'{workspace,appointments}',(select coalesce(jsonb_agg(e||jsonb_build_object('openingFeeActivity',
      clinical.advance_opening_fee_json((e->>'id')::uuid)) order by ord),'[]')
      from jsonb_array_elements(q->'workspace'->'appointments') with ordinality t(e,ord)));
  end if;
  perform set_config('pea.clinical_context',previous,true);return q;
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;
end $$;

do $patch$
declare original text; needle text; begin
  original:=pg_get_functiondef('clinical.manual_invoice_envelope(uuid)'::regprocedure);
  needle:='where l.invoice_id=i.id and (a.end_at>clock_timestamp() or a.status=''planned'')';
  if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'OPENING_ENVELOPE_SOURCE_CHANGED';end if;
  execute replace(original,needle,needle||' and not exists(select 1 from clinical.advance_opening_fee_invoices af where af.invoice_id=i.id and l.line_kind=''opening_fee'')');

  -- Reclassifying a meeting does not invalidate the distinct opening activity.
  original:=pg_get_functiondef('clinical.declare_not_held(text,uuid,uuid,jsonb)'::regprocedure);
  needle:='where id in(select invoice_id from clinical.billing_lines where appointment_id=a.id)
 and not exists(select 1 from clinical.billing_invoice_voids';
  if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'OPENING_OUTCOME_SOURCE_CHANGED';end if;
  execute replace(original,needle,replace(needle,' and not exists(select 1 from clinical.billing_invoice_voids',
    ' and not exists(select 1 from clinical.advance_opening_fee_invoices af where af.invoice_id=billing_invoices.id)'
    ||' and not exists(select 1 from clinical.billing_invoice_voids'));
  original:=pg_get_functiondef('clinical.unified_open_finance_guard()'::regprocedure);
  needle:='where l.appointment_id=old.appointment_id
 and not exists(select 1 from clinical.billing_invoice_voids';
  if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'OPENING_FINANCE_GUARD_SOURCE_CHANGED';end if;
  execute replace(original,needle,replace(needle,' and not exists(select 1 from clinical.billing_invoice_voids',
    ' and not exists(select 1 from clinical.advance_opening_fee_invoices af where af.invoice_id=l.invoice_id)'
    ||' and not exists(select 1 from clinical.billing_invoice_voids'));
  original:=pg_get_functiondef('clinical.calendar_financial_apply(uuid,text,jsonb,jsonb)'::regprocedure);
  needle:='where s.appointment_id=a.id and i.status=''closed''';
  if length(original)-length(replace(original,needle,''))<>2*length(needle) then raise exception 'OPENING_ABSENCE_FINANCE_SOURCE_CHANGED';end if;
  execute replace(original,needle,needle||' and not (s.line_kind=''opening_fee'' and exists(select 1 from clinical.advance_opening_fee_invoices af where af.invoice_id=i.id))');
  original:=pg_get_functiondef('clinical.not_held_state(uuid)'::regprocedure);
  needle:='clinical.encounter_removal_state(a.id)';
  if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'OPENING_PREVIEW_SOURCE_CHANGED';end if;
  execute replace(original,needle,
    'jsonb_set(clinical.encounter_removal_state(a.id),''{invoices}'',(select coalesce(jsonb_agg(x),''[]'') from jsonb_array_elements(clinical.encounter_removal_state(a.id)->''invoices'') x where not exists(select 1 from clinical.advance_opening_fee_invoices af where af.invoice_id=(x->>''id'')::uuid)))');
end $patch$;

revoke all on function clinical.advance_opening_fee_json(uuid) from public,anon,authenticated,service_role;
revoke all on function public.clinical_prepare_advance_opening_fee(uuid,integer,uuid), public.clinical_unified_calendar_query_1060(text,date,date) from public,anon,service_role;
grant execute on function public.clinical_prepare_advance_opening_fee(uuid,integer,uuid), public.clinical_unified_calendar_query_1060(text,date,date) to authenticated;
notify pgrst,'reload schema';
commit;
