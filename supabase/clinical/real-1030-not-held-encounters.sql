-- Prepared only. Apply together with the 1030 calendar UI after explicit authorization.
begin;

create table clinical.encounter_not_held_decisions (
 command_key uuid primary key,
 appointment_id uuid not null references clinical.appointments(id),
 actor_id uuid not null references public.profiles(id),
 old_version integer not null, new_version integer not null,
 status text not null check(status in('cancelled','no_show')),
 reason text check(reason in('client','professional','clinic')),
 fee_percent integer not null check(fee_percent in(0,50,100)),
 transaction_id bigint not null default txid_current(),
 source_invoice_ids uuid[] not null default '{}',
 recorded_at timestamptz not null default clock_timestamp(),
 check(new_version=old_version+1),
 check((status='no_show' and reason is null) or(status='cancelled' and reason is not null)),
 unique(appointment_id,old_version)
);
alter table clinical.encounter_not_held_decisions enable row level security;
revoke all on clinical.encounter_not_held_decisions from public,anon,authenticated,service_role;
create trigger encounter_not_held_immutable before update or delete on clinical.encounter_not_held_decisions for each row execute function clinical.reject_immutable_mutation();
create trigger encounter_not_held_no_truncate before truncate on clinical.encounter_not_held_decisions for each statement execute function clinical.reject_immutable_mutation();

create function clinical.can_declare_not_held(p_id uuid,p_context text) returns boolean
language sql stable security definer set search_path='' set row_security=off as $$
 select clinical.active_actor() and exists(select 1 from clinical.appointments a
 where a.id=p_id and a.kind='meeting' and a.episode_id is not null and a.status in('planned','completed')
 and not exists(select 1 from clinical.appointment_removals r where r.appointment_id=a.id) and(
 (p_context='administration' and clinical.can_administer() and clinical.finance_correction_admin() and not a.is_private) or
 (p_context='clinical' and a.professional_id=auth.uid() and clinical.calendar_can_manage(a.professional_id)
 and exists(select 1 from clinical.care_cases c where c.episode_id=a.episode_id and c.status='open' and clinical.has_case_access(c.id,'write')))))
$$;

create function clinical.not_held_state(p_id uuid) returns jsonb
language sql stable security definer set search_path='' set row_security=off as $$
 select clinical.encounter_removal_state(a.id)||jsonb_build_object('conditionsId',
 clinical.calendar_conditions(a.episode_id,a.professional_id,(a.start_at at time zone 'America/Toronto')::date))
 from clinical.appointments a where a.id=p_id
$$;

create function public.clinical_unified_not_held_preview(p_context text,p_appointment_id uuid) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare previous text;s jsonb;result jsonb;begin
 previous:=clinical.unified_calendar_context(p_context);
 if not clinical.can_declare_not_held(p_appointment_id,p_context) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 s:=clinical.not_held_state(p_appointment_id);
 result:=jsonb_build_object('appointmentId',p_appointment_id,'version',s->'version',
 'hash',encode(sha256(convert_to(s::text,'UTF8')),'hex'),
 'noteCount',jsonb_array_length(s->'notes'),'invoiceCount',jsonb_array_length(s->'invoices'),
 'paidInvoiceCount',(select count(*) from jsonb_array_elements(s->'invoices') x where x->'paid'='true'::jsonb));
 perform set_config('pea.clinical_context',previous,true);return result;
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $$;

-- Extend the immutable appointment guard only for an authenticated, recorded
-- single-occurrence decision. A caller-controlled session flag is insufficient.
do $patch$
declare original text;needle text:=$needle$ if tg_op='UPDATE' then$needle$;addition text:=$addition$
 if tg_op='UPDATE' and old.kind='meeting' and old.status in('planned','completed')
 and new.status in('cancelled','no_show') and new.version=old.version+1
 and(to_jsonb(new)-array['status','cancelled_at','cancellation_reason','version','updated_at'])=(to_jsonb(old)-array['status','cancelled_at','cancellation_reason','version','updated_at'])
 and exists(select 1 from clinical.encounter_not_held_decisions d where d.appointment_id=old.id
 and d.actor_id=auth.uid() and d.old_version=old.version and d.new_version=new.version and d.status=new.status
 and d.reason is not distinct from new.cancellation_reason and
 ((d.status='cancelled' and new.cancelled_at=d.recorded_at) or(d.status='no_show' and new.cancelled_at is null))) then return new;end if;
$addition$;
begin
 original:=pg_get_functiondef('clinical.guard_appointment()'::regprocedure);
 if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'CALENDAR_1030_GUARD_SOURCE_CHANGED';end if;
 execute replace(original,needle,addition||needle);
 -- Voided invoices remain immutable history; they must not prevent a financial
 -- decision on the same encounter after its invoice has been voided atomically.
 original:=pg_get_functiondef('clinical.calendar_financial_apply(uuid,text,jsonb,jsonb)'::regprocedure);
 needle:='where s.appointment_id=a.id and i.status=''closed''';
 if length(original)-length(replace(original,needle,''))<>2*length(needle) then raise exception 'CALENDAR_1030_FINANCE_SOURCE_CHANGED';end if;
 execute replace(original,needle,needle||' and not exists(select 1 from clinical.billing_invoice_voids z join clinical.encounter_not_held_decisions decision_1030 on z.invoice_id=any(decision_1030.source_invoice_ids) where z.invoice_id=i.id and decision_1030.appointment_id=a.id)');
end $patch$;

-- Reuse the existing append-only revision archive when replacing unvalidated
-- fee sources. A transaction permit cannot be supplied by an API caller.
do $patch$
declare original text;needle text:=' aid:=old.appointment_id;';addition text:=$addition$
 if tg_op='DELETE' and tg_table_name in('professional_fee_entries','fee_adjustments','unified_activity_billing_snapshots')
 and exists(select 1 from clinical.encounter_not_held_decisions d join clinical.appointments a on a.id=d.appointment_id
 where d.appointment_id=old.appointment_id and d.actor_id=auth.uid() and d.transaction_id=txid_current() and a.version=d.new_version)
 and not exists(select 1 from clinical.billing_lines l where l.appointment_id=old.appointment_id
 and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=l.invoice_id)) then
  insert into clinical.unified_open_finance_revisions(appointment_id,relation_name,operation,previous_row,next_row,actor_id)
  values(old.appointment_id,tg_table_name,tg_op,to_jsonb(old),null,auth.uid());return old;
 end if;
$addition$;
begin
 original:=pg_get_functiondef('clinical.unified_open_finance_guard()'::regprocedure);
 if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'CALENDAR_1030_ARCHIVE_GUARD_CHANGED';end if;
 execute replace(original,needle,needle||addition);
 original:=pg_get_functiondef('clinical.unified_billing_reconcile_one(uuid,date,uuid)'::regprocedure);
 needle:='where bl.appointment_id=a.id and bl.line_kind<>''opening_fee''';
 if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'CALENDAR_1030_RECONCILE_SOURCE_CHANGED';end if;
 execute replace(original,needle,needle||' and not exists(select 1 from clinical.billing_invoice_voids voided_1030 join clinical.encounter_not_held_decisions decision_1030 on voided_1030.invoice_id=any(decision_1030.source_invoice_ids) where voided_1030.invoice_id=bl.invoice_id and decision_1030.appointment_id=a.id)');
 original:=pg_get_functiondef('clinical.unified_prepare_due_billing(text)'::regprocedure);
 needle:='where l.appointment_id=a.id and l.line_kind<>''opening_fee''';
 if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'CALENDAR_1030_JOB_SOURCE_CHANGED';end if;
 execute replace(original,needle,needle||' and not exists(select 1 from clinical.billing_invoice_voids voided_1030 join clinical.encounter_not_held_decisions decision_1030 on voided_1030.invoice_id=any(decision_1030.source_invoice_ids) where voided_1030.invoice_id=l.invoice_id and decision_1030.appointment_id=a.id)');
 original:=pg_get_functiondef('clinical.unified_reconcile_through(date)'::regprocedure);
 if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'CALENDAR_1030_MANUAL_SOURCE_CHANGED';end if;
 execute replace(original,needle,needle||' and not exists(select 1 from clinical.billing_invoice_voids voided_1030 join clinical.encounter_not_held_decisions decision_1030 on voided_1030.invoice_id=any(decision_1030.source_invoice_ids) where voided_1030.invoice_id=l.invoice_id and decision_1030.appointment_id=a.id)');
end $patch$;

create function clinical.declare_not_held(p_context text,p_key uuid,p_id uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare previous text;intent text;receipt clinical.correction_commands;a clinical.appointments;
 d clinical.encounter_not_held_decisions;i clinical.billing_invoices;s jsonb;result jsonb;percent integer;kind text;notice timestamptz;
begin
 previous:=clinical.unified_calendar_context(p_context);
 perform clinical.unified_professional_keys(p_data,array['expectedVersion','previewHash','confirmed','status','reason','feePercent']);
 if p_key is null or p_data is null or jsonb_typeof(p_data)<>'object' or (select count(*) from jsonb_object_keys(p_data))<>6
 or p_data->'confirmed' is distinct from 'true'::jsonb or p_data->>'previewHash' is null or p_data->>'previewHash' !~ '^[a-f0-9]{64}$'
 or p_data->>'status' not in('cancelled','no_show') or p_data->>'status' is null
 or(p_data->>'status'='cancelled' and(coalesce(p_data->>'reason','') not in('client','professional','clinic')))
 or(p_data->>'status'='no_show' and p_data->'reason' is distinct from 'null'::jsonb)
 then raise exception 'CALENDAR_INVALID_INPUT' using errcode='22023';end if;
 percent:=clinical.unified_professional_int(p_data,'feePercent',0,100);
 if percent not in(0,50,100) then raise exception 'CALENDAR_INVALID_INPUT' using errcode='22023';end if;
 intent:=encode(sha256(convert_to(jsonb_build_array(p_context,'appointments.not-held',p_id,p_data)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 -- Replays still require active access, but not the encounter's original status.
 if not clinical.active_actor() then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 select * into receipt from clinical.correction_commands where command_key=p_key;
 if found then
  if receipt.actor_id<>auth.uid() or receipt.intent_hash<>intent then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
  select * into a from clinical.appointments where id=p_id;
  if not clinical.calendar_can_manage(a.professional_id) or(p_context='clinical' and(a.professional_id<>auth.uid() or not clinical.has_case_access(a.case_id,'write')))
  or(p_context='administration' and not clinical.finance_correction_admin()) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
  perform set_config('pea.clinical_context',previous,true);return receipt.result;
 end if;
 if exists(select 1 from clinical.calendar_privacy_receipts where actor_id=auth.uid() and request_key=p_key)
 or exists(select 1 from clinical.calendar_command_receipts where actor_id=auth.uid() and request_key=p_key) then raise exception 'CLINICAL_IDEMPOTENCY_CONFLICT' using errcode='40001';end if;
 if not clinical.can_declare_not_held(p_id,p_context) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 select * into a from clinical.appointments where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended('calendar-professional/'||a.professional_id::text,0));
 perform 1 from clinical.service_episodes where id=a.episode_id for update;
 perform 1 from clinical.care_cases where episode_id=a.episode_id order by id for update;
 select * into a from clinical.appointments where id=p_id for update;
 perform 1 from clinical.notes where appointment_id=a.id order by id for update;
 perform 1 from clinical.billing_invoices where id in(select invoice_id from clinical.billing_lines where appointment_id=a.id) order by id for update;
 if not clinical.can_declare_not_held(p_id,p_context) then raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';end if;
 perform clinical.calendar_version(a.version,p_data);
 s:=clinical.not_held_state(a.id);
 if encode(sha256(convert_to(s::text,'UTF8')),'hex') is distinct from p_data->>'previewHash' then raise exception 'NOT_HELD_PREVIEW_CHANGED' using errcode='40001';end if;
 if p_data->>'status'='no_show' and a.start_at>clock_timestamp() then raise exception 'NOT_HELD_FUTURE_ABSENCE' using errcode='22023';end if;
 -- Validated pay statements need an explicit administrative adjustment, not
 -- silent recalculation by a professional or by the background billing job.
 if exists(select 1 from clinical.professional_fee_statement_lines where appointment_id=a.id)
 or exists(select 1 from clinical.fee_statement_adjustment_lines l join clinical.fee_adjustments f on f.id=l.adjustment_id where f.appointment_id=a.id)
 or exists(select 1 from clinical.unified_fee_preparations p where p.professional_id=a.professional_id and p.status in('validated','closed')
 and exists(select 1 from jsonb_array_elements(p.quote#>'{inputs,sources}')x where x->>'appointmentId'=a.id::text or x->>'meetingId'=a.id::text or x->>'id'=a.id::text
 or exists(select 1 from clinical.fee_adjustments f where f.appointment_id=a.id and f.id::text=x->>'id')))
 then raise exception 'NOT_HELD_FINAL_FEES_REVIEW_REQUIRED' using errcode='40001';end if;
 insert into clinical.encounter_not_held_decisions(command_key,appointment_id,actor_id,old_version,new_version,status,reason,fee_percent,source_invoice_ids)
 values(p_key,a.id,auth.uid(),a.version,a.version+1,p_data->>'status',p_data->>'reason',percent,
 array(select distinct invoice_id from clinical.billing_lines where appointment_id=a.id order by invoice_id)) returning * into d;
 -- Invoice and payment records are never deleted. No credit, delivery or bank
 -- command is called. Existing payment reconciliation remains administrative.
 for i in select * from clinical.billing_invoices where id in(select invoice_id from clinical.billing_lines where appointment_id=a.id)
 and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=billing_invoices.id) order by id loop
  if i.professional_id<>a.professional_id or not exists(select 1 from clinical.care_cases c where c.id=i.case_id and c.episode_id=a.episode_id)
  then raise exception 'FINANCIAL_LINK_REVIEW_REQUIRED' using errcode='40001';end if;
  perform clinical.void_invoice_for_correction(i.id,a.id,'Rencontre annulée ou client absent');
 end loop;
 update clinical.appointments set status=d.status,cancelled_at=case when d.status='cancelled' then d.recorded_at end,
 cancellation_reason=d.reason,version=d.new_version,updated_at=d.recorded_at where id=a.id;
 delete from clinical.professional_fee_entries where appointment_id=a.id;
 delete from clinical.fee_adjustments where appointment_id=a.id;
 if percent>0 then delete from clinical.unified_activity_billing_snapshots where appointment_id=a.id;end if;
 notice:=case when d.status='cancelled' then d.recorded_at end;
 kind:=clinical.calendar_absence_class(a.start_at,notice);
 perform clinical.calendar_financial_apply(a.id,'appointments.not-held','{}',jsonb_build_object('kind',kind,'feePercent',percent,'noticeAt',notice,'travelPerformed',false));
 if a.series_id is not null then update clinical.calendar_series set revision=revision+1 where id=a.series_id;end if;
 perform clinical.calendar_history_add(case when d.status='cancelled' then 'appointment_cancelled' else 'appointment_no_show' end,a.id,a.professional_id,d.new_version,
 jsonb_build_object('reason',d.reason,'feePercent',d.fee_percent,'notesPreserved',true));
 result:=jsonb_build_object('mode','isolated_unified','durable',true,'actorId',auth.uid(),'context',p_context,'result',
 jsonb_build_object('kind','appointment','id',a.id,'affectedIds',jsonb_build_array(a.id),'version',d.new_version));
 insert into clinical.correction_commands(command_key,actor_id,intent_hash,result) values(p_key,auth.uid(),intent,result);
 perform set_config('pea.clinical_context',previous,true);return result;
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $$;

-- Keep the public function's OID: already prepared database calls must use the
-- new authorization path too, rather than a renamed old entry point.
do $copy$
declare original text;needle text:='CREATE OR REPLACE FUNCTION public.clinical_unified_calendar_command(';begin
 original:=pg_get_functiondef('public.clinical_unified_calendar_command(text,text,uuid,jsonb,uuid)'::regprocedure);
 if to_regprocedure('public.clinical_unified_calendar_command_1030_base(text,text,uuid,jsonb,uuid)') is not null
 or strpos(original,needle)<>1 then raise exception 'CALENDAR_1030_COMMAND_SOURCE_CHANGED';end if;
 execute replace(original,needle,'CREATE OR REPLACE FUNCTION public.clinical_unified_calendar_command_1030_base(');
end $copy$;
create or replace function public.clinical_unified_calendar_command(p_context text,p_action text,p_id uuid,p_data jsonb,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$begin
 if p_action='appointments.not-held' then return clinical.declare_not_held(p_context,p_request_key,p_id,p_data);end if;
 return public.clinical_unified_calendar_command_1030_base(p_context,p_action,p_id,p_data,p_request_key);
end $$;
revoke all on function public.clinical_unified_calendar_command_1030_base(text,text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

-- Also cover a replacement containing only the new absence fee: the original
-- void helper's replacement link covers other meetings, not this new fee line.
create function clinical.not_held_payment_review(p_invoice uuid) returns boolean
language sql stable security definer set search_path='' set row_security=off as $$
 select exists(select 1 from clinical.billing_lines current_line
 join clinical.encounter_not_held_decisions d on d.appointment_id=current_line.appointment_id
 join clinical.billing_lines prior_line on prior_line.appointment_id=d.appointment_id and prior_line.invoice_id<>current_line.invoice_id and prior_line.invoice_id=any(d.source_invoice_ids)
 join clinical.billing_invoice_voids v on v.invoice_id=prior_line.invoice_id
 join clinical.billing_invoices old on old.id=v.invoice_id
 where current_line.invoice_id=p_invoice and old.paid_cents>0)
$$;
revoke all on function clinical.not_held_payment_review(uuid) from public,anon,authenticated,service_role;
do $patch$
declare original text;needle text;begin
 original:=pg_get_functiondef('clinical.manual_invoice_envelope(uuid)'::regprocedure);
 needle:='when exists(select 1 from clinical.billing_invoice_voids v join clinical.billing_invoices old on old.id=v.invoice_id where v.replacement_invoice_id=i.id and old.paid_cents>0)';
 if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'CALENDAR_1030_ENVELOPE_SOURCE_CHANGED';end if;
 execute replace(original,needle,'when clinical.not_held_payment_review(i.id) then ''Paiement de la facture remplacée à vérifier.'' '||needle);
 original:=pg_get_functiondef('public.clinical_billing_payment(uuid,uuid,integer,text,timestamp with time zone,integer)'::regprocedure);
 needle:='return public.clinical_billing_payment_870_base';
 if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'CALENDAR_1030_PAYMENT_SOURCE_CHANGED';end if;
 execute replace(original,needle,'if clinical.not_held_payment_review(p_invoice_id) then raise exception ''REPLACEMENT_PAYMENT_REVIEW_REQUIRED'' using errcode=''40001'';end if; '||needle);
end $patch$;

create function public.clinical_unified_calendar_query_1030(p_context text,p_from_date date,p_to_date date) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare previous text;q jsonb;begin
 previous:=clinical.unified_calendar_context(p_context);
 q:=public.clinical_unified_calendar_query_880(p_context,p_from_date,p_to_date);
 q:=jsonb_set(q,'{workspace,appointments}',(select coalesce(jsonb_agg(e||jsonb_build_object('canDeclareNotHeld',clinical.can_declare_not_held((e->>'id')::uuid,p_context)) order by ord),'[]')
 from jsonb_array_elements(q->'workspace'->'appointments') with ordinality t(e,ord)));
 perform set_config('pea.clinical_context',previous,true);return q;
exception when others then perform set_config('pea.clinical_context',coalesce(previous,''),true);raise;end $$;

-- Current result is separate from the immutable signed note and its snapshot.
do $copy$
declare original text;needle text:='CREATE OR REPLACE FUNCTION clinical.note_json(';begin
 original:=pg_get_functiondef('clinical.note_json(uuid)'::regprocedure);
 if to_regprocedure('clinical.note_json_1030_base(uuid)') is not null or strpos(original,needle)<>1
 then raise exception 'CALENDAR_1030_NOTE_SOURCE_CHANGED';end if;
 execute replace(original,needle,'CREATE OR REPLACE FUNCTION clinical.note_json_1030_base(');
end $copy$;
create or replace function clinical.note_json(p_id uuid) returns jsonb
language sql stable security definer set search_path='' set row_security=off as $$
 select clinical.note_json_1030_base(n.id)||jsonb_build_object('encounterResult',
 (select a.status from clinical.appointments a where a.id=n.appointment_id and a.status in('cancelled','no_show')))
 from clinical.notes n where n.id=p_id
$$;

revoke all on function clinical.can_declare_not_held(uuid,text),clinical.not_held_state(uuid),clinical.declare_not_held(text,uuid,uuid,jsonb),clinical.note_json_1030_base(uuid),clinical.note_json(uuid) from public,anon,authenticated,service_role;
revoke all on function public.clinical_unified_not_held_preview(text,uuid),public.clinical_unified_calendar_query_1030(text,date,date),public.clinical_unified_calendar_command(text,text,uuid,jsonb,uuid) from public,anon,service_role;
grant execute on function public.clinical_unified_not_held_preview(text,uuid),public.clinical_unified_calendar_query_1030(text,date,date),public.clinical_unified_calendar_command(text,text,uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
