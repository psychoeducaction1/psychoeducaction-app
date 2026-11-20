-- Template settings only. Installation performs no email or invoice changes.
begin;
create table clinical.invoice_email_templates (
  version integer primary key check (version > 0),
  subject text not null,
  body_text text not null,
  operation_key uuid not null unique,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
alter table clinical.invoice_email_templates enable row level security;
revoke all on clinical.invoice_email_templates from public, anon, authenticated, service_role;
create trigger invoice_email_templates_immutable before update or delete on clinical.invoice_email_templates
  for each row execute function clinical.reject_immutable_mutation();
create trigger invoice_email_templates_no_truncate before truncate on clinical.invoice_email_templates
  for each statement execute function clinical.reject_immutable_mutation();

create function public.clinical_invoice_email_template()
returns jsonb language plpgsql stable security definer set search_path='' set row_security=off as $$
declare t clinical.invoice_email_templates;
begin
  if not clinical.active_actor() or not clinical.can_administer() then
    raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';
  end if;
  select * into t from clinical.invoice_email_templates order by version desc limit 1;
  return jsonb_build_object('template',case when t.version is not null then jsonb_build_object('subject',t.subject,'text',t.body_text) end,
    'version',coalesce(t.version,0),'canEdit',clinical.finance_correction_admin());
end $$;

create function public.clinical_save_invoice_email_template(p_expected integer,p_subject text,p_body text,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare t clinical.invoice_email_templates; v integer; field constant text:='{{numero_facture}}';
  fields constant text:='[{][{](numero_facture|nom_client|nom_payeur|dates_prestations|montant_total)[}][}]';
begin
  if not clinical.active_actor() or not clinical.can_administer() or not clinical.finance_correction_admin() then
    raise exception 'CLINICAL_FORBIDDEN' using errcode='42501';
  end if;
  if p_key is null or p_expected is null or p_expected<0 or p_subject is null or p_body is null
    or length(p_subject)>200 or length(p_body)>4000 or p_subject~E'[\\r\\n]'
    or strpos(p_subject,field)=0 or strpos(p_body,field)=0
    or regexp_replace(p_subject,fields,'','g')~'[{}]' or regexp_replace(p_body,fields,'','g')~'[{}]' then
    raise exception 'INVOICE_TEMPLATE_INVALID' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('clinical/invoice-email-template',0));
  select * into t from clinical.invoice_email_templates where operation_key=p_key;
  if found then
    if t.actor_id is distinct from auth.uid() or t.version<>p_expected+1 or t.subject<>p_subject or t.body_text<>p_body then
      raise exception 'INVOICE_TEMPLATE_VERSION_CONFLICT' using errcode='40001';
    end if;
    return public.clinical_invoice_email_template();
  end if;
  select coalesce(max(version),0) into v from clinical.invoice_email_templates;
  if v<>p_expected then raise exception 'INVOICE_TEMPLATE_VERSION_CONFLICT' using errcode='40001';end if;
  insert into clinical.invoice_email_templates(version,subject,body_text,operation_key,actor_id)
  values(v+1,p_subject,p_body,p_key,auth.uid());
  return public.clinical_invoice_email_template();
end $$;
revoke all on function public.clinical_invoice_email_template(),public.clinical_save_invoice_email_template(integer,text,text,uuid) from public, anon, service_role;
grant execute on function public.clinical_invoice_email_template(),public.clinical_save_invoice_email_template(integer,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
