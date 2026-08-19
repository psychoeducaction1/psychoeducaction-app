-- Budget history tables for manually saved budget periods.
-- Review and run from the Supabase SQL Editor.

begin;

create table if not exists public.budget_periods (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  accounting_month text not null,
  source_file_name text,
  gross_revenue numeric not null default 0,
  professional_pay numeric not null default 0,
  nancy_pay numeric not null default 0,
  clinic_revenue numeric not null default 0,
  travel_excluded numeric not null default 0,
  dossier_revenue numeric not null default 0,
  cancellation_revenue numeric not null default 0,
  meeting_count integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (period_start, period_end, accounting_month)
);

create table if not exists public.budget_period_professionals (
  id uuid primary key default gen_random_uuid(),
  budget_period_id uuid not null references public.budget_periods(id) on delete cascade,
  professional_id uuid references public.profiles(id) on delete set null,
  professional_name text not null,
  gross_revenue numeric not null default 0,
  professional_pay numeric not null default 0,
  nancy_pay numeric not null default 0,
  clinic_revenue numeric not null default 0,
  travel_excluded numeric not null default 0,
  dossier_revenue numeric not null default 0,
  cancellation_revenue numeric not null default 0,
  meeting_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists budget_periods_accounting_month_idx
on public.budget_periods (accounting_month);

create index if not exists budget_periods_period_start_idx
on public.budget_periods (period_start);

create index if not exists budget_period_professionals_period_idx
on public.budget_period_professionals (budget_period_id);

alter table public.budget_periods enable row level security;
alter table public.budget_period_professionals enable row level security;

drop policy if exists "budget_periods_super_admin_all" on public.budget_periods;
drop policy if exists "budget_period_professionals_super_admin_all" on public.budget_period_professionals;

create policy "budget_periods_super_admin_all"
on public.budget_periods
for all
to authenticated
using (
  auth.jwt() ->> 'email' = 'contact@psychoeducaction.com'
)
with check (
  auth.jwt() ->> 'email' = 'contact@psychoeducaction.com'
);

create policy "budget_period_professionals_super_admin_all"
on public.budget_period_professionals
for all
to authenticated
using (
  auth.jwt() ->> 'email' = 'contact@psychoeducaction.com'
)
with check (
  auth.jwt() ->> 'email' = 'contact@psychoeducaction.com'
);

commit;
