-- Lien automatique entre la paie mensuelle des adjointes et le budget.
-- A executer manuellement dans Supabase SQL Editor apres administrative-payroll.sql.

begin;

create table if not exists public.administrative_payroll_months (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.administrative_staff(id) on delete cascade,
  payroll_month date not null,
  payable_hours numeric(8, 2) not null default 0,
  total_mad numeric(12, 2) not null default 0,
  mad_to_cad_rate numeric(14, 8) not null check (mad_to_cad_rate > 0),
  total_cad numeric(12, 2) not null default 0,
  rate_date date not null,
  payment_date date not null,
  rate_source text not null default 'Frankfurter',
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, payroll_month),
  check (payroll_month = date_trunc('month', payroll_month)::date)
);

create index if not exists administrative_payroll_months_month_idx
on public.administrative_payroll_months(payroll_month);

drop trigger if exists administrative_payroll_months_touch_updated_at
on public.administrative_payroll_months;

create trigger administrative_payroll_months_touch_updated_at
before update on public.administrative_payroll_months
for each row
execute function public.touch_updated_at();

alter table public.administrative_payroll_months enable row level security;

drop policy if exists "administrative_payroll_months_select_direction_or_self"
on public.administrative_payroll_months;
drop policy if exists "administrative_payroll_months_insert_direction_or_self"
on public.administrative_payroll_months;
drop policy if exists "administrative_payroll_months_update_direction_or_self"
on public.administrative_payroll_months;
drop policy if exists "administrative_payroll_months_delete_direction"
on public.administrative_payroll_months;

create policy "administrative_payroll_months_select_direction_or_self"
on public.administrative_payroll_months
for select
to authenticated
using (
  public.is_administrative_payroll_manager()
  or public.is_current_administrative_staff(staff_id)
);

create policy "administrative_payroll_months_insert_direction_or_self"
on public.administrative_payroll_months
for insert
to authenticated
with check (
  public.is_administrative_payroll_manager()
  or public.is_current_administrative_staff(staff_id)
);

create policy "administrative_payroll_months_update_direction_or_self"
on public.administrative_payroll_months
for update
to authenticated
using (
  public.is_administrative_payroll_manager()
  or public.is_current_administrative_staff(staff_id)
)
with check (
  public.is_administrative_payroll_manager()
  or public.is_current_administrative_staff(staff_id)
);

create policy "administrative_payroll_months_delete_direction"
on public.administrative_payroll_months
for delete
to authenticated
using (public.is_administrative_payroll_manager());

alter table public.budget_periods
add column if not exists administrative_payroll_expenses numeric not null default 0;

commit;
