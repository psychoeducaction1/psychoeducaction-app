-- Demarches d'assignation et historique des contacts.
-- A executer manuellement dans Supabase SQL Editor.

begin;

create table if not exists public.assignment_processes (
  id uuid primary key default gen_random_uuid(),
  waiting_list_client_id uuid not null references public.waiting_list_clients(id) on delete restrict,
  status text not null default 'to_contact' check (
    status in (
      'to_contact',
      'voicemail_left',
      'text_sent',
      'email_sent',
      'text_email_sent',
      'contacted_waiting_response',
      'interested',
      'client_refusal',
      'no_response',
      'assigned',
      'classified',
      'returned'
    )
  ),
  prospective_professional_id uuid null references public.profiles(id) on delete set null,
  responsible_profile_id uuid null references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  assigned_at timestamptz null,
  classified_at timestamptz null,
  returned_at timestamptz null,
  classification_reason text null,
  classification_details text null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Met aussi à niveau une table créée avec une version antérieure du script.
alter table public.assignment_processes
drop constraint if exists assignment_processes_status_check;

alter table public.assignment_processes
add constraint assignment_processes_status_check check (
  status in (
    'to_contact',
    'voicemail_left',
    'text_sent',
    'email_sent',
    'text_email_sent',
    'contacted_waiting_response',
    'interested',
    'client_refusal',
    'no_response',
    'assigned',
    'classified',
    'returned'
  )
);

create unique index if not exists assignment_processes_one_active_per_client_idx
on public.assignment_processes(waiting_list_client_id)
where status not in ('assigned', 'classified', 'returned');

create index if not exists assignment_processes_status_idx
on public.assignment_processes(status, started_at desc);

create index if not exists assignment_processes_professional_idx
on public.assignment_processes(prospective_professional_id);

create index if not exists assignment_processes_responsible_idx
on public.assignment_processes(responsible_profile_id);

create table if not exists public.assignment_process_events (
  id uuid primary key default gen_random_uuid(),
  assignment_process_id uuid not null references public.assignment_processes(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'process_started',
      'status_changed',
      'contact_attempt',
      'professional_selected',
      'assigned',
      'classified',
      'returned_to_waiting_list'
    )
  ),
  status text null,
  contact_method text null check (
    contact_method is null or contact_method in ('call', 'voicemail', 'text', 'email')
  ),
  note text null,
  actor_profile_id uuid null references public.profiles(id) on delete set null,
  actor_name text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists assignment_process_events_process_date_idx
on public.assignment_process_events(assignment_process_id, created_at desc);

create table if not exists public.administrative_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text null,
  assigned_to text not null default 'both' check (
    assigned_to in ('hajar', 'fatima', 'both')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'in_progress', 'completed', 'canceled')
  ),
  due_at timestamptz null,
  source_type text null,
  source_id uuid null,
  created_by uuid null references public.profiles(id) on delete set null,
  completed_at timestamptz null,
  notification_sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists administrative_tasks_unique_active_source_idx
on public.administrative_tasks(source_type, source_id)
where source_type is not null and source_id is not null and status <> 'canceled';

create index if not exists administrative_tasks_status_due_idx
on public.administrative_tasks(status, due_at);

create table if not exists public.administrative_task_notes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.administrative_tasks(id) on delete cascade,
  note text not null,
  author_id uuid null references public.profiles(id) on delete set null,
  author_name text null,
  created_at timestamptz not null default now()
);

create index if not exists administrative_task_notes_task_date_idx
on public.administrative_task_notes(task_id, created_at desc);

create or replace function public.touch_assignment_process_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists assignment_processes_touch_updated_at
on public.assignment_processes;

create trigger assignment_processes_touch_updated_at
before update on public.assignment_processes
for each row execute function public.touch_assignment_process_updated_at();

drop trigger if exists administrative_tasks_touch_updated_at
on public.administrative_tasks;

create trigger administrative_tasks_touch_updated_at
before update on public.administrative_tasks
for each row execute function public.touch_assignment_process_updated_at();

alter table public.assignment_processes enable row level security;
alter table public.assignment_process_events enable row level security;
alter table public.administrative_tasks enable row level security;
alter table public.administrative_task_notes enable row level security;

drop policy if exists "assignment_processes_direction_all"
on public.assignment_processes;
drop policy if exists "assignment_process_events_direction_all"
on public.assignment_process_events;
drop policy if exists "administrative_tasks_select"
on public.administrative_tasks;
drop policy if exists "administrative_tasks_insert"
on public.administrative_tasks;
drop policy if exists "administrative_tasks_update"
on public.administrative_tasks;
drop policy if exists "administrative_tasks_delete"
on public.administrative_tasks;
drop policy if exists "administrative_task_notes_select"
on public.administrative_task_notes;
drop policy if exists "administrative_task_notes_insert"
on public.administrative_task_notes;

create policy "assignment_processes_direction_all"
on public.assignment_processes
for all to authenticated
using (public.is_direction())
with check (public.is_direction());

create policy "assignment_process_events_direction_all"
on public.assignment_process_events
for all to authenticated
using (public.is_direction())
with check (public.is_direction());

create policy "administrative_tasks_select"
on public.administrative_tasks
for select to authenticated
using (
  public.is_direction()
  or lower(coalesce(auth.jwt() ->> 'email', '')) = 'contact@psychoeducaction.com'
  or (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'hrahajar@gmail.com'
    and assigned_to in ('hajar', 'both')
  )
  or (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'fz.benlahcen@gmail.com'
    and assigned_to in ('fatima', 'both')
  )
);

create policy "administrative_tasks_insert"
on public.administrative_tasks
for insert to authenticated
with check (public.is_direction());

create policy "administrative_tasks_update"
on public.administrative_tasks
for update to authenticated
using (
  public.is_direction()
  or lower(coalesce(auth.jwt() ->> 'email', '')) = 'contact@psychoeducaction.com'
  or (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'hrahajar@gmail.com'
    and assigned_to in ('hajar', 'both')
  )
  or (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'fz.benlahcen@gmail.com'
    and assigned_to in ('fatima', 'both')
  )
)
with check (
  public.is_direction()
  or lower(coalesce(auth.jwt() ->> 'email', '')) = 'contact@psychoeducaction.com'
  or (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'hrahajar@gmail.com'
    and assigned_to in ('hajar', 'both')
  )
  or (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'fz.benlahcen@gmail.com'
    and assigned_to in ('fatima', 'both')
  )
);

create policy "administrative_tasks_delete"
on public.administrative_tasks
for delete to authenticated
using (public.is_direction());

create policy "administrative_task_notes_select"
on public.administrative_task_notes
for select to authenticated
using (
  exists (
    select 1
    from public.administrative_tasks task
    where task.id = task_id
  )
);

create policy "administrative_task_notes_insert"
on public.administrative_task_notes
for insert to authenticated
with check (
  exists (
    select 1
    from public.administrative_tasks task
    where task.id = task_id
  )
);

commit;
