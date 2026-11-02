-- Remplacement explicite autorisé : seule la facture courante est conservée.
-- Appliquer avant le code. Pas de suppression rétroactive lors de l'installation.
begin;
create table if not exists public.payroll_invoice_counters (
  professional_id uuid primary key references public.profiles(id),
  prefix text not null unique check (prefix ~ '^PEA-[[:alnum:]-]+$'),
  last_number bigint not null check (last_number >= 0),
  evidence text not null check (length(evidence) between 10 and 500)
);
alter table public.payroll_invoice_counters enable row level security;
revoke all on public.payroll_invoice_counters from public, anon, authenticated;
grant all on public.payroll_invoice_counters to service_role;

create or replace function public.guard_payroll_invoice_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_TABLE_NAME = 'payroll_invoice_versions' then
    if TG_OP = 'DELETE' and current_setting('app.payroll_replace_current',true) = 'yes' then return old; end if;
    if TG_OP = 'UPDATE' and old.document_base64 is null and new.document_base64 is not null
      and (to_jsonb(old) - array['document_base64','document_sha256','document_name'])
        = (to_jsonb(new) - array['document_base64','document_sha256','document_name']) then return new; end if;
  end if;
  raise exception 'Facture protégée : utilisez la rectification autorisée.';
end;
$$;

create or replace function public.prepare_payroll_invoice(
  p_professional_id uuid, p_start date, p_end date, p_actor uuid,
  p_snapshot jsonb, p_action text default 'prepare', p_expected_version integer default null,
  p_reason text default null, p_legacy_number text default null,
  p_original_base64 text default null, p_original_sha256 text default null,
  p_original_name text default null, p_original_signed boolean default false
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare inv public.payroll_invoices; ver public.payroll_invoice_versions;
  counter public.payroll_invoice_counters; next_version integer; number_value text;
begin
  if p_action not in ('prepare','revise') or p_start is null or p_end is null or p_start > p_end or p_snapshot is null then raise exception 'Requête invalide'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_professional_id::text,0));
  select * into inv from public.payroll_invoices where professional_id=p_professional_id and period_start=p_start and period_end=p_end;
  if found then
    select * into ver from public.payroll_invoice_versions where invoice_id=inv.id order by version desc limit 1;
    if p_action='prepare' or ver.snapshot = p_snapshot then null;
    elsif p_action='revise' and p_expected_version=ver.version and length(btrim(p_reason)) between 10 and 500 then
      next_version := ver.version+1;
      -- Effacement des anciens octets, snapshots et signatures dans la même transaction.
      perform set_config('app.payroll_replace_current','yes',true);
      delete from public.payroll_invoice_versions where invoice_id=inv.id;
      perform set_config('app.payroll_replace_current','',true);
      insert into public.payroll_invoice_versions(invoice_id,version,snapshot,reason,created_by,original_signed)
        values(inv.id,next_version,p_snapshot,p_reason,p_actor,false) returning * into ver;
    else raise exception 'CONFLICT: facture modifiée; rechargez puis rectifiez la facture courante'; end if;
  else
    if p_action='revise' then raise exception 'CONFLICT: facture introuvable'; end if;
    if p_start <= (select historical_through from public.payroll_invoice_registry_settings where singleton) then
      if p_legacy_number is null or p_legacy_number !~ '^[[:alnum:]][[:alnum:]-]{0,80}$' then
        raise exception 'HISTORICAL: indiquez la référence de la facture déjà émise pour cette période'; end if;
      number_value := p_legacy_number;
    else
      select * into counter from public.payroll_invoice_counters where professional_id=p_professional_id for update;
      if not found then raise exception 'CONFLICT: dernière référence envoyée non confirmée pour ce professionnel'; end if;
      update public.payroll_invoice_counters set last_number=last_number+1 where professional_id=p_professional_id returning * into counter;
      number_value := counter.prefix || '-' || lpad(counter.last_number::text,greatest(3,length(counter.last_number::text)),'0');
    end if;
    insert into public.payroll_invoices(professional_id,period_start,period_end,number,legacy,created_by)
      values(p_professional_id,p_start,p_end,number_value,p_start <= (select historical_through from public.payroll_invoice_registry_settings where singleton),p_actor) returning * into inv;
    insert into public.payroll_invoice_versions(invoice_id,version,snapshot,created_by,original_signed)
      values(inv.id,1,p_snapshot,p_actor,false) returning * into ver;
  end if;
  return jsonb_build_object('id',inv.id,'number',inv.number,'version',ver.version,'reason',ver.reason,'snapshot',ver.snapshot,'originalSigned',false);
end;
$$;
revoke all on function public.prepare_payroll_invoice(uuid,date,date,uuid,jsonb,text,integer,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.prepare_payroll_invoice(uuid,date,date,uuid,jsonb,text,integer,text,text,text,text,text,boolean) to service_role;
commit;
