-- Prepared only: no existing invoice, payment or archive is changed.
begin;
alter function public.clinical_unified_finance_command(uuid,text,jsonb) rename to clinical_unified_finance_command_980_base;
create function public.clinical_unified_finance_command(p_key uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' set row_security=off as $$begin
 perform clinical.unified_context('administration');
 if p_action='invoice.void' then raise exception 'MANUAL_INVOICE_VOID_DISABLED' using errcode='42501';end if;
 return public.clinical_unified_finance_command_980_base(p_key,p_action,p_data);
end $$;
revoke all on function public.clinical_unified_finance_command_980_base(uuid,text,jsonb),public.clinical_unified_finance_command(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.clinical_unified_finance_command(uuid,text,jsonb) to authenticated;
commit;
