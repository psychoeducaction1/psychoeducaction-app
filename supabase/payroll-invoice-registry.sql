-- PREPARE UNIQUEMENT. Aucune exécution distante sans validation.
-- Identité UUID != référence comptable. Anciens numéros conservés même en collision.
begin;
create sequence if not exists public.payroll_invoice_number_seq;
create table if not exists public.payroll_invoice_registry_settings (
  singleton boolean primary key default true check(singleton),
  historical_through date not null default 'infinity'::date
);
insert into public.payroll_invoice_registry_settings(singleton) values(true) on conflict do nothing;
alter table public.payroll_invoice_registry_settings enable row level security;
revoke all on public.payroll_invoice_registry_settings from public, anon, authenticated;
grant select on public.payroll_invoice_registry_settings to service_role;
-- Après inventaire comptable et validation seulement, fixer historical_through à la
-- dernière date susceptible d'avoir déjà été facturée. Par défaut tout exige un original.
create table if not exists public.payroll_invoices (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  number text not null,
  legacy boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique(professional_id, period_start, period_end)
);
create unique index if not exists payroll_invoice_new_number_unique
  on public.payroll_invoices(number) where not legacy;
create table if not exists public.payroll_invoice_versions (
  invoice_id uuid not null references public.payroll_invoices(id),
  version integer not null check (version > 0),
  snapshot jsonb,
  reason text,
  original_signed boolean default false,
  document_base64 text,
  document_sha256 text,
  document_name text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key(invoice_id, version),
  check (version = 1 or (reason is not null and length(btrim(reason)) >= 10 and original_signed is false and snapshot is not null)),
  check ((document_base64 is null) = (document_sha256 is null))
);
alter table public.payroll_invoices enable row level security;
alter table public.payroll_invoice_versions enable row level security;
-- Aucune policy permissive : accès uniquement par API serveur après contrôle paie.
revoke all on public.payroll_invoices, public.payroll_invoice_versions from anon, authenticated;
revoke all on sequence public.payroll_invoice_number_seq from public, anon, authenticated;
grant all on public.payroll_invoices, public.payroll_invoice_versions to service_role;
grant usage, select on sequence public.payroll_invoice_number_seq to service_role;

create or replace function public.guard_payroll_invoice_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and TG_TABLE_NAME = 'payroll_invoice_versions' then
    if old.document_base64 is null and new.document_base64 is not null
      and (to_jsonb(old) - array['document_base64','document_sha256','document_name'])
        = (to_jsonb(new) - array['document_base64','document_sha256','document_name']) then
      return new;
    end if;
  end if;
  raise exception 'Historique de facture immuable : créer un rectificatif.';
end;
$$;
drop trigger if exists immutable_payroll_invoice on public.payroll_invoices;
create trigger immutable_payroll_invoice before update or delete on public.payroll_invoices
  for each row execute function public.guard_payroll_invoice_history();
drop trigger if exists immutable_payroll_invoice_version on public.payroll_invoice_versions;
create trigger immutable_payroll_invoice_version before update or delete on public.payroll_invoice_versions
  for each row execute function public.guard_payroll_invoice_history();
drop trigger if exists no_truncate_payroll_invoices on public.payroll_invoices;
create trigger no_truncate_payroll_invoices before truncate on public.payroll_invoices
  for each statement execute function public.guard_payroll_invoice_history();
drop trigger if exists no_truncate_payroll_invoice_versions on public.payroll_invoice_versions;
create trigger no_truncate_payroll_invoice_versions before truncate on public.payroll_invoice_versions
  for each statement execute function public.guard_payroll_invoice_history();

create or replace function public.prepare_payroll_invoice(
  p_professional_id uuid, p_start date, p_end date, p_actor uuid,
  p_snapshot jsonb, p_action text default 'prepare', p_expected_version integer default null,
  p_reason text default null, p_legacy_number text default null,
  p_original_base64 text default null, p_original_sha256 text default null,
  p_original_name text default null, p_original_signed boolean default false
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare inv public.payroll_invoices; ver public.payroll_invoice_versions; next_version integer; seq bigint;
begin
  if p_action not in ('prepare','revise','import') or p_start > p_end then raise exception 'Requête invalide'; end if;
  -- Sérialise créations et corrections d'une même facture, même sur deux serveurs.
  perform pg_advisory_xact_lock(hashtextextended(p_professional_id::text || ':' || p_start::text || ':' || p_end::text, 0));
  select * into inv from public.payroll_invoices where professional_id=p_professional_id and period_start=p_start and period_end=p_end;
  if found then
    select * into ver from public.payroll_invoice_versions where invoice_id=inv.id order by version desc limit 1;
    if p_action='import' then
      select * into ver from public.payroll_invoice_versions where invoice_id=inv.id and version=1;
      if not inv.legacy or ver.document_sha256 is distinct from p_original_sha256 or inv.number is distinct from p_legacy_number then
        raise exception 'CONFLICT: un autre original est déjà enregistré';
      end if;
    elsif ver.snapshot = p_snapshot then
      null; -- Retry identique : même UUID et même version, même après une réponse perdue.
    elsif p_action='revise' and p_expected_version=ver.version and length(btrim(p_reason)) between 10 and 500 then
      if ver.document_base64 is null then raise exception 'CONFLICT: finalisez la version précédente'; end if;
      next_version := ver.version+1;
      insert into public.payroll_invoice_versions(invoice_id,version,snapshot,reason,created_by)
        values(inv.id,next_version,p_snapshot,p_reason,p_actor) returning * into ver;
    else
      raise exception 'CONFLICT: facture existante différente; rectificatif motivé et version attendue requis';
    end if;
  else
    if p_action='revise' then raise exception 'CONFLICT: original introuvable'; end if;
    if p_action='prepare' and p_start <= coalesce((select historical_through from public.payroll_invoice_registry_settings where singleton),'infinity'::date) then
      raise exception 'HISTORICAL: archivez le document original avant de préparer son rectificatif';
    end if;
    if p_action='import' and (nullif(btrim(p_legacy_number),'') is null or p_original_base64 is null or p_original_sha256 is null or p_original_name is null) then
      raise exception 'Original, référence et empreinte requis';
    end if;
    if p_action <> 'import' then seq := nextval('public.payroll_invoice_number_seq'); end if;
    insert into public.payroll_invoices(professional_id,period_start,period_end,number,legacy,created_by)
      values(p_professional_id,p_start,p_end,
        case when p_action='import' then p_legacy_number else 'PEA-' || extract(year from p_end)::text || '-' || lpad(seq::text,greatest(6,length(seq::text)),'0') end,
        p_action='import',p_actor) returning * into inv;
    insert into public.payroll_invoice_versions(invoice_id,version,snapshot,created_by,original_signed,document_base64,document_sha256,document_name)
      values(inv.id,1,case when p_action='import' then null else p_snapshot end,p_actor,
        case when p_action='import' then p_original_signed else false end,
        p_original_base64,p_original_sha256,p_original_name) returning * into ver;
  end if;
  return jsonb_build_object('id',inv.id,'number',inv.number,'version',ver.version,'reason',ver.reason,'snapshot',ver.snapshot,
    'documentName',ver.document_name,'originalSigned',ver.original_signed);
end;
$$;
revoke all on function public.prepare_payroll_invoice(uuid,date,date,uuid,jsonb,text,integer,text,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.prepare_payroll_invoice(uuid,date,date,uuid,jsonb,text,integer,text,text,text,text,text,boolean) to service_role;
commit;
