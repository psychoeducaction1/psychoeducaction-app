-- Prepared migration: no production application without explicit authorization.
-- Originals remain immutable. Removal/void/payment corrections are append-only.
begin;
do $$begin
 if to_regprocedure('public.clinical_unified_calendar_command_870_base(text,text,uuid,jsonb,uuid)') is not null then raise exception 'CORRECTIONS_ALREADY_INSTALLED';end if;
 if md5(pg_get_functiondef('clinical.guard_appointment()'::regprocedure))<>'5da250d8317ec8e2e53efde430b0fa88' then raise exception 'CORRECTIONS_SOURCE_CHANGED';end if;
 if md5(pg_get_functiondef('clinical.unified_billing_reconcile_one(uuid,date,uuid)'::regprocedure))<>'578a0bbf230da40b508cfe27aec1e1e9' then raise exception 'CORRECTIONS_SOURCE_CHANGED';end if;
 if to_regclass('clinical.note_removals') is null or to_regclass('clinical.billing_payments') is null or to_regprocedure('clinical.unified_billing_reconcile_one(uuid,date,uuid)') is null then raise exception 'CORRECTIONS_PREREQUISITES_MISSING';end if;
end $$;
create table clinical.appointment_removals(
 appointment_id uuid primary key references clinical.appointments(id),removed_by uuid not null references public.profiles(id),removed_at timestamptz not null default clock_timestamp(),appointment_version integer not null,reason text not null check(length(reason) between 1 and 500),command_key uuid not null unique
);
create table clinical.billing_invoice_voids(
 invoice_id uuid primary key references clinical.billing_invoices(id),voided_by uuid not null references public.profiles(id),voided_at timestamptz not null default clock_timestamp(),reason text not null check(length(reason) between 1 and 500),removed_appointment_id uuid references clinical.appointments(id),replacement_invoice_id uuid references clinical.billing_invoices(id)
);
create table clinical.billing_payment_corrections(
 id bigint generated always as identity primary key,payment_id uuid not null references clinical.billing_payments(id),action text not null check(action in('remove','restore')),actor_id uuid not null references public.profiles(id),at timestamptz not null default clock_timestamp(),reason text not null check(length(reason) between 1 and 500),command_key uuid not null unique
);
revoke all on sequence clinical.billing_payment_corrections_id_seq from public,anon,authenticated,service_role;
create index billing_payment_correction_latest on clinical.billing_payment_corrections(payment_id,id desc);
create table clinical.correction_commands(
 command_key uuid primary key,actor_id uuid not null references public.profiles(id),intent_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
do $$declare t text;begin
 foreach t in array array['appointment_removals','billing_invoice_voids','billing_payment_corrections','correction_commands'] loop
  execute format('alter table clinical.%I enable row level security',t);
  execute format('revoke all on clinical.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger correction_history_immutable before update or delete on clinical.%I for each row execute function clinical.reject_immutable_mutation()',t);
  execute format('create trigger correction_history_no_truncate before truncate on clinical.%I for each statement execute function clinical.reject_immutable_mutation()',t);
 end loop;
end $$;
create function clinical.finance_correction_admin() returns boolean language sql stable security definer set search_path='' set row_security=off as $$
 select clinical.active_actor() and exists(select 1 from public.profiles p join clinical.actor_capabilities a on a.profile_id=p.id where p.id=auth.uid() and (p.administrative_access in('direction','super_admin') or a.actor_kind='admin' and a.manage_patients or p.role='direction' and a.actor_kind<>'assistant'))
$$;
create function clinical.payment_is_removed(p_payment uuid) returns boolean language sql stable security definer set search_path='' set row_security=off as $$
 select coalesce((select action='remove' from clinical.billing_payment_corrections where payment_id=p_payment order by id desc limit 1),false)
$$;
create function clinical.can_remove_appointment(p_id uuid,p_context text) returns boolean language sql stable security definer set search_path='' set row_security=off as $$
 select clinical.active_actor() and p_context='clinical' and not exists(select 1 from clinical.appointment_removals where appointment_id=p_id) and exists(
 select 1 from clinical.appointments a where a.id=p_id and a.professional_id=auth.uid() and (a.episode_id is null or exists(select 1 from clinical.care_cases c join clinical.case_access_grants g on g.case_id=c.id where c.episode_id=a.episode_id and c.status='open' and g.profile_id=auth.uid() and g.can_write and g.revoked_at is null))
 and not exists(select 1 from clinical.notes n where n.appointment_id=a.id and n.author_id<>auth.uid() and not exists(select 1 from clinical.note_removals r where r.note_id=n.id)))
$$;
create function clinical.encounter_removal_state(p_id uuid) returns jsonb language sql stable security definer set search_path='' set row_security=off as $$
 select jsonb_build_object('appointmentId',a.id,'version',a.version,
 'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'version',n.version,'status',n.status) order by n.id) from clinical.notes n where n.appointment_id=a.id and not exists(select 1 from clinical.note_removals r where r.note_id=n.id)),'[]'),
 'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'version',i.version,'paid',i.paid_cents>0,'replacement',exists(select 1 from clinical.billing_lines l where l.invoice_id=i.id and l.appointment_id<>a.id and not exists(select 1 from clinical.appointment_removals r where r.appointment_id=l.appointment_id))) order by i.id) from clinical.billing_invoices i where exists(select 1 from clinical.billing_lines l where l.invoice_id=i.id and l.appointment_id=a.id) and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=i.id)),'[]'))
 from clinical.appointments a where a.id=p_id
$$;
create function public.clinical_unified_encounter_removal_preview(p_context text,p_appointment_id uuid) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare s jsonb;previous text;begin
 previous:=clinical.unified_calendar_context(p_context);
 if not clinical.can_remove_appointment(p_appointment_id,p_context) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 s:=clinical.encounter_removal_state(p_appointment_id);
 perform set_config('pea.clinical_context',previous,true);
 return jsonb_build_object('appointmentId',p_appointment_id,'version',(s->>'version')::integer,'hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'),'noteCount',jsonb_array_length(s->'notes'),'signedNoteCount',(select count(*) from jsonb_array_elements(s->'notes') n where n->>'status'<>'draft'),'invoiceCount',jsonb_array_length(s->'invoices'),'paidInvoiceCount',(select count(*) from jsonb_array_elements(s->'invoices') i where(i->>'paid')::boolean),'replacementInvoiceCount',(select count(*) from jsonb_array_elements(s->'invoices') i where(i->>'replacement')::boolean));
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $$;
create function clinical.void_invoice_for_correction(p_id uuid,p_appointment uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' set row_security=off as $$
declare i clinical.billing_invoices;replacement uuid;remaining bigint;begin
 select * into i from clinical.billing_invoices where id=p_id for update;
 if i.id is null then raise exception 'CLINICAL_INVOICE_NOT_FOUND' using errcode='22023';end if;
 if exists(select 1 from clinical.billing_invoice_voids where invoice_id=i.id) then raise exception 'INVOICE_ALREADY_VOIDED' using errcode='40001';end if;
 if i.status='open' then update clinical.billing_invoices set status='closed',number=coalesce(number,nextval('clinical.billing_number_seq')),closed_at=coalesce(closed_at,clock_timestamp()),version=version+1 where id=i.id;
 else update clinical.billing_invoices set version=version+1 where id=i.id;end if;
 if p_appointment is not null then
  select coalesce(sum(amount_cents),0) into remaining from clinical.billing_lines l where l.invoice_id=i.id and l.appointment_id<>p_appointment and not exists(select 1 from clinical.appointment_removals r where r.appointment_id=l.appointment_id);
  if remaining>0 then
   -- Reuse the payer's existing open group if present, preserving its other lines.
   select id into replacement from clinical.billing_invoices where case_id=i.case_id and professional_id=i.professional_id and payer_person_id=i.payer_person_id and status='open' for update;
   if replacement is null then
    insert into clinical.billing_invoices(patient_id,case_id,professional_id,payer_person_id,payer_name,payer_basis_points,currency) values(i.patient_id,i.case_id,i.professional_id,i.payer_person_id,i.payer_name,i.payer_basis_points,i.currency) returning id into replacement;
   end if;
   insert into clinical.billing_lines(invoice_id,appointment_id,mandate_revision_id,service_at,service_label,amount_cents,line_kind)
   select replacement,l.appointment_id,l.mandate_revision_id,l.service_at,l.service_label,l.amount_cents,l.line_kind from clinical.billing_lines l where l.invoice_id=i.id and l.appointment_id<>p_appointment and not exists(select 1 from clinical.appointment_removals r where r.appointment_id=l.appointment_id) and not exists(select 1 from clinical.billing_lines x where x.invoice_id=replacement and x.appointment_id=l.appointment_id and x.line_kind=l.line_kind);
   update clinical.billing_invoices set total_cents=(select coalesce(sum(amount_cents),0) from clinical.billing_lines where invoice_id=replacement),version=version+1 where id=replacement;
  end if;
 end if;
 insert into clinical.billing_invoice_voids(invoice_id,voided_by,reason,removed_appointment_id,replacement_invoice_id) values(i.id,auth.uid(),p_reason,p_appointment,replacement);
 return replacement;
end $$;
-- A signed note stays immutable. Only its removal marker is inserted.
create function clinical.encounter_remove(p_context text,p_key uuid,p_id uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare a clinical.appointments;i clinical.billing_invoices;s jsonb;previous text;intent text;receipt clinical.correction_commands;result jsonb;replacement uuid;begin
 previous:=clinical.unified_calendar_context(p_context);
 if p_key is null or p_data is null or jsonb_typeof(p_data)<>'object' or p_data->'confirmed' is distinct from 'true'::jsonb or (select count(*) from jsonb_object_keys(p_data))<>3 then raise exception 'CLINICAL_INVALID_INPUT' using errcode='22023';end if;
 if exists(select 1 from clinical.calendar_privacy_receipts where actor_id=auth.uid() and request_key=p_key) then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
 intent:=encode(sha256(convert_to(jsonb_build_array(p_context,'appointments.remove',p_id,p_data)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into receipt from clinical.correction_commands where command_key=p_key;
 if found then if receipt.actor_id<>auth.uid() or receipt.intent_hash<>intent then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;perform set_config('pea.clinical_context',previous,true);return receipt.result;end if;
 select * into a from clinical.appointments where id=p_id;
 if not clinical.can_remove_appointment(p_id,p_context) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('calendar-professional/'||a.professional_id::text,0));
 if a.episode_id is not null then perform 1 from clinical.service_episodes where id=a.episode_id for update;perform 1 from clinical.care_cases where episode_id=a.episode_id order by id for update;end if;
 select * into a from clinical.appointments where id=p_id for update;
 perform 1 from clinical.notes where appointment_id=a.id order by id for update;
 perform 1 from clinical.billing_invoices where id in(select invoice_id from clinical.billing_lines where appointment_id=a.id) order by id for update;
 if not clinical.can_remove_appointment(p_id,p_context) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 s:=clinical.encounter_removal_state(p_id);
 if a.version is distinct from(p_data->>'expectedVersion')::integer or encode(sha256(convert_to(s::text,'UTF8')),'hex') is distinct from p_data->>'previewHash' then raise exception 'REMOVAL_PREVIEW_CHANGED' using errcode='40001';end if;
 insert into clinical.appointment_removals(appointment_id,removed_by,appointment_version,reason,command_key) values(a.id,auth.uid(),a.version,'Rencontre créée par erreur',p_key);
 insert into clinical.note_removals(note_id,removed_by,note_version) select n.id,auth.uid(),n.version from clinical.notes n where n.appointment_id=a.id and not exists(select 1 from clinical.note_removals r where r.note_id=n.id);
 for i in select * from clinical.billing_invoices where id in(select invoice_id from clinical.billing_lines where appointment_id=a.id) and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=billing_invoices.id) order by id loop
  if i.professional_id<>a.professional_id or not exists(select 1 from clinical.care_cases c where c.id=i.case_id and c.episode_id=a.episode_id and clinical.has_case_access(c.id,'write')) then raise exception 'FINANCIAL_LINK_REVIEW_REQUIRED' using errcode='40001';end if;
  replacement:=clinical.void_invoice_for_correction(i.id,a.id,'Rencontre créée par erreur');
 end loop;
 update clinical.appointments set status='cancelled',cancelled_at=coalesce(cancelled_at,clock_timestamp()),cancellation_reason='professional',version=version+1,updated_at=clock_timestamp() where id=a.id;
 result:=jsonb_build_object('mode','isolated_unified','durable',true,'actorId',auth.uid(),'context',p_context,'result',jsonb_build_object('kind','appointment','id',a.id,'affectedIds',jsonb_build_array(a.id),'version',a.version+1));
 insert into clinical.correction_commands(command_key,actor_id,intent_hash,result) values(p_key,auth.uid(),intent,result);
 perform set_config('pea.clinical_context',previous,true);return result;
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $$;
create function clinical.guard_removed_encounter_note() returns trigger language plpgsql security definer set search_path='' set row_security=off as $$begin
 if new.appointment_id is not null and exists(select 1 from clinical.appointment_removals where appointment_id=new.appointment_id) then raise exception 'APPOINTMENT_REMOVED' using errcode='40001';end if;return new;end $$;
create trigger removed_encounter_note_guard before insert or update on clinical.notes for each row execute function clinical.guard_removed_encounter_note();
create function clinical.guard_removed_encounter_billing_line() returns trigger language plpgsql security definer set search_path='' set row_security=off as $$begin
 if exists(select 1 from clinical.appointment_removals where appointment_id=new.appointment_id) then raise exception 'APPOINTMENT_REMOVED' using errcode='40001';end if;return new;end $$;
create trigger removed_encounter_billing_guard before insert on clinical.billing_lines for each row execute function clinical.guard_removed_encounter_billing_line();
alter function public.clinical_unified_calendar_command(text,text,uuid,jsonb,uuid) rename to clinical_unified_calendar_command_870_base;
create function public.clinical_unified_calendar_command(p_context text,p_action text,p_id uuid,p_data jsonb,p_request_key uuid) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare previous text;result jsonb;begin
 previous:=clinical.unified_calendar_context(p_context);
 if p_action='appointments.remove' then result:=clinical.encounter_remove(p_context,p_request_key,p_id,p_data);
 else
  if exists(select 1 from clinical.appointment_removals where appointment_id=p_id) then raise exception 'APPOINTMENT_REMOVED' using errcode='40001';end if;
  result:=public.clinical_unified_calendar_command_870_base(p_context,p_action,p_id,p_data,p_request_key);
 end if;
 perform set_config('pea.clinical_context',previous,true);return result;
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $$;
create function public.clinical_unified_calendar_query_870(p_context text,p_from_date date,p_to_date date) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$declare q jsonb;begin
 q:=public.clinical_unified_calendar_query(p_context,p_from_date,p_to_date);
 return jsonb_set(q,'{workspace,appointments}',(select coalesce(jsonb_agg(e||jsonb_build_object('canRemove',clinical.can_remove_appointment((e->>'id')::uuid,p_context)) order by ord),'[]') from jsonb_array_elements(q->'workspace'->'appointments') with ordinality t(e,ord) where not exists(select 1 from clinical.appointment_removals r where r.appointment_id=(e->>'id')::uuid)));
end $$;
-- Finance mutations are restricted in SQL, including the older direct payment RPC.
alter function public.clinical_billing_payment(uuid,uuid,integer,text,timestamptz,integer) rename to clinical_billing_payment_870_base;
create function public.clinical_billing_payment(p_invoice_id uuid,p_operation_key uuid,p_amount_cents integer,p_method text,p_received_at timestamptz,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$begin
 if not clinical.finance_correction_admin() or not clinical.can_administer() then raise exception 'PAYMENT_ADMIN_REQUIRED' using errcode='42501';end if;
 perform 1 from clinical.billing_invoices where id=p_invoice_id for update;
 if exists(select 1 from clinical.billing_invoice_voids where invoice_id=p_invoice_id) then raise exception 'INVOICE_VOIDED' using errcode='40001';end if;
 if exists(select 1 from clinical.billing_invoice_voids v join clinical.billing_invoices i on i.id=v.invoice_id where v.replacement_invoice_id=p_invoice_id and i.paid_cents>0) then raise exception 'REPLACEMENT_PAYMENT_REVIEW_REQUIRED' using errcode='40001';end if;
 return public.clinical_billing_payment_870_base(p_invoice_id,p_operation_key,p_amount_cents,p_method,p_received_at,p_expected_version);end $$;
create function clinical.finance_correct(p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare i clinical.billing_invoices;p clinical.billing_payments;receipt clinical.correction_commands;intent text;result jsonb;paid bigint;refunded bigint;pro uuid;begin
 if not clinical.finance_correction_admin() or not clinical.can_administer() then raise exception 'PAYMENT_ADMIN_REQUIRED' using errcode='42501';end if;
 if p_key is null or p_data is null or p_data->'confirmed' is distinct from 'true'::jsonb or coalesce(length(btrim(p_data->>'reason')),0) not between 1 and 500 then raise exception 'CLINICAL_INVALID_INPUT' using errcode='22023';end if;
 if exists(select 1 from clinical.unified_finance_commands where operation_key=p_key) then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
 intent:=encode(sha256(convert_to(jsonb_build_array(p_action,p_data)::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into receipt from clinical.correction_commands where command_key=p_key;
 if found then if receipt.actor_id<>auth.uid() or receipt.intent_hash<>intent then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;return receipt.result;end if;
 select professional_id into pro from clinical.billing_invoices where id=(p_data->>'invoiceId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('calendar-professional/'||pro::text,0));
 select * into i from clinical.billing_invoices where id=(p_data->>'invoiceId')::uuid for update;
 if i.id is null or i.version is distinct from(p_data->>'expectedVersion')::integer then raise exception 'CLINICAL_VERSION_CONFLICT' using errcode='40001';end if;
 if p_action='invoice.void' then perform clinical.void_invoice_for_correction(i.id,null,btrim(p_data->>'reason'));
 elsif p_action in('payment.remove','payment.restore') then
  select * into p from clinical.billing_payments where id=(p_data->>'paymentId')::uuid and invoice_id=i.id for share;
  if p.id is null then raise exception 'CLINICAL_PAYMENT_INVALID' using errcode='22023';end if;
  if clinical.payment_is_removed(p.id) is distinct from(p_action='payment.restore') then raise exception 'PAYMENT_CORRECTION_CHANGED' using errcode='40001';end if;
  paid:=i.paid_cents+case when p_action='payment.restore' then p.amount_cents else -p.amount_cents end;
  select coalesce(sum(amount_cents),0) into refunded from clinical.unified_billing_adjustments where invoice_id=i.id and kind='refund';
  if paid<refunded or paid<0 or paid>i.total_cents then raise exception 'PAYMENT_CORRECTION_BALANCE_INVALID' using errcode='40001';end if;
  insert into clinical.billing_payment_corrections(payment_id,action,actor_id,reason,command_key) values(p.id,case when p_action='payment.remove' then 'remove' else 'restore' end,auth.uid(),btrim(p_data->>'reason'),p_key);
  update clinical.billing_invoices set paid_cents=paid,version=version+1 where id=i.id;
 else raise exception 'CLINICAL_INVALID_INPUT' using errcode='22023';end if;
 select * into i from clinical.billing_invoices where id=i.id;
 result:=jsonb_build_object('ok',true,'action',p_action,'id',i.id,'version',i.version,'affectedInvoiceIds',jsonb_build_array(i.id));
 insert into clinical.correction_commands(command_key,actor_id,intent_hash,result) values(p_key,auth.uid(),intent,result);return result;
end $$;
alter function public.clinical_unified_finance_command(uuid,text,jsonb) rename to clinical_unified_finance_command_870_base;
create function public.clinical_unified_finance_command(p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$begin
 if not clinical.can_administer() then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 if p_action in('payment.remove','payment.restore','invoice.void') then return clinical.finance_correct(p_key,p_action,p_data);end if;
 if p_action in('payment.record','refund.record') and (not clinical.finance_correction_admin() or not clinical.can_administer()) then raise exception 'PAYMENT_ADMIN_REQUIRED' using errcode='42501';end if;
 if p_data?'invoiceId' then
  perform 1 from clinical.billing_invoices where id=(p_data->>'invoiceId')::uuid for update;
  if exists(select 1 from clinical.billing_invoice_voids where invoice_id=(p_data->>'invoiceId')::uuid) then raise exception 'INVOICE_VOIDED' using errcode='40001';end if;
  if p_action in('invoice.issue','invoice.send_demo','payment.record') and exists(select 1 from clinical.billing_invoice_voids v join clinical.billing_invoices i on i.id=v.invoice_id where v.replacement_invoice_id=(p_data->>'invoiceId')::uuid and i.paid_cents>0) then raise exception 'REPLACEMENT_PAYMENT_REVIEW_REQUIRED' using errcode='40001';end if;
 end if;
 if exists(select 1 from clinical.correction_commands where command_key=p_key) then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
 return public.clinical_unified_finance_command_870_base(p_key,p_action,p_data);end $$;
create function public.clinical_unified_billing_data_870() returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$declare q jsonb;begin
 q:=public.clinical_unified_billing_data();
 q:=jsonb_set(q,'{invoices}',(select coalesce(jsonb_agg(x||jsonb_build_object('voidedAt',v.voided_at,'voidReason',v.reason,'replacementInvoiceId',v.replacement_invoice_id,'dueCents',case when v.invoice_id is not null then '0'::jsonb else x->'dueCents' end,'refundableCents',case when v.invoice_id is not null then '0'::jsonb else x->'refundableCents' end,'paymentReviewInvoiceIds',coalesce((select jsonb_agg(ov.invoice_id order by ov.invoice_id) from clinical.billing_invoice_voids ov join clinical.billing_invoices oi on oi.id=ov.invoice_id where ov.replacement_invoice_id=(x->>'id')::uuid and oi.paid_cents>0),'[]'::jsonb),'lastPaymentAt',lp.received_at,'lastPaymentCents',coalesce(lp.amount_cents,0)) order by ord),'[]') from jsonb_array_elements(q->'invoices') with ordinality t(x,ord) left join clinical.billing_invoice_voids v on v.invoice_id=(x->>'id')::uuid left join lateral(select p.* from clinical.billing_payments p where p.invoice_id=(x->>'id')::uuid and not clinical.payment_is_removed(p.id) order by p.recorded_at desc,p.id desc limit 1)lp on true));
 q:=jsonb_set(q,'{ledger}',(select coalesce(jsonb_agg(x||jsonb_build_object('removedAt',case when x->>'kind'='payment' and clinical.payment_is_removed((x->>'id')::uuid) then(select at from clinical.billing_payment_corrections where payment_id=(x->>'id')::uuid order by id desc limit 1)end) order by ord),'[]') from jsonb_array_elements(q->'ledger') with ordinality t(x,ord)));
 q:=jsonb_set(q,'{eligibleActivities}',(select coalesce(jsonb_agg(x order by ord),'[]') from jsonb_array_elements(coalesce(q->'eligibleActivities','[]')) with ordinality t(x,ord) where not exists(select 1 from clinical.appointment_removals r where r.appointment_id=(x->>'appointmentId')::uuid)));
 return q||jsonb_build_object('canManagePayments',clinical.finance_correction_admin());end $$;
alter function public.clinical_unified_fee_quote(uuid,date,date,uuid) rename to clinical_unified_fee_quote_870_base;
create function public.clinical_unified_fee_quote(p_professional_id uuid default null,p_from date default null,p_to date default null,p_statement_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' set row_security=off as $$declare q jsonb;s jsonb;begin
 q:=public.clinical_unified_fee_quote_870_base(p_professional_id,p_from,p_to,p_statement_id);
 select coalesce(jsonb_agg(x order by ord),'[]') into s from jsonb_array_elements(q->'inputs'->'sources') with ordinality t(x,ord) where not exists(select 1 from clinical.appointment_removals r where r.appointment_id=coalesce(nullif(x->>'meetingId','')::uuid,(select appointment_id from clinical.fee_adjustments where id=(x->>'id')::uuid))) and (not exists(select 1 from clinical.billing_lines l where l.appointment_id=coalesce(nullif(x->>'meetingId','')::uuid,(select appointment_id from clinical.fee_adjustments where id=(x->>'id')::uuid))) or exists(select 1 from clinical.billing_lines l where l.appointment_id=coalesce(nullif(x->>'meetingId','')::uuid,(select appointment_id from clinical.fee_adjustments where id=(x->>'id')::uuid)) and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=l.invoice_id)));
 -- Recompute both fingerprints: the existing fee engine detects stale prepared statements.
 q:=jsonb_set(q,'{inputs,sources}',s);q:=jsonb_set(q,'{inputs,fingerprint}',to_jsonb(encode(sha256(convert_to(s::text,'UTF8')),'hex')));
 return jsonb_set(q,'{inputHash}',to_jsonb(encode(sha256(convert_to((q-'inputHash'-'statementId')::text,'UTF8')),'hex')));end $$;
CREATE OR REPLACE FUNCTION clinical.guard_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin
 if tg_op='DELETE' then raise exception 'CLINICAL_APPOINTMENT_HISTORY_REQUIRED' using errcode='42501';end if;
 if tg_op='INSERT' and new.case_id is not null then
   if new.episode_id is null then
     select episode_id into new.episode_id from clinical.care_cases where id=new.case_id;
   elsif not exists(select 1 from clinical.care_cases where id=new.case_id and episode_id=new.episode_id) then
     raise exception 'CALENDAR_EPISODE_CASE_MISMATCH' using errcode='22023';
   end if;
 end if;
 if tg_op='UPDATE' and new.status='cancelled' and new.cancellation_reason='professional' and new.cancelled_at is not null and new.version=old.version+1
 and (to_jsonb(new)-array['status','cancelled_at','cancellation_reason','version','updated_at'])=(to_jsonb(old)-array['status','cancelled_at','cancellation_reason','version','updated_at'])
 and exists(select 1 from clinical.appointment_removals r where r.appointment_id=old.id and r.appointment_version=old.version and r.removed_by=auth.uid()) then return new;end if;
 if tg_op='UPDATE' then
 if current_setting('pea.calendar_upgrade',true)='episode_backfill' and(old.episode_id is null and new.episode_id is not null or old.occurrence_index is null and new.occurrence_index is not null)
 and(to_jsonb(new)-'episode_id'-'occurrence_index')=(to_jsonb(old)-'episode_id'-'occurrence_index') then return new;end if;
 if current_setting('pea.calendar_activity_pro_change',true)='validated' and old.status='planned' and new.professional_id<>old.professional_id
 and new.version=old.version+1 and new.created_at=old.created_at
 and(to_jsonb(new)-'professional_id'-'version'-'updated_at')=(to_jsonb(old)-'professional_id'-'version'-'updated_at')
 and clinical.calendar_can_change_professional(old.id) then return new;end if;
 if old.status<>'planned' or new.episode_id is distinct from old.episode_id or new.case_id is distinct from old.case_id or new.kind<>old.kind or new.professional_id<>old.professional_id or new.series_id is distinct from old.series_id or new.created_at<>old.created_at or new.occurrence_index is distinct from old.occurrence_index then raise exception 'CLINICAL_APPOINTMENT_FROZEN' using errcode='42501';end if;
 if new.version<>old.version+1 then raise exception 'CALENDAR_VERSION_CONFLICT' using errcode='40001';end if;end if;
 new.busy_start:=new.start_at-make_interval(mins=>new.travel_before_minutes);new.busy_end:=new.end_at+make_interval(mins=>new.travel_after_minutes);return new;
end $function$
;
CREATE OR REPLACE FUNCTION clinical.unified_billing_reconcile_one(p_case_id uuid, p_through date, p_only uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare a clinical.appointments;r clinical.mandate_revisions;v clinical.appointment_financial_versions;
 ac clinical.calendar_activities;x clinical.appointment_absences;rt clinical.unified_service_rates;tr clinical.unified_service_rates;
 v_patient uuid;rid uuid;amount integer;travel integer;minutes integer;unit_rate integer;reference integer;v_rate integer;
 v_count integer:=0;v_invoice uuid;p record;t record;day date;label text;line_kind text;
begin
 if p_through is null or p_through>(clock_timestamp() at time zone 'America/Toronto')::date then raise exception 'BILLING_INVALID_INPUT' using errcode='22023';end if;
 select e.patient_id into v_patient from clinical.care_cases c join clinical.service_episodes e on e.id=c.episode_id where c.id=p_case_id for update of c;
 if v_patient is null then raise exception 'CLINICAL_CASE_NOT_AVAILABLE' using errcode='22023';end if;
 for a in select * from clinical.appointments where case_id=p_case_id and(p_only is null or id=p_only) and kind in('meeting','documentation')
 and (end_at at time zone 'America/Toronto')::date+1<=p_through and status in('completed','cancelled','no_show') order by start_at,id loop
  if exists(select 1 from clinical.appointment_removals removed_870 where removed_870.appointment_id=a.id) then continue;end if;
  if exists(select 1 from clinical.billing_lines bl where bl.appointment_id=a.id and bl.line_kind<>'opening_fee') or not clinical.calendar_billable(a.id) then continue;end if;
  day:=(a.start_at at time zone 'America/Toronto')::date;
  select fv.* into v from clinical.appointment_financial_settings s join clinical.appointment_financial_versions fv on fv.id=s.current_version_id where s.appointment_id=a.id;
  select * into ac from clinical.calendar_activities where appointment_id=a.id for share;
  select * into x from clinical.appointment_absences where appointment_id=a.id;
  if a.status in('cancelled','no_show') then
   if x.id is null or x.fee_percent=0 then continue;end if;
   select mandate_revision_id into rid from clinical.financial_conditions_versions where id=x.conditions_id;
   minutes:=extract(epoch from(a.end_at-a.start_at))::integer/60;
   line_kind:='cancellation';label:=case x.kind when 'no_show' then 'Absence' else 'Annulation à moins de 24 h' end||' — '||x.fee_percent||' % du créneau réservé';
  else
   if ac.id is null then continue;end if;
   rid:=clinical.billing_mandate(a.episode_id,a.professional_id,day);minutes:=ac.actual_minutes;line_kind:='service';
  end if;
  perform clinical.unified_lock_financial_revision(rid);
  if line_kind='service' and rid is distinct from clinical.billing_mandate(a.episode_id,a.professional_id,day) then
   raise exception 'ACTIVITY_FINANCE_MANDATE_CHANGED' using errcode='40001';
  end if;
  select * into r from clinical.mandate_revisions where id=rid and clinical.unified_mandate_financial_ready(id) and professional_id=a.professional_id;
  if r.id is null or r.rate_cents is null or not exists(select 1 from clinical.mandates where id=r.mandate_id and episode_id=a.episode_id) then raise exception 'BILLING_FINANCIAL_TERMS_REQUIRED' using errcode='40001';end if;
  if v.mandate_revision_id is not null and v.mandate_revision_id<>rid then raise exception 'ACTIVITY_FINANCE_MANDATE_CHANGED' using errcode='40001';end if;
  select * into rt from clinical.unified_service_rates where id=(r.unified_draft->>'rateId')::uuid;
  if rt.id is not null and rt.unit<>'hour' then raise exception 'BILLING_RATE_UNSUPPORTED' using errcode='40001';end if;
  unit_rate:=coalesce(v.hourly_rate_cents,r.rate_cents);reference:=case when v.hourly_rate_cents is not null then 60 else coalesce(rt.reference_minutes,60) end;
  amount:=round(unit_rate::numeric*minutes/reference*case when line_kind='cancellation' then x.fee_percent::numeric/100 else 1 end)::integer;travel:=0;
  if amount<=0 then raise exception 'BILLING_RATE_UNSUPPORTED' using errcode='40001';end if;
  if line_kind='service' then
   label:=case when a.kind='documentation' then 'Rédaction de rapport — ' else '' end||r.service_label;
   if ac.travel_kilometers>0 then
    select ur.* into tr from clinical.unified_service_rates ur join clinical.unified_service_catalogue s on s.id=ur.service_id where s.code='travel' and ur.effective_from<=day order by ur.effective_from desc limit 1;
    if tr.id is null or tr.unit<>'km' then raise exception 'BILLING_TRAVEL_RATE_REQUIRED' using errcode='40001';end if;
    travel:=round(ac.travel_kilometers*tr.amount_cents)::integer;
   end if;
  end if;
  if (select coalesce(sum(coalesce(fp.basis_points,mp.basis_points)),0) from clinical.mandate_payers mp left join clinical.appointment_financial_payers fp on fp.version_id=v.id and fp.person_id=mp.person_id where mp.revision_id=rid)<>10000 then raise exception 'BILLING_PAYER_TOTAL' using errcode='22023';end if;
  for p in select * from clinical.unified_activity_allocation(rid,v.id,amount) loop
   select * into t from clinical.unified_activity_allocation(rid,v.id,travel) where person_id=p.person_id;
   if p.amount_cents+coalesce(t.amount_cents,0)=0 then continue;end if;
   select id into v_invoice from clinical.billing_invoices where case_id=p_case_id and professional_id=a.professional_id and payer_person_id=p.person_id and status='open' for update;
   if v_invoice is null then insert into clinical.billing_invoices(patient_id,case_id,professional_id,payer_person_id,payer_name,payer_basis_points)
    values(v_patient,p_case_id,a.professional_id,p.person_id,p.full_name,p.basis_points) returning id into v_invoice;end if;
   if p.amount_cents>0 then insert into clinical.billing_lines(invoice_id,appointment_id,mandate_revision_id,service_at,service_label,amount_cents,line_kind)
    values(v_invoice,a.id,rid,a.start_at,left(label,200),p.amount_cents,line_kind);end if;
   if coalesce(t.amount_cents,0)>0 then insert into clinical.billing_lines(invoice_id,appointment_id,mandate_revision_id,service_at,service_label,amount_cents,line_kind)
    values(v_invoice,a.id,rid,a.start_at,'Déplacement',t.amount_cents,'travel');end if;
   update clinical.billing_invoices set total_cents=total_cents+p.amount_cents+coalesce(t.amount_cents,0),version=version+1 where id=v_invoice;
   v_invoice:=null;
  end loop;
  if line_kind='service' and a.kind='meeting' then
   select basis_points into v_rate from clinical.professional_fee_rates where professional_id=a.professional_id and effective_from<=day order by effective_from desc limit 1;
   if v_rate is null and not exists(select 1 from clinical.fee_contracts where professional_id=a.professional_id and effective_from<=day) then raise exception 'CLINICAL_FEE_CONTRACT_REQUIRED' using errcode='40001';end if;
   if v_rate is not null then
   insert into clinical.professional_fee_entries(appointment_id,professional_id,service_at,service_cents,basis_points,fee_cents)
    values(a.id,a.professional_id,a.start_at,amount,v_rate,round(amount::numeric*v_rate/10000)::integer);end if;
  else
   insert into clinical.fee_adjustments(professional_id,appointment_id,service_date,kind,client_amount_cents,duration_minutes,meeting_equivalent_half_units,reason,created_by,job_run_id)
    values(a.professional_id,a.id,day,case when line_kind='cancellation' then 'cancellation' else 'report' end,amount,minutes,
     case when line_kind='cancellation' then x.fee_percent/50 else 0 end,'Raccord de la source financière de l’activité',case when clinical.unified_billing_current_job() is null then coalesce(auth.uid(),(select created_by from clinical.care_cases where id=p_case_id)) end,clinical.unified_billing_current_job());
  end if;
  if travel>0 then insert into clinical.fee_adjustments(professional_id,appointment_id,service_date,kind,client_amount_cents,duration_minutes,meeting_equivalent_half_units,reason,created_by,job_run_id)
    values(a.professional_id,a.id,day,'travel',travel,coalesce(a.travel_before_minutes,0)+coalesce(a.travel_after_minutes,0),0,'Déplacement lié à la source financière de l’activité',case when clinical.unified_billing_current_job() is null then coalesce(auth.uid(),(select created_by from clinical.care_cases where id=p_case_id)) end,clinical.unified_billing_current_job());end if;
  insert into clinical.unified_activity_billing_snapshots(appointment_id,financial_version_id,absence_id,absence_version,activity_version,mandate_revision_id,rate_cents,reference_minutes,actual_minutes,service_cents,travel_cents)
   values(a.id,v.id,case when line_kind='cancellation' then x.id end,case when line_kind='cancellation' then x.version end,ac.version,rid,unit_rate,reference,minutes,amount,travel);
  v_count:=v_count+1;
 end loop;
 return jsonb_build_object('reconciledAppointments',v_count);
end $function$
;
-- Private bases/helpers cannot be called directly by authenticated users.
do $$declare routine record;begin
 for routine in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='clinical' and p.proname in('finance_correction_admin','payment_is_removed','can_remove_appointment','encounter_removal_state','void_invoice_for_correction','encounter_remove','guard_removed_encounter_note','guard_removed_encounter_billing_line','finance_correct')) or(n.nspname='public' and p.proname in('clinical_unified_calendar_command_870_base','clinical_billing_payment_870_base','clinical_unified_finance_command_870_base','clinical_unified_fee_quote_870_base')) loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',routine.nspname,routine.proname,routine.args);
 end loop;
end $$;
revoke all on function public.clinical_unified_encounter_removal_preview(text,uuid),public.clinical_unified_calendar_command(text,text,uuid,jsonb,uuid),public.clinical_unified_calendar_query_870(text,date,date),public.clinical_unified_finance_command(uuid,text,jsonb),public.clinical_unified_billing_data_870(),public.clinical_billing_payment(uuid,uuid,integer,text,timestamptz,integer),public.clinical_unified_fee_quote(uuid,date,date,uuid) from public,anon,service_role;
grant execute on function public.clinical_unified_encounter_removal_preview(text,uuid),public.clinical_unified_calendar_command(text,text,uuid,jsonb,uuid),public.clinical_unified_calendar_query_870(text,date,date),public.clinical_unified_finance_command(uuid,text,jsonb),public.clinical_unified_billing_data_870(),public.clinical_billing_payment(uuid,uuid,integer,text,timestamptz,integer),public.clinical_unified_fee_quote(uuid,date,date,uuid) to authenticated;
commit;
