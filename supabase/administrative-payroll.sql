-- Module de paie des adjointes administratives.
-- A executer manuellement dans Supabase SQL Editor.

begin;

create table if not exists public.administrative_staff (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid null references public.profiles(id) on delete set null,
  full_name text not null,
  email text null unique,
  hourly_rate numeric(10, 2) not null,
  monthly_salary numeric(10, 2) null,
  vacation_days_per_year numeric(5, 2) not null default 10,
  default_schedule jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.morocco_holidays (
  holiday_date date primary key,
  name text not null,
  is_paid boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.administrative_time_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.administrative_staff(id) on delete cascade,
  work_date date not null,
  start_time time null,
  end_time time null,
  break_minutes integer not null default 0,
  entry_type text not null default 'normal' check (
    entry_type in (
      'normal',
      'holiday_paid',
      'holiday_worked',
      'vacation_paid',
      'unpaid_absence',
      'custom'
    )
  ),
  hours numeric(6, 2) not null default 0,
  note text null,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, work_date)
);

create index if not exists administrative_staff_profile_id_idx
on public.administrative_staff(profile_id);

create index if not exists administrative_staff_email_idx
on public.administrative_staff(lower(email));

create index if not exists administrative_time_entries_staff_date_idx
on public.administrative_time_entries(staff_id, work_date);

create index if not exists administrative_time_entries_work_date_idx
on public.administrative_time_entries(work_date);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists administrative_staff_touch_updated_at
on public.administrative_staff;

create trigger administrative_staff_touch_updated_at
before update on public.administrative_staff
for each row
execute function public.touch_updated_at();

drop trigger if exists administrative_time_entries_touch_updated_at
on public.administrative_time_entries;

create trigger administrative_time_entries_touch_updated_at
before update on public.administrative_time_entries
for each row
execute function public.touch_updated_at();

create or replace function public.is_administrative_payroll_direction()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'direction'
  )
$$;

create or replace function public.is_current_administrative_staff(
  target_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.administrative_staff s
    where s.id = target_staff_id
      and s.is_active is true
      and (
        s.profile_id = auth.uid()
        or lower(s.email) = lower(auth.jwt() ->> 'email')
      )
  )
$$;

revoke all on function public.is_administrative_payroll_direction() from public;
revoke all on function public.is_current_administrative_staff(uuid) from public;

grant execute on function public.is_administrative_payroll_direction()
to authenticated;

grant execute on function public.is_current_administrative_staff(uuid)
to authenticated;

alter table public.administrative_staff enable row level security;
alter table public.morocco_holidays enable row level security;
alter table public.administrative_time_entries enable row level security;

drop policy if exists "administrative_staff_select_direction_or_self"
on public.administrative_staff;
drop policy if exists "administrative_staff_write_direction"
on public.administrative_staff;
drop policy if exists "morocco_holidays_select_authenticated"
on public.morocco_holidays;
drop policy if exists "morocco_holidays_write_direction"
on public.morocco_holidays;
drop policy if exists "administrative_time_entries_select_direction_or_self"
on public.administrative_time_entries;
drop policy if exists "administrative_time_entries_insert_direction_or_self"
on public.administrative_time_entries;
drop policy if exists "administrative_time_entries_update_direction_or_self"
on public.administrative_time_entries;
drop policy if exists "administrative_time_entries_delete_direction"
on public.administrative_time_entries;

create policy "administrative_staff_select_direction_or_self"
on public.administrative_staff
for select
to authenticated
using (
  public.is_administrative_payroll_direction()
  or profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
);

create policy "administrative_staff_write_direction"
on public.administrative_staff
for all
to authenticated
using (public.is_administrative_payroll_direction())
with check (public.is_administrative_payroll_direction());

create policy "morocco_holidays_select_authenticated"
on public.morocco_holidays
for select
to authenticated
using (true);

create policy "morocco_holidays_write_direction"
on public.morocco_holidays
for all
to authenticated
using (public.is_administrative_payroll_direction())
with check (public.is_administrative_payroll_direction());

create policy "administrative_time_entries_select_direction_or_self"
on public.administrative_time_entries
for select
to authenticated
using (
  public.is_administrative_payroll_direction()
  or public.is_current_administrative_staff(staff_id)
);

create policy "administrative_time_entries_insert_direction_or_self"
on public.administrative_time_entries
for insert
to authenticated
with check (
  public.is_administrative_payroll_direction()
  or public.is_current_administrative_staff(staff_id)
);

create policy "administrative_time_entries_update_direction_or_self"
on public.administrative_time_entries
for update
to authenticated
using (
  public.is_administrative_payroll_direction()
  or public.is_current_administrative_staff(staff_id)
)
with check (
  public.is_administrative_payroll_direction()
  or public.is_current_administrative_staff(staff_id)
);

create policy "administrative_time_entries_delete_direction"
on public.administrative_time_entries
for delete
to authenticated
using (public.is_administrative_payroll_direction());

insert into public.administrative_staff (
  full_name,
  email,
  hourly_rate,
  monthly_salary,
  vacation_days_per_year,
  default_schedule
)
values
  (
    'Hajar',
    'hrahajar@gmail.com',
    35.80,
    3100.00,
    10,
    '[
      {"weekday": 1, "startTime": "08:00", "endTime": "12:00"},
      {"weekday": 2, "startTime": "08:00", "endTime": "12:00"},
      {"weekday": 3, "startTime": "08:00", "endTime": "12:00"},
      {"weekday": 4, "startTime": "08:00", "endTime": "12:00"},
      {"weekday": 5, "startTime": "08:00", "endTime": "12:00"}
    ]'::jsonb
  ),
  (
    'Fatima Zahra',
    'contact@psychoeducaction.com',
    39.25,
    6200.00,
    12,
    '[
      {"weekday": 1, "startTime": "12:00", "endTime": "18:30"},
      {"weekday": 2, "startTime": "12:00", "endTime": "18:30"},
      {"weekday": 3, "startTime": "12:00", "endTime": "18:30"},
      {"weekday": 4, "startTime": "12:00", "endTime": "18:30"},
      {"weekday": 5, "startTime": "12:00", "endTime": "18:30"},
      {"weekday": 6, "startTime": "12:00", "endTime": "16:00"}
    ]'::jsonb
  )
on conflict (email) do update
set
  full_name = excluded.full_name,
  hourly_rate = excluded.hourly_rate,
  monthly_salary = excluded.monthly_salary,
  vacation_days_per_year = excluded.vacation_days_per_year,
  default_schedule = excluded.default_schedule,
  is_active = true;

insert into public.morocco_holidays (holiday_date, name)
values
  ('2026-01-01', 'Nouvel An'),
  ('2026-01-11', 'Manifeste de l''indépendance'),
  ('2026-05-01', 'Fête du Travail'),
  ('2026-07-30', 'Fête du Trône'),
  ('2026-08-14', 'Allégeance Oued Eddahab'),
  ('2026-08-20', 'Révolution du Roi et du Peuple'),
  ('2026-08-21', 'Fête de la Jeunesse'),
  ('2026-11-06', 'Marche Verte'),
  ('2026-11-18', 'Fête de l''Indépendance')
on conflict (holiday_date) do update
set name = excluded.name;

commit;
