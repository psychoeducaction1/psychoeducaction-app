-- Fictitious records from automatic-invoice-client.sql, in a disposable database.
select set_config('test.capacity.before',(select jsonb_build_array(requested_count,assigned_count,remaining_count,request_comment)::text
  from public.assignment_requests where id='97981000-0000-4000-8000-000000000001'),true);
set local role authenticated;
do $$declare request uuid:='97981000-0000-4000-8000-000000000001'; key uuid:=gen_random_uuid(); v integer; result jsonb;begin
 select (x->>'version')::integer into v from jsonb_array_elements(public.clinical_unified_admission_query('administration')->'capacityRequests') x where x->>'id'=request::text;
 result:=public.clinical_set_capacity_enabled(request,v,false,key);
 if result#>>'{result,id}'<>request::text then raise exception 'PAUSE_NOT_SAVED';end if;
 if public.clinical_set_capacity_enabled(request,v,false,key)#>'{result}'<>result#>'{result}' then raise exception 'PAUSE_REPLAY_CHANGED';end if;
 if public.clinical_professional_import_receipts('97980000-0000-4000-8000-000000000002')->'patientIds'<>'[]'::jsonb then raise exception 'RECEIPTS_WRONGLY_INFERRED';end if;
end $$;
reset role;
insert into clinical.migration_batches(id,owner_id,label,manifest,status,confirmed_at) values(
 '97983000-0000-4000-8000-000000000001','97980000-0000-4000-8000-000000000001','Lot fictif', '{}'::jsonb,'confirmed',clock_timestamp()
);
insert into clinical.migration_items(batch_id,source_key,payload,status,result) values
 ('97983000-0000-4000-8000-000000000001','fixture-receipt',jsonb_build_object('professionalId','97980000-0000-4000-8000-000000000002'),'imported',
  jsonb_build_object('patientId',current_setting('test.fin.patient'),'caseId',current_setting('test.fin.case'))),
 ('97983000-0000-4000-8000-000000000001','fixture-mismatched-patient',jsonb_build_object('professionalId','97980000-0000-4000-8000-000000000003'),'imported',
  jsonb_build_object('patientId','97980000-0000-4000-8000-000000000003','caseId',current_setting('test.fin.case')));
set local role authenticated;
do $$begin
 if public.clinical_professional_import_receipts('97980000-0000-4000-8000-000000000002')->'patientIds'
   <>jsonb_build_array(current_setting('test.fin.patient')) then raise exception 'VERIFIED_RECEIPT_NOT_FOUND';end if;
 if public.clinical_professional_import_receipts('97980000-0000-4000-8000-000000000003')->'patientIds'
   <>'[]'::jsonb then raise exception 'MISMATCHED_RECEIPT_EXPOSED';end if;
end $$;
reset role;
do $$begin
 update public.assignment_requests set is_active=true where id='97981000-0000-4000-8000-000000000001';
 if exists(select 1 from public.assignment_requests where id='97981000-0000-4000-8000-000000000001' and is_active) then raise exception 'PAUSE_LOST_ON_OPERATIONAL_UPDATE';end if;
end $$;
set local role authenticated;
do $$declare request uuid:='97981000-0000-4000-8000-000000000001'; v integer;begin
 select (x->>'version')::integer into v from jsonb_array_elements(public.clinical_unified_admission_query('administration')->'capacityRequests') x where x->>'id'=request::text;
 perform public.clinical_set_capacity_enabled(request,v,true,gen_random_uuid());
end $$;
reset role;
do $$begin
 if not exists(select 1 from public.assignment_requests where id='97981000-0000-4000-8000-000000000001' and is_active
  and jsonb_build_array(requested_count,assigned_count,remaining_count,request_comment)=current_setting('test.capacity.before')::jsonb)
 then raise exception 'CAPACITY_CHANGED_BY_PAUSE';end if;
end $$;
set local role authenticated;
do $$declare key uuid:=gen_random_uuid(); saved jsonb;begin
 if public.clinical_invoice_email_template()->>'version'<>'0' then raise exception 'DEFAULT_VERSION_MISSING';end if;
 begin perform public.clinical_save_invoice_email_template(0,'Sans numéro','{{numero_facture}}',key);raise exception 'MISSING_NUMBER_ALLOWED';exception when invalid_parameter_value then null;end;
 saved:=public.clinical_save_invoice_email_template(0,'Facture {{numero_facture}}','Message fictif {{numero_facture}}',key);
 if saved#>>'{template,text}'<>'Message fictif {{numero_facture}}' or saved->>'version'<>'1' then raise exception 'TEMPLATE_NOT_SAVED';end if;
 if public.clinical_save_invoice_email_template(0,'Facture {{numero_facture}}','Message fictif {{numero_facture}}',key)<>saved then raise exception 'TEMPLATE_REPLAY_CHANGED';end if;
 begin perform public.clinical_save_invoice_email_template(0,'Facture {{numero_facture}}','Autre {{numero_facture}}',gen_random_uuid());raise exception 'TEMPLATE_CONCURRENT_WRITE_ALLOWED';exception when serialization_failure then null;end;
end $$;
reset role;
update clinical.patients set email='payer@example.invalid' where id=current_setting('test.fin.patient')::uuid;
set local role authenticated;
do $$declare episode uuid; a jsonb; f jsonb; preview jsonb; version integer; key uuid:=gen_random_uuid(); appointment uuid; invoice uuid;begin
 episode:=(public.clinical_unified_mandate_query('administration',current_setting('test.fin.mandate')::uuid,current_setting('test.fin.patient')::uuid)#>>'{selected,mandate,episodeId}')::uuid;
 a:=public.clinical_unified_calendar_command('administration','appointments.create',null,jsonb_build_object('kind','meeting','title','Réservation fictive',
 'episodeId',episode,'professionalId','97980000-0000-4000-8000-000000000002','startLocal',((now() at time zone 'America/Toronto')::date+2)||'T10:00','durationMinutes',60,
 'modality','video','officeId',null,'location','','travelBeforeMinutes',0,'travelAfterMinutes',0,'travelKilometers','0','billable',true),gen_random_uuid());
 appointment:=(a#>>'{result,id}')::uuid; version:=(a#>>'{result,version}')::integer;
 f:=public.clinical_prepare_advance_opening_fee(appointment,version,key);
 invoice:=(f#>>'{invoices,0,id}')::uuid;
 if f->>'totalCents'<>'6000' or invoice is null then raise exception 'ADVANCE_FEE_MISSING';end if;
 if public.clinical_prepare_advance_opening_fee(appointment,version,key)<>f then raise exception 'ADVANCE_REPLAY_CHANGED';end if;
 begin perform public.clinical_prepare_advance_opening_fee(appointment,version,gen_random_uuid());raise exception 'DUPLICATE_OPENING_ALLOWED';exception when serialization_failure then null;end;
 if (public.clinical_manual_invoice_preview(invoice,false)#>>'{invoices,0,blockedReason}') is not null then raise exception 'ADVANCE_INVOICE_NOT_SENDABLE';end if;
 if public.clinical_billing_document(invoice,'invoice')->>'base64' is null then raise exception 'ADVANCE_INVOICE_PDF_MISSING';end if;
 preview:=public.clinical_unified_not_held_preview('administration',appointment);
 if preview->>'invoiceCount'<>'0' then raise exception 'OPENING_MIXED_WITH_SERVICE';end if;
 perform public.clinical_unified_calendar_command('administration','appointments.not-held',appointment,
 jsonb_build_object('expectedVersion',preview->'version','previewHash',preview->'hash','confirmed',true,'status','cancelled','reason','client','feePercent',0),gen_random_uuid());
 perform set_config('test.opening.invoice',invoice::text,true);
 perform set_config('test.opening.appointment',appointment::text,true);
end $$;
reset role;
set local request.jwt.claim.sub='';set local request.jwt.claim.role='service_role';set local role service_role;
select public.clinical_reconcile_due_billing_job();
reset role;
do $$begin
 if(select count(*) from clinical.billing_lines where line_kind='opening_fee')<>1 then raise exception 'AUTOMATIC_DUPLICATE_OPENING';end if;
 if not exists(select 1 from clinical.billing_lines where appointment_id=current_setting('test.fin.appointment')::uuid and line_kind<>'opening_fee') then
  raise exception 'FIRST_COMPLETED_SERVICE_NOT_BILLED';
 end if;
 if exists(select 1 from clinical.billing_invoice_voids where invoice_id=current_setting('test.opening.invoice')::uuid) then raise exception 'SEPARATE_OPENING_VOIDED';end if;
 if(select status from clinical.appointments where id=current_setting('test.opening.appointment')::uuid)<>'cancelled' then raise exception 'APPOINTMENT_NOT_CANCELLED';end if;
 if exists(select 1 from clinical.manual_invoice_deliveries) or exists(select 1 from clinical.billing_payments) then raise exception 'EMAIL_OR_PAYMENT_TRIGGERED';end if;
end $$;
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='97980000-0000-4000-8000-000000000002';set local role authenticated;
do $$declare local_day date:=(statement_timestamp() at time zone 'America/Toronto')::date;
  offered jsonb; accepted jsonb; operation uuid:=gen_random_uuid();
begin
  offered:=jsonb_build_array(jsonb_build_object('day',local_day+2,'startMinute',480,'endMinute',540));
  begin
    perform public.clinical_create_capacity_offer(offered,1,'flexible','',operation);
    raise exception 'SHORT_NOTICE_ALLOWED';
  exception when invalid_parameter_value then
    if sqlerrm<>'CLINICAL_CAPACITY_PAST' then raise;end if;
  end;
  offered:=jsonb_build_array(jsonb_build_object('day',local_day+4,'startMinute',600,'endMinute',660));
  accepted:=public.clinical_create_capacity_offer(offered,1,'flexible','',operation);
  if accepted->>'id' is null or public.clinical_create_capacity_offer(offered,1,'flexible','',operation)<>accepted then
    raise exception 'CAPACITY_REPLAY_FAILED';
  end if;
end $$;
do $$begin
 perform set_config('pea.clinical_context','clinical',true);
 begin perform public.clinical_invoice_email_template();raise exception 'PROFESSIONAL_TEMPLATE_ACCESS';exception when insufficient_privilege then null;end;
 begin perform public.clinical_professional_import_receipts('97980000-0000-4000-8000-000000000002');raise exception 'PROFESSIONAL_RECEIPT_ACCESS';exception when insufficient_privilege then null;end;
 begin perform public.clinical_prepare_advance_opening_fee(current_setting('test.opening.appointment')::uuid,1,gen_random_uuid());raise exception 'PROFESSIONAL_CHARGED_OPENING';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='97980000-0000-4000-8000-000000000003';
do $$declare local_day date:=(statement_timestamp() at time zone 'America/Toronto')::date;
begin
  begin
    perform public.clinical_create_capacity_offer(
      jsonb_build_array(jsonb_build_object('day',local_day+2,'startMinute',480,'endMinute',540)),
      1,'flexible','',gen_random_uuid()
    );
  exception when insufficient_privilege then
    if sqlerrm<>'CLINICAL_FORBIDDEN' then raise;end if;
  end;
end $$;
reset role;
rollback;
