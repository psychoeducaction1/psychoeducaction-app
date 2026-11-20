-- Runs only in the disposable local schema with automatic-invoice-client.sql.
insert into clinical.note_templates(note_type,section_ids) values('evolution',array['document']) on conflict do nothing;
set local role authenticated;
do $$declare ack jsonb;p jsonb;episode uuid;day date:=(now() at time zone 'America/Toronto')::date-2;begin
 episode:=(public.clinical_unified_mandate_query('administration',current_setting('test.fin.mandate')::uuid,current_setting('test.fin.patient')::uuid)#>>'{selected,mandate,episodeId}')::uuid;
 for n in 0..3 loop
 ack:=public.clinical_unified_calendar_command('administration','appointments.create',null,jsonb_build_object('kind','meeting','title','Rencontre fictive',
 'episodeId',episode,'professionalId','97980000-0000-4000-8000-000000000002','startLocal',day||'T'||(12+n)||':00','durationMinutes',60,'modality','video','officeId',null,'location','','travelBeforeMinutes',0,'travelAfterMinutes',0,'travelKilometers','0','billable',true),gen_random_uuid());
 perform set_config('test.abs.n'||n,ack#>>'{result,id}',true);
 end loop;
end $$;
reset role;
set local request.jwt.claim.sub='';set local request.jwt.claim.role='service_role';set local role service_role;
select public.clinical_reconcile_due_billing_job();
reset role;
do $$begin
 if(select status from clinical.appointments where id=current_setting('test.abs.n0')::uuid)<>'completed' then raise exception 'AUTO_COMPLETION_NOT_EXERCISED';end if;
 if not exists(select 1 from clinical.billing_lines where appointment_id=current_setting('test.abs.n0')::uuid) then raise exception 'INVOICE_NOT_EXERCISED';end if;
end $$;

-- A signed note is created through the same commands used by the UI.
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='97980000-0000-4000-8000-000000000002';set local role authenticated;
do $$declare n jsonb;begin
 perform set_config('pea.clinical_context','clinical',true);
 n:=public.clinical_create_note(current_setting('test.fin.case')::uuid,'evolution','Note fictive', (now() at time zone 'America/Toronto')::date-2,'{"document":"Contenu clinique entièrement fictif."}',current_setting('test.abs.n0')::uuid);
 n:=public.clinical_sign_note((n#>>'{note,id}')::uuid,(n#>>'{note,version}')::integer,true);
 perform set_config('test.abs.note',n#>>'{note,id}',true);
 perform set_config('test.abs.signed',n::text,true);
end $$;
reset role;

-- Professional can declare their own automatically completed meeting non-held.
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='97980000-0000-4000-8000-000000000002';set local role authenticated;
do $$declare p jsonb;data jsonb;ack jsonb;k uuid:=gen_random_uuid();begin
 p:=public.clinical_unified_not_held_preview('clinical',current_setting('test.abs.n0')::uuid);
 data:=jsonb_build_object('expectedVersion',p->'version','previewHash',p->'hash','confirmed',true,'status','no_show','reason',null,'feePercent',0);
 -- No acceptance means charging is rejected and the whole invoice change rolls back.
 begin
  perform public.clinical_unified_calendar_command('clinical','appointments.not-held',current_setting('test.abs.n0')::uuid,data||'{"feePercent":100}',gen_random_uuid());
  raise exception 'UNACCEPTED_FEE_ALLOWED';
 exception when serialization_failure then null;end;
 ack:=public.clinical_unified_calendar_command('clinical','appointments.not-held',current_setting('test.abs.n0')::uuid,data,k);
 if public.clinical_unified_calendar_command('clinical','appointments.not-held',current_setting('test.abs.n0')::uuid,data,k)<>ack then raise exception 'REPLAY_CHANGED_RESULT';end if;
 begin perform public.clinical_unified_calendar_command('clinical','appointments.not-held',current_setting('test.abs.n0')::uuid,data||'{"status":"cancelled","reason":"client"}',k);raise exception 'REPLAY_CHANGED_INTENT_ALLOWED';exception when serialization_failure then null;end;
 begin perform public.clinical_unified_calendar_command('clinical','appointments.not-held',current_setting('test.abs.n0')::uuid,data,gen_random_uuid());raise exception 'ALREADY_DECIDED_ALLOWED';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if (select status from clinical.appointments where id=current_setting('test.abs.n0')::uuid)<>'no_show' then raise exception 'RESULT_NOT_SAVED';end if;
 if (clinical.note_json(current_setting('test.abs.note')::uuid)-'encounterResult') is distinct from (current_setting('test.abs.signed')::jsonb-'encounterResult') then raise exception 'SIGNED_NOTE_CHANGED';end if;
 if clinical.note_json(current_setting('test.abs.note')::uuid)->>'encounterResult'<>'no_show' then raise exception 'NOTE_NOTICE_MISSING';end if;
 if(select count(*) from clinical.encounter_not_held_decisions)<>1 then raise exception 'DUPLICATE_DECISION';end if;
 if not exists(select 1 from clinical.billing_invoice_voids) then raise exception 'OLD_INVOICE_NOT_VOIDED';end if;
 if not exists(select 1 from clinical.billing_lines l join clinical.billing_invoices i on i.id=l.invoice_id where l.appointment_id=current_setting('test.abs.n1')::uuid and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=i.id)) then raise exception 'OTHER_MEETING_LOST';end if;
end $$;

-- Another/nonactivated professional cannot read the confirmation or write.
do $$declare aid uuid;begin
 insert into clinical.appointments(case_id,episode_id,professional_id,kind,start_at,end_at,modality,status)
 select case_id,episode_id,'97980000-0000-4000-8000-000000000003','meeting',start_at+interval '10 days',end_at+interval '10 days','video','planned'
 from clinical.appointments where id=current_setting('test.abs.n1')::uuid returning id into aid;
 perform set_config('test.abs.nonActivatedOwn',aid::text,true);
end $$;
set local request.jwt.claim.sub='97980000-0000-4000-8000-000000000003';set local role authenticated;
do $$begin
 begin perform public.clinical_unified_not_held_preview('clinical',current_setting('test.abs.nonActivatedOwn')::uuid);raise exception 'NON_ACTIVATED_OWN_ALLOWED';exception when insufficient_privilege then null;end;
 begin perform public.clinical_unified_not_held_preview('clinical',current_setting('test.abs.n1')::uuid);raise exception 'OTHER_PRO_PREVIEW_ALLOWED';exception when insufficient_privilege then null;end;
 begin perform public.clinical_unified_calendar_command('clinical','appointments.not-held',current_setting('test.abs.n1')::uuid,'{"expectedVersion":1,"previewHash":"0000000000000000000000000000000000000000000000000000000000000000","confirmed":true,"status":"no_show","reason":null,"feePercent":0}',gen_random_uuid());raise exception 'OTHER_PRO_WRITE_ALLOWED';exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Administrative cancellation, stale confirmation rejected, no clinical content deletion.
set local request.jwt.claim.sub='97980000-0000-4000-8000-000000000001';set local role authenticated;
do $$declare p jsonb;d jsonb;begin
 p:=public.clinical_unified_not_held_preview('administration',current_setting('test.abs.n1')::uuid);
 d:=jsonb_build_object('expectedVersion',p->'version','previewHash',p->'hash','confirmed',true,'status','cancelled','reason','clinic','feePercent',0);
 begin perform public.clinical_unified_calendar_command('administration','appointments.not-held',current_setting('test.abs.n1')::uuid,d||jsonb_build_object('previewHash',repeat('0',64)),gen_random_uuid());raise exception 'STALE_PREVIEW_ALLOWED';exception when serialization_failure then null;end;
 perform public.clinical_unified_calendar_command('administration','appointments.not-held',current_setting('test.abs.n1')::uuid,d,gen_random_uuid());
end $$;
reset role;
do $$begin
 if exists(select 1 from clinical.note_removals) then raise exception 'NOTE_REMOVED';end if;
 if exists(select 1 from clinical.billing_payments) then raise exception 'PAYMENT_TRIGGERED';end if;
 if exists(select 1 from clinical.billing_sends) or exists(select 1 from clinical.manual_invoice_deliveries) then raise exception 'DELIVERY_TRIGGERED';end if;
end $$;
-- Explicitly synthetic proof fixture for the already-recorded conditions path.
-- No production consent or signature is created by the migration itself.
do $$declare doc uuid;sig uuid;person uuid;bytes bytea;begin
 bytes:=clinical.mandate_pdf_graphic('Convention et signataire entièrement fictifs','[]');
 insert into clinical.mandate_documents(revision_id,audience,pdf_bytes,sha256)
 values(current_setting('test.fin.revision')::uuid,'administrative',bytes,encode(sha256(bytes),'hex')) returning id into doc;
 select person_id into person from clinical.mandate_signers where revision_id=current_setting('test.fin.revision')::uuid and audience='administrative' order by person_id limit 1;
 insert into clinical.mandate_signatures(revision_id,person_id,audience,document_id,document_hash,mode,evidence,operator_id)
 values(current_setting('test.fin.revision')::uuid,person,'administrative',doc,encode(sha256(bytes),'hex'),'in_person_typed','{"name":"Signataire fictif","attested":true}','97980000-0000-4000-8000-000000000001') returning id into sig;
 insert into clinical.financial_conditions_versions(mandate_revision_id,version,document_id,document_hash,signature_id,allowed_fee_percents,review_confirmed,reason,created_by)
 values(current_setting('test.fin.revision')::uuid,1,doc,encode(sha256(bytes),'hex'),sig,array[0,50,100],true,'Conditions de recette fictive','97980000-0000-4000-8000-000000000001');
 perform set_config('test.abs.paidInvoice',(select i.id::text from clinical.billing_invoices i join clinical.billing_lines l on l.invoice_id=i.id where l.appointment_id=current_setting('test.abs.n2')::uuid and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=i.id) limit 1),true);
 perform set_config('test.abs.paidVersion',(select version::text from clinical.billing_invoices where id=current_setting('test.abs.paidInvoice')::uuid),true);
end $$;
set local role authenticated;
do $$declare p jsonb;data jsonb;begin
 perform set_config('pea.clinical_context','administration',true);
 perform public.clinical_billing_payment(current_setting('test.abs.paidInvoice')::uuid,gen_random_uuid(),100,'cash',clock_timestamp(),current_setting('test.abs.paidVersion')::integer);
 p:=public.clinical_unified_not_held_preview('administration',current_setting('test.abs.n2')::uuid);
 if(p->>'paidInvoiceCount')::integer<1 then raise exception 'PAID_WARNING_MISSING';end if;
 data:=jsonb_build_object('expectedVersion',p->'version','previewHash',p->'hash','confirmed',true,'status','cancelled','reason','professional','feePercent',50);
 begin perform public.clinical_unified_calendar_command('administration','appointments.not-held',current_setting('test.abs.n2')::uuid,data,gen_random_uuid());raise exception 'PRO_CANCELLATION_CHARGED';exception when invalid_parameter_value then null;end;
 perform public.clinical_unified_calendar_command('administration','appointments.not-held',current_setting('test.abs.n2')::uuid,data||'{"status":"no_show","reason":null}',gen_random_uuid());
end $$;
reset role;
set local request.jwt.claim.sub='';set local request.jwt.claim.role='service_role';set local role service_role;
select public.clinical_reconcile_due_billing_job();
select public.clinical_reconcile_due_billing_job();
reset role;
do $$declare i uuid;begin
 if(select count(*) from clinical.billing_payments)<>1 then raise exception 'PAYMENT_CHANGED';end if;
 if(select paid_cents from clinical.billing_invoices where id=current_setting('test.abs.paidInvoice')::uuid)<>100 then raise exception 'OLD_PAYMENT_LOST';end if;
 if(select count(*) from clinical.billing_lines l where l.appointment_id=current_setting('test.abs.n2')::uuid and l.line_kind='cancellation' and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=l.invoice_id))<>1 then raise exception 'ABSENCE_FEE_MISSING_OR_DUPLICATE';end if;
 if(select amount_cents from clinical.billing_lines l where l.appointment_id=current_setting('test.abs.n2')::uuid and l.line_kind='cancellation' and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=l.invoice_id))<>6000 then raise exception 'ABSENCE_FEE_AMOUNT_WRONG';end if;
 if(select count(*) from clinical.fee_adjustments where appointment_id=current_setting('test.abs.n2')::uuid and kind='cancellation' and client_amount_cents=6000 and meeting_equivalent_half_units=1)<>1 then raise exception 'ABSENCE_HONORARIUM_SOURCE_WRONG';end if;
 select invoice_id into i from clinical.billing_lines l where l.appointment_id=current_setting('test.abs.n2')::uuid and l.line_kind='cancellation' and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=l.invoice_id);
 if not clinical.not_held_payment_review(i) then raise exception 'PAYMENT_REVIEW_MISSING';end if;
 if clinical.manual_invoice_envelope(i)->>'blockedReason'<>'Paiement de la facture remplacée à vérifier.' then raise exception 'DELIVERY_PAYMENT_REVIEW_MISSING';end if;
 if not exists(select 1 from clinical.unified_open_finance_revisions where appointment_id=current_setting('test.abs.n2')::uuid and relation_name='unified_activity_billing_snapshots') then raise exception 'PRIOR_FINANCIAL_SNAPSHOT_LOST';end if;
 if exists(select 1 from clinical.professional_fee_entries where appointment_id in(current_setting('test.abs.n0')::uuid,current_setting('test.abs.n1')::uuid,current_setting('test.abs.n2')::uuid)) then raise exception 'CANCELLED_MEETING_STILL_PAID_AS_MEETING';end if;
end $$;
set local request.jwt.claim.sub='97980000-0000-4000-8000-000000000002';set local request.jwt.claim.role='authenticated';set local role authenticated;
do $$declare p jsonb;data jsonb;begin
 p:=public.clinical_unified_not_held_preview('clinical',current_setting('test.abs.n3')::uuid);
 data:=jsonb_build_object('expectedVersion',p->'version','previewHash',p->'hash','confirmed',true,'status','no_show','reason',null,'feePercent',100);
 perform public.clinical_unified_calendar_command('clinical','appointments.not-held',current_setting('test.abs.n3')::uuid,data,gen_random_uuid());
 begin perform public.clinical_billing_payment(current_setting('test.abs.paidInvoice')::uuid,gen_random_uuid(),1,'cash',clock_timestamp(),1);raise exception 'PRO_PAYMENT_ALLOWED';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local request.jwt.claim.sub='';set local request.jwt.claim.role='service_role';set local role service_role;
select public.clinical_reconcile_due_billing_job();
reset role;
do $$begin
 if(select amount_cents from clinical.billing_lines l where l.appointment_id=current_setting('test.abs.n3')::uuid and l.line_kind='cancellation' and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=l.invoice_id))<>12000 then raise exception 'FULL_FEE_AMOUNT_WRONG';end if;
 if exists(select 1 from clinical.billing_sends) or exists(select 1 from clinical.manual_invoice_deliveries) then raise exception 'DELIVERY_TRIGGERED';end if;
end $$;
set local request.jwt.claim.sub='97980000-0000-4000-8000-000000000002';set local request.jwt.claim.role='authenticated';set local role authenticated;
do $$declare p jsonb;ack jsonb;data jsonb;begin
 ack:=public.clinical_unified_calendar_command('clinical','appointments.create',null,jsonb_build_object('kind','meeting','title','Rencontre future fictive',
 'episodeId',(public.clinical_unified_calendar_query_1030('clinical',(now() at time zone 'America/Toronto')::date-4,(now() at time zone 'America/Toronto')::date+4)#>>'{workspace,clients,0,episodeId}'),
 'professionalId','97980000-0000-4000-8000-000000000002','startLocal',((now() at time zone 'America/Toronto')::date+3)||'T10:00','durationMinutes',60,'modality','video','officeId',null,'location','','travelBeforeMinutes',0,'travelAfterMinutes',0,'travelKilometers','0','billable',true),gen_random_uuid());
 p:=public.clinical_unified_not_held_preview('clinical',(ack#>>'{result,id}')::uuid);
 data:=jsonb_build_object('expectedVersion',p->'version','previewHash',p->'hash','confirmed',true,'status','no_show','reason',null,'feePercent',0);
 begin perform public.clinical_unified_calendar_command('clinical','appointments.not-held',(ack#>>'{result,id}')::uuid,data,gen_random_uuid());raise exception 'FUTURE_ABSENCE_ALLOWED';exception when invalid_parameter_value then null;end;
 perform public.clinical_unified_calendar_command('clinical','appointments.not-held',(ack#>>'{result,id}')::uuid,data||'{"status":"cancelled","reason":"client"}',gen_random_uuid());
 begin perform clinical.declare_not_held('clinical',gen_random_uuid(),(ack#>>'{result,id}')::uuid,data);raise exception 'INTERNAL_FUNCTION_PUBLIC';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- A later, ordinary invoice void is not an instruction to bill it again.
do $$declare i uuid;begin
 perform set_config('request.jwt.claim.sub','97980000-0000-4000-8000-000000000001',true);
 perform set_config('pea.clinical_context','administration',true);
 select invoice_id into i from clinical.billing_lines l where l.appointment_id=current_setting('test.abs.n3')::uuid and l.line_kind='cancellation'
 and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=l.invoice_id);
 perform clinical.void_invoice_for_correction(i,null,'Annulation administrative fictive');
 perform set_config('test.abs.invoiceCount',(select count(*)::text from clinical.billing_invoices),true);
end $$;
set local request.jwt.claim.sub='';set local request.jwt.claim.role='service_role';set local role service_role;
select public.clinical_reconcile_due_billing_job();
reset role;
do $$begin
 if (select count(*) from clinical.billing_invoices)<>current_setting('test.abs.invoiceCount')::integer then raise exception 'ORDINARY_VOID_REBILLED';end if;
 if exists(select 1 from clinical.billing_lines l where l.appointment_id=current_setting('test.abs.n3')::uuid and not exists(select 1 from clinical.billing_invoice_voids v where v.invoice_id=l.invoice_id)) then raise exception 'ORDINARY_VOID_NOT_PRESERVED';end if;
end $$;
rollback;
