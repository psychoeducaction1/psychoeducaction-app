-- Espace de travail de l'employee marketing.
-- A executer manuellement dans Supabase SQL Editor.

begin;

alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
add constraint profiles_role_check
check (role in ('direction', 'professionnel', 'marketing'));

create table if not exists public.marketing_staff (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid null unique references public.profiles(id) on delete set null,
  full_name text not null,
  email text not null unique,
  weekly_hours numeric(5, 2) not null default 10 check (weekly_hours >= 0),
  hourly_rate numeric(10, 2) not null default 22 check (hourly_rate >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_tasks (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.marketing_staff(id) on delete restrict,
  title text not null,
  description text null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'pending' check (
    status in ('pending', 'in_progress', 'completed', 'canceled')
  ),
  due_at timestamptz null,
  created_by uuid null references public.profiles(id) on delete set null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_task_notes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.marketing_tasks(id) on delete cascade,
  note text not null,
  author_id uuid null references public.profiles(id) on delete set null,
  author_name text null,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.marketing_tasks(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text null,
  file_size bigint null check (file_size is null or file_size >= 0),
  uploaded_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_availability_slots (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.marketing_staff(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  note text null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create index if not exists marketing_tasks_staff_status_idx
on public.marketing_tasks(staff_id, status, due_at);

create index if not exists marketing_task_notes_task_idx
on public.marketing_task_notes(task_id, created_at desc);

create index if not exists marketing_task_files_task_idx
on public.marketing_task_files(task_id, created_at desc);

create index if not exists marketing_availability_staff_start_idx
on public.marketing_availability_slots(staff_id, start_at);

create or replace function public.touch_marketing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketing_staff_touch_updated_at on public.marketing_staff;
create trigger marketing_staff_touch_updated_at
before update on public.marketing_staff
for each row execute function public.touch_marketing_updated_at();

drop trigger if exists marketing_tasks_touch_updated_at on public.marketing_tasks;
create trigger marketing_tasks_touch_updated_at
before update on public.marketing_tasks
for each row execute function public.touch_marketing_updated_at();

drop trigger if exists marketing_availability_touch_updated_at
on public.marketing_availability_slots;
create trigger marketing_availability_touch_updated_at
before update on public.marketing_availability_slots
for each row execute function public.touch_marketing_updated_at();

create or replace function public.is_marketing_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role = 'direction'
      and lower(coalesce(auth.jwt() ->> 'email', '')) =
        'contact@psychoeducaction.com'
  )
$$;

revoke all on function public.is_marketing_manager() from public;
grant execute on function public.is_marketing_manager() to authenticated;

create or replace function public.is_marketing_staff(target_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.marketing_staff staff
    where staff.id = target_staff_id
      and staff.is_active is true
      and (
        staff.profile_id = auth.uid()
        or lower(staff.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  )
$$;

revoke all on function public.is_marketing_staff(uuid) from public;
grant execute on function public.is_marketing_staff(uuid) to authenticated;

alter table public.marketing_staff enable row level security;
alter table public.marketing_tasks enable row level security;
alter table public.marketing_task_notes enable row level security;
alter table public.marketing_task_files enable row level security;
alter table public.marketing_availability_slots enable row level security;

drop policy if exists "marketing_staff_select_direction_or_self" on public.marketing_staff;
drop policy if exists "marketing_staff_write_direction" on public.marketing_staff;
drop policy if exists "marketing_tasks_select_direction_or_self" on public.marketing_tasks;
drop policy if exists "marketing_tasks_insert_direction" on public.marketing_tasks;
drop policy if exists "marketing_tasks_insert_direction_or_self" on public.marketing_tasks;
drop policy if exists "marketing_tasks_update_direction" on public.marketing_tasks;
drop policy if exists "marketing_tasks_delete_direction" on public.marketing_tasks;
drop policy if exists "marketing_task_notes_select_direction_or_self" on public.marketing_task_notes;
drop policy if exists "marketing_task_notes_insert_direction_or_self" on public.marketing_task_notes;
drop policy if exists "marketing_task_files_select_direction_or_self" on public.marketing_task_files;
drop policy if exists "marketing_task_files_insert_direction_or_self" on public.marketing_task_files;
drop policy if exists "marketing_task_files_delete_direction_or_uploader" on public.marketing_task_files;
drop policy if exists "marketing_availability_select_direction_or_self" on public.marketing_availability_slots;
drop policy if exists "marketing_availability_insert_self" on public.marketing_availability_slots;
drop policy if exists "marketing_availability_update_self" on public.marketing_availability_slots;
drop policy if exists "marketing_availability_delete_self" on public.marketing_availability_slots;
drop policy if exists "marketing_availability_insert_direction_or_self" on public.marketing_availability_slots;
drop policy if exists "marketing_availability_update_direction_or_self" on public.marketing_availability_slots;
drop policy if exists "marketing_availability_delete_direction_or_self" on public.marketing_availability_slots;

create policy "marketing_staff_select_direction_or_self"
on public.marketing_staff for select to authenticated
using (public.is_marketing_manager() or public.is_marketing_staff(id));

create policy "marketing_staff_write_direction"
on public.marketing_staff for all to authenticated
using (public.is_marketing_manager()) with check (public.is_marketing_manager());

create policy "marketing_tasks_select_direction_or_self"
on public.marketing_tasks for select to authenticated
using (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

create policy "marketing_tasks_insert_direction_or_self"
on public.marketing_tasks for insert to authenticated
with check (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

create policy "marketing_tasks_update_direction"
on public.marketing_tasks for update to authenticated
using (public.is_marketing_manager())
with check (public.is_marketing_manager());

create policy "marketing_tasks_delete_direction"
on public.marketing_tasks for delete to authenticated
using (public.is_marketing_manager());

create policy "marketing_task_notes_select_direction_or_self"
on public.marketing_task_notes for select to authenticated
using (
  exists (
    select 1 from public.marketing_tasks task
    where task.id = task_id
      and (public.is_marketing_manager() or public.is_marketing_staff(task.staff_id))
  )
);

create policy "marketing_task_notes_insert_direction_or_self"
on public.marketing_task_notes for insert to authenticated
with check (
  exists (
    select 1 from public.marketing_tasks task
    where task.id = task_id
      and (public.is_marketing_manager() or public.is_marketing_staff(task.staff_id))
  )
);

create policy "marketing_task_files_select_direction_or_self"
on public.marketing_task_files for select to authenticated
using (
  exists (
    select 1 from public.marketing_tasks task
    where task.id = task_id
      and (public.is_marketing_manager() or public.is_marketing_staff(task.staff_id))
  )
);

create policy "marketing_task_files_insert_direction_or_self"
on public.marketing_task_files for insert to authenticated
with check (
  exists (
    select 1 from public.marketing_tasks task
    where task.id = task_id
      and (public.is_marketing_manager() or public.is_marketing_staff(task.staff_id))
  )
);

create policy "marketing_task_files_delete_direction_or_uploader"
on public.marketing_task_files for delete to authenticated
using (public.is_marketing_manager() or uploaded_by = auth.uid());

create policy "marketing_availability_select_direction_or_self"
on public.marketing_availability_slots for select to authenticated
using (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

create policy "marketing_availability_insert_direction_or_self"
on public.marketing_availability_slots for insert to authenticated
with check (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

create policy "marketing_availability_update_direction_or_self"
on public.marketing_availability_slots for update to authenticated
using (public.is_marketing_manager() or public.is_marketing_staff(staff_id))
with check (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

create policy "marketing_availability_delete_direction_or_self"
on public.marketing_availability_slots for delete to authenticated
using (public.is_marketing_manager() or public.is_marketing_staff(staff_id));

create or replace function public.update_own_marketing_task_status(
  target_task_id uuid,
  next_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if next_status not in ('pending', 'in_progress', 'completed') then
    raise exception 'Statut invalide.';
  end if;

  update public.marketing_tasks task
  set
    status = next_status,
    completed_at = case when next_status = 'completed' then now() else null end
  where task.id = target_task_id
    and public.is_marketing_staff(task.staff_id);

  if not found then
    raise exception 'Tache introuvable ou non autorisee.';
  end if;
end;
$$;

revoke all on function public.update_own_marketing_task_status(uuid, text) from public;
grant execute on function public.update_own_marketing_task_status(uuid, text)
to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('marketing-task-files', 'marketing-task-files', false, 52428800)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "marketing_storage_select" on storage.objects;
drop policy if exists "marketing_storage_insert" on storage.objects;
drop policy if exists "marketing_storage_delete" on storage.objects;

create policy "marketing_storage_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'marketing-task-files'
  and (
    public.is_marketing_manager()
    or public.is_marketing_staff(((storage.foldername(name))[1])::uuid)
  )
);

create policy "marketing_storage_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'marketing-task-files'
  and (
    public.is_marketing_manager()
    or public.is_marketing_staff(((storage.foldername(name))[1])::uuid)
  )
);

create policy "marketing_storage_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'marketing-task-files'
  and (
    public.is_marketing_manager()
    or owner_id = auth.uid()::text
  )
);

insert into public.marketing_staff (
  full_name,
  email,
  weekly_hours,
  hourly_rate
)
values (
  'Camille Payette',
  'camille.payette@psychoeducaction.com',
  10,
  22
)
on conflict (email) do update
set
  full_name = excluded.full_name,
  weekly_hours = excluded.weekly_hours,
  hourly_rate = excluded.hourly_rate,
  is_active = true;

commit;
