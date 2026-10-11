-- Dépenses publicitaires quotidiennes importées automatiquement.
-- À exécuter une fois dans Supabase SQL Editor.

begin;

create table if not exists public.ad_spend_daily (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('google_ads', 'meta_ads')),
  account_id text not null,
  spend_date date not null,
  campaign_id text not null,
  campaign_name text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'CAD',
  synced_at timestamptz not null default now(),
  unique (platform, account_id, spend_date, campaign_id)
);

create index if not exists ad_spend_daily_date_idx
  on public.ad_spend_daily (spend_date desc);
create index if not exists ad_spend_daily_platform_idx
  on public.ad_spend_daily (platform, spend_date desc);

create table if not exists public.ad_spend_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  range_start date not null,
  range_end date not null,
  status text not null check (status in ('success', 'partial_error')),
  details jsonb not null default '[]'::jsonb
);

alter table public.ad_spend_daily enable row level security;
alter table public.ad_spend_sync_runs enable row level security;

drop policy if exists "ad_spend_daily_direction_read" on public.ad_spend_daily;
create policy "ad_spend_daily_direction_read"
on public.ad_spend_daily for select to authenticated
using (public.is_direction());

drop policy if exists "ad_spend_sync_runs_direction_read" on public.ad_spend_sync_runs;
create policy "ad_spend_sync_runs_direction_read"
on public.ad_spend_sync_runs for select to authenticated
using (public.is_direction());

commit;

