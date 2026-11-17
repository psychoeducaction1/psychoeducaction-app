-- Manual billing: preserve idempotency and isolate known prerequisites per case.
-- No historical data update, no delivery, no payment, no automatic invocation.
begin;
do $$begin
 if to_regprocedure('clinical.unified_reconcile_through(date)') is null
 or to_regprocedure('public.clinical_unified_finance_command_550(uuid,text,jsonb)') is null then raise exception 'BILLING_MANUAL_BASELINE_REQUIRED';end if;
end $$;
create or replace function clinical.unified_reconcile_through(p_through date) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$
declare c record;cnt integer:=0;result jsonb;blocked jsonb:='[]';code text;previous_cutoff text:=current_setting('pea.billing_through',true);
begin
 if not clinical.can_administer() then raise exception 'CLINICAL_BILLING_FORBIDDEN' using errcode='42501';end if;
 if p_through is null or p_through>(clock_timestamp() at time zone 'America/Toronto')::date then raise exception 'BILLING_INVALID_INPUT' using errcode='22023';end if;
 for c in select distinct a.case_id from clinical.appointments a where a.case_id is not null
  and (a.end_at at time zone 'America/Toronto')::date+1<=p_through and a.status in('completed','cancelled','no_show')
  and a.kind in('meeting','documentation') and clinical.calendar_billable(a.id)
  and not exists(select 1 from clinical.appointment_removals r where r.appointment_id=a.id)
  and not exists(select 1 from clinical.billing_lines l where l.appointment_id=a.id and l.line_kind<>'opening_fee')
  order by a.case_id limit 100 loop
  begin
   result:=clinical.unified_billing_reconcile_core(c.case_id,p_through);
   perform set_config('pea.billing_through',p_through::text,true);
   perform clinical.billing_reconcile_case_internal(c.case_id);
   perform set_config('pea.billing_through',coalesce(previous_cutoff,''),true);
   cnt:=cnt+coalesce((result->>'reconciledAppointments')::integer,0);
  exception when sqlstate '22023' or sqlstate '40001' then
   code:=sqlerrm;
   if code not in('BILLING_FINANCIAL_TERMS_REQUIRED','ACTIVITY_FINANCE_MANDATE_CHANGED','BILLING_RATE_UNSUPPORTED','BILLING_TRAVEL_RATE_REQUIRED','BILLING_PAYER_TOTAL','CLINICAL_FEE_CONTRACT_REQUIRED','CLINICAL_OPENING_FEE_FIRST_INVOICE_CLOSED','BILLING_OPENING_SNAPSHOT_REQUIRED') then raise;end if;
   blocked:=blocked||jsonb_build_array(jsonb_build_object('caseId',c.case_id,'code',code));
  end;
 end loop;
 return jsonb_build_object('reconciledAppointments',cnt,'blockedCases',blocked);
exception when others then perform set_config('pea.billing_through',coalesce(previous_cutoff,''),true);raise;
end $$;
revoke all on function clinical.unified_reconcile_through(date) from public,anon,authenticated,service_role;
do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.clinical_unified_finance_command_550(uuid,text,jsonb)'::regprocedure);
 needle:=$needle$v_result:=jsonb_build_object('ok',true,'action',p_action,'id',v_id,'version',v_version);$needle$;
 if position(needle in definition)=0 then raise exception 'BILLING_MANUAL_COMMAND_BASELINE_CHANGED';end if;
 if position('''preparation''' in definition)>0 then raise exception 'BILLING_MANUAL_ALREADY_PATCHED';end if;
 execute replace(definition,needle,needle||E'\n  if p_action=''batch.prepare'' then v_result:=v_result||jsonb_build_object(''preparation'',v_detail);end if;');
end $$;
commit;
